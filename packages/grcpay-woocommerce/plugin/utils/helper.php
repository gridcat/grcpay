<?php

namespace CryptAPI;

use Exception;

/**
 * Thrown from Helper::createWallet() when the failure is a transport-level
 * problem — network timeout, DNS failure, connection refused, or a 5xx
 * response from the grcpay proxy — rather than a deterministic rejection
 * from grcpay itself (bad recipient, invalid amount, malformed request).
 *
 * Transport failures are retryable on a different backend URL; deterministic
 * proxy errors are not (the request itself is bad, so retrying will get the
 * same response). The controller uses this distinction to decide whether
 * to fall back to the gateway's backup URL.
 */
class GrcpayTransportException extends Exception
{
}

class Helper
{
    private static $coinGeckoApiBase = 'https://api.coingecko.com/api/v3/';

    public static $HALFORD = 100000000;

    /**
     * Convert a halford integer (possibly arriving as a JSON string) to a
     * GRC float. Mirrors the backend's halford2grc helper so every call
     * site can divide consistently without sprinkling `/ HALFORD` or
     * `floatval($x)` guards through the plugin code.
     */
    public static function halfordToGrc($halford)
    {
        if ($halford === null || $halford === '' || $halford === false) {
            return 0.0;
        }
        return floatval($halford) / self::$HALFORD;
    }

    /**
     * Round an invoice amount UP to `$decimals` decimal places. Used at
     * wallet-creation time so the customer is asked for a clean,
     * paste-able number their wallet software can honour exactly. The
     * worst-case overpayment is 10^-$decimals GRC — well below
     * grcpay's MIN_FEE, so the funded processor silently absorbs it
     * instead of firing an overpayment refund.
     */
    public static function roundInvoiceGrc($grc, $decimals = 4)
    {
        $factor = pow(10, $decimals);
        return ceil(floatval($grc) * $factor) / $factor;
    }

    private $own_address = null;
    private $api_url = null;

    public function __construct($own_address, $api_url)
    {
        $this->own_address = $own_address;
        $this->api_url = rtrim($api_url, '/');
    }

    /**
     * Get GRC exchange rate via the payment proxy's /rates endpoint.
     * The proxy caches CoinGecko responses server-side (5 min TTL).
     */
    private function getRateViaProxy($currency)
    {
        $url = $this->api_url . '/rates/' . urlencode($currency);
        $response = wp_remote_get($url, [
            'headers' => ['Accept' => 'application/json'],
            'timeout' => 10,
        ]);

        if (is_wp_error($response)) {
            throw new Exception('Failed to fetch rate from payment proxy: ' . $response->get_error_message());
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response));

        if ($code !== 200 || empty($body->data->attributes->rate)) {
            $error = isset($body->errors[0]->title) ? $body->errors[0]->title : 'Unknown error';
            throw new Exception('Rate proxy error: ' . $error);
        }

