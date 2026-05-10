<?php

namespace Grcpay;

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
     * Fresh cache window — within this TTL we serve straight from the
     * transient and skip the HTTP round trip entirely. Matches the
     * grcpay-side cache so stacking the two layers doesn't create
     * weirder staleness than either layer alone.
     */
    private static $RATE_FRESH_TTL_SECONDS = 300;

    /**
     * Stale fallback window — used only when every live source fails.
     * 24h is long enough to sail through typical CoinGecko outages and
     * proxy restarts; past a day the price has drifted enough that
     * throwing is the safer option.
     */
    private static $RATE_STALE_TTL_SECONDS = 86400;

    private static function rateFreshKey($currency)
    {
        return 'grcpay_rate_' . $currency;
    }

    private static function rateStaleKey($currency)
    {
        return 'grcpay_rate_stale_' . $currency;
    }

    private static function readFreshRate($currency)
    {
        $cached = get_transient(self::rateFreshKey($currency));
        return $cached === false ? null : (float)$cached;
    }

    private static function readStaleRate($currency)
    {
        $cached = get_transient(self::rateStaleKey($currency));
        return $cached === false ? null : (float)$cached;
    }

    private static function cacheRate($currency, $rate)
    {
        set_transient(self::rateFreshKey($currency), $rate, self::$RATE_FRESH_TTL_SECONDS);
        set_transient(self::rateStaleKey($currency), $rate, self::$RATE_STALE_TTL_SECONDS);
    }

    /**
     * Get GRC exchange rate via the payment proxy's /rates endpoint.
     * Fetch-only; caller owns caching. Throws on any failure.
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
            $error = isset($body->errors[0]->title) ? $body->errors[0]->title : "HTTP {$code}";
            throw new Exception('Rate proxy error: ' . $error);
        }

        return (float)$body->data->attributes->rate;
    }

    /**
     * Get GRC exchange rate directly from CoinGecko.
     * Fetch-only; caller owns caching. Throws on any failure.
     */
    private static function getRateViaCoinGecko($currency)
    {
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

        return (float)$rates[$currencyId][$currency];
    }

    /**
     * Convert a fiat price to GRC.
     *
     * Resolution order:
     *   1. Fresh transient (same 5min window regardless of mode)
     *   2. Primary source for the selected mode (proxy or CoinGecko)
     *   3. In proxy mode, direct CoinGecko as a second-chance fallback —
     *      keeps checkout alive if grcpay itself is unreachable
     *   4. Stale transient (up to 24h old) — a slightly-off conversion
     *      is better than a broken Place Order button
     *   5. Throw only when every source has failed with no cached value
     *
     * @param float $price Fiat price
     * @param string $currency Fiat currency code (e.g. 'eur', 'usd')
     * @param bool $useProxy If true, fetch rate from grc-payment-proxy; otherwise from CoinGecko directly
     */
    public function convertPriceToGrc($price, $currency, $useProxy = true)
    {
        $currency = strtolower($currency);

        $fresh = self::readFreshRate($currency);
        if ($fresh !== null && $fresh > 0) {
            return $price / $fresh;
        }

        $errors = [];

        if ($useProxy) {
            try {
                $rate = $this->getRateViaProxy($currency);
                self::cacheRate($currency, $rate);
                return $price / $rate;
            } catch (Exception $e) {
                $errors[] = 'proxy: ' . $e->getMessage();
            }
        }

        try {
            $rate = self::getRateViaCoinGecko($currency);
            self::cacheRate($currency, $rate);
            return $price / $rate;
        } catch (Exception $e) {
            $errors[] = 'coingecko: ' . $e->getMessage();
        }

        $stale = self::readStaleRate($currency);
        if ($stale !== null && $stale > 0) {
            return $price / $stale;
        }

        throw new Exception('Unable to fetch GRC rate (' . implode('; ', $errors) . ')');
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
     * Strip everything that isn't a hex character. Applied to txids
     * coming from the grcpay JSON API before they cross any trust
     * boundary (rendered into payment.js, written to order notes,
     * embedded in emails) so a compromised proxy can't smuggle markup
     * past the consumers that treat the value as text.
     */
    public static function sanitizeTxid($value)
    {
        return is_string($value) ? preg_replace('/[^0-9a-fA-F]/', '', $value) : '';
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