        return (float)$body->data->attributes->rate;
    }

    /**
     * Get GRC exchange rate directly from CoinGecko.
     * Cached as a WP transient for 5 minutes.
     */
    private static function getRateViaCoinGecko($currency)
    {
        $cache_key = 'grcpay_rate_' . $currency;

        $cached = get_transient($cache_key);
        if ($cached !== false) {
            return (float)$cached;
        }

        $currencyId = 'gridcoin-research';
        $url = self::$coinGeckoApiBase . "simple/price?ids={$currencyId}&vs_currencies={$currency}";
        $response = wp_remote_get($url, [
            'headers' => ['Accept' => 'application/json'],
            'timeout' => 10,
        ]);

        if (is_wp_error($response)) {
            throw new Exception('Failed to fetch GRC rate from CoinGecko: ' . $response->get_error_message());
        }

        $rates = json_decode(wp_remote_retrieve_body($response), true);
        if (empty($rates[$currencyId][$currency])) {
            throw new Exception("Unable to fetch GRC rate for {$currency}");
        }

        $rate = (float)$rates[$currencyId][$currency];
        set_transient($cache_key, $rate, 5 * MINUTE_IN_SECONDS);

        return $rate;
    }

    /**
     * Convert a fiat price to GRC.
     *
     * @param float $price Fiat price
     * @param string $currency Fiat currency code (e.g. 'eur', 'usd')
     * @param bool $useProxy If true, fetch rate from grc-payment-proxy; otherwise from CoinGecko directly
     */
    public function convertPriceToGrc($price, $currency, $useProxy = true)
    {
        $currency = strtolower($currency);
        $rate = $useProxy
            ? $this->getRateViaProxy($currency)
            : self::getRateViaCoinGecko($currency);
        return $price / $rate;
    }

    /**
     * Create a payment wallet via grc-payment-proxy.
     * Returns the JSON:API data object (with id, attributes, etc.)
     */
    public function createWallet($requiredAmount)
    {
        if (empty($this->own_address)) {
            throw new Exception('Gridcoin receiving address is not configured');
        }

        $url = $this->api_url . '/wallets';
        $body = [
            'data' => [
                'type' => 'wallets',
                'attributes' => [
                    'amountRequired' => $requiredAmount,
                    'recipient' => $this->own_address,
                ],
            ]
        ];

        $result = wp_remote_post($url, [
            'headers' => [
                'Accept' => 'application/vnd.api+json',
                'Content-Type' => 'application/vnd.api+json',
            ],
            'body' => json_encode($body),
            'timeout' => 15,
        ]);

        if (is_wp_error($result)) {
            throw new GrcpayTransportException(
                'Failed to create payment wallet: ' . $result->get_error_message()
            );
        }

        $code = wp_remote_retrieve_response_code($result);
        // 5xx responses mean the proxy (or a reverse proxy in front of it)
        // is unhappy — same retryable category as a network error.
        if ($code >= 500 && $code < 600) {
            throw new GrcpayTransportException("Payment proxy returned HTTP {$code}");
        }

        $response = json_decode(wp_remote_retrieve_body($result));

        if ($code !== 201 || empty($response->data)) {
            $error = isset($response->errors[0]->title) ? $response->errors[0]->title : 'Unknown error';
            throw new Exception('Payment proxy error: ' . $error);
        }

        return $response->data;
    }

    /**
     * Get wallet status from grc-payment-proxy.
     *
     * grcpay gates wallet reads behind an X-Wallet-Token header. The token
     * is a one-time reveal returned in the POST /wallets response and is
     * persisted on the WC order as `grcpay_token` meta — pass it here.
     *
     * Returns the JSON:API data object, or null on any error (404, 401,
     * network failure). Callers are expected to treat null as "try again
     * later" so a transient blip doesn't flip an order to cancelled.
     */
    public function getWalletStatus($address, $token = null)
    {
        $url = $this->api_url . '/wallets/' . urlencode($address);

        $headers = ['Accept' => 'application/vnd.api+json'];
        if (!empty($token)) {
            $headers['X-Wallet-Token'] = $token;
        }

        $result = wp_remote_get($url, [
            'headers' => $headers,
            'timeout' => 10,
        ]);

        if (is_wp_error($result)) {
            return null;
        }

        $code = wp_remote_retrieve_response_code($result);
        if ($code !== 200) {
            return null;
        }

        $response = json_decode(wp_remote_retrieve_body($result));
        return isset($response->data) ? $response->data : null;
    }

    /**
     * Cancel a wallet (merchant-initiated) via DELETE /wallets/:address.
     * Requires the same X-Wallet-Token the read endpoint uses. grcpay flips
     * the wallet from `new → expired`, and its expired-refund job returns
     * any partial balance to the sender on the next cycle.
     *
     * Returns true on 204, false on any error.
     */
    public function cancelWallet($address, $token)
    {
        if (empty($address) || empty($token)) {
            return false;
        }

        $result = wp_remote_request($this->api_url . '/wallets/' . urlencode($address), [
            'method' => 'DELETE',
            'headers' => [
                'Accept' => 'application/vnd.api+json',
                'X-Wallet-Token' => $token,
            ],
            'timeout' => 10,
        ]);

        if (is_wp_error($result)) {
            return false;
        }
        return wp_remote_retrieve_response_code($result) === 204;
    }

    /**
     * Fetch QR code for a wallet address from grc-payment-proxy.
     * Returns base64 image data string or null.
     */
    public function getQrCode($address, $size = 300)
    {
        if (empty($address)) {
            return null;
        }

        $url = $this->api_url . '/wallets/' . urlencode($address) . '/qr?filter[width]=' . intval($size);

        $result = wp_remote_get($url, [
            'headers' => [
                'Accept' => 'application/vnd.api+json',
            ],
            'timeout' => 10,
        ]);

        if (is_wp_error($result)) {
            return null;
        }

        $response = json_decode(wp_remote_retrieve_body($result));
        if (isset($response->data->attributes->qr)) {
            return $response->data->attributes->qr;
        }

        return null;
    }

    /**
     * Format a number to a given number of significant figures.
     */
    public static function sig_fig($value, $digits)
    {
        if ($value == 0) {
            $decimalPlaces = $digits - 1;
        } elseif ($value < 0) {
            $decimalPlaces = $digits - floor(log10($value * -1)) - 1;
        } else {
            $decimalPlaces = $digits - floor(log10($value)) - 1;
        }

        return ($decimalPlaces > 0)
            ? number_format($value, $decimalPlaces, '.', '')
            : round($value, $decimalPlaces);
    }
}
