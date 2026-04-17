<?php

use CryptAPI\Helper;
use CryptAPI\GrcpayTransportException;

class WC_CryptAPI_Gateway extends WC_Payment_Gateway
{
    private static $HAS_TRIGGERED = false;

    private const CURRENCY = 'grc';
    private const CURRENCY_NAME = 'Gridcoin';
    private const MINIMUM_TX = 0.001;

    // Settings fields populated by ca_settings()
    private $api_url;
    private $api_url_backup;
    private $grc_address;
    private $qrcode_size;
    private $qrcode_default;
    private $show_branding;
    private $color_scheme;
    private $order_cancelation_timeout;
    private $virtual_complete;
    private $disable_conversion;
    private $use_proxy_rates;

    function __construct()
    {
        $this->id = 'cryptapi';
        $this->icon = '';
        $this->has_fields = true;
        $this->method_title = self::CURRENCY_NAME . ' Payment';
        $this->method_description = __('Accept Gridcoin (GRC) payments via grc-payment-proxy', 'cryptapi');

        $this->supports = ['products'];

        $this->init_form_fields();
        $this->init_settings();
        $this->ca_settings();

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        add_action('woocommerce_thankyou_' . $this->id, [$this, 'thankyou_page']);

        // Meta keys that hold per-order secrets or noisy base64 payloads
        // (wallet tokens, pinned backend URLs, rendered QR data URLs).
        // Marking them "protected" hides them from WordPress's generic
        // Custom Fields meta box in the order edit screen, so a
        // casual shop_manager can't copy the wallet token out of
        // wp-admin and replay it against grcpay. The plugin's own
        // flow never reads these through the Custom Fields UI — it
        // uses get_meta() directly, which ignores the protection
        // flag — so there's no functional downside.
        add_filter('is_protected_meta', [$this, 'mark_grcpay_meta_protected'], 10, 2);

        // AJAX status polling is dispatched at the top level in CryptAPI.php
        // so admin-ajax.php sees the handler without needing WC to have
        // instantiated this gateway. We only need the cron + cancellation
        // hooks here, where re-registering on each constructor run is fine.

        // WP-Cron hook for checking pending orders
        add_action('grcpay_check_pending_orders', [$this, 'check_pending_orders']);

        // Merchant-initiated order cancellation → cancel the grcpay wallet
        // too (DELETE /wallets/:address). grcpay flips new→expired and its
        // refund job returns any partial balance on the next cycle.
        add_action('woocommerce_order_status_cancelled', [$this, 'on_order_cancelled']);

        // Schedule cron if not already scheduled
        if (!wp_next_scheduled('grcpay_check_pending_orders')) {
            wp_schedule_event(time(), 'grcpay_interval', 'grcpay_check_pending_orders');
        }
    }

    private function ca_settings()
    {
        $this->enabled = $this->get_option('enabled');
        $this->title = $this->get_option('title');
        $this->description = $this->get_option('description');
        $this->api_url = $this->get_option('api_url');
        $this->api_url_backup = $this->get_option('api_url_backup');
        $this->grc_address = $this->get_option('grc_address');
        $this->qrcode_size = $this->get_option('qrcode_size');
        $this->qrcode_default = $this->get_option('qrcode_default') === 'yes';
        $this->show_branding = $this->get_option('show_branding') === 'yes';
        $this->color_scheme = $this->get_option('color_scheme');
        $this->order_cancelation_timeout = $this->get_option('order_cancelation_timeout');
        $this->virtual_complete = $this->get_option('virtual_complete') === 'yes';
        $this->disable_conversion = $this->get_option('disable_conversion') === 'yes';
        $this->use_proxy_rates = $this->get_option('use_proxy_rates') === 'yes';
    }

    function init_form_fields()
    {
        $this->form_fields = [
            'enabled' => [
                'title' => __('Enabled', 'cryptapi'),
                'type' => 'checkbox',
                'label' => __('Enable Gridcoin Payments', 'cryptapi'),
                'default' => 'yes',
            ],
            'title' => [
                'title' => __('Title', 'cryptapi'),
                'type' => 'text',
                'description' => __('Title shown during checkout.', 'cryptapi'),
                'default' => __('Gridcoin (GRC)', 'cryptapi'),
                'desc_tip' => true,
            ],
            'description' => [
                'title' => __('Description', 'cryptapi'),
                'type' => 'textarea',
                'default' => __('Pay with Gridcoin cryptocurrency.', 'cryptapi'),
                'description' => __('Description shown during checkout.', 'cryptapi'),
            ],
            'api_url' => [
                'title' => __('Payment Proxy URL', 'cryptapi'),
                'type' => 'text',
                'description' => __('URL of the grc-payment-proxy API. Use <code>https://grcpay.gridcoin.club</code> for the public test instance, or your own deployment (e.g. <code>http://grcpay:7001</code> for Docker).', 'cryptapi'),
                'default' => 'https://grcpay.gridcoin.club',
            ],
            'api_url_backup' => [
                'title' => __('Backup Payment Proxy URL', 'cryptapi'),
                'type' => 'text',
                'description' => __('Optional fallback URL. Used <strong>only</strong> when the primary URL is unreachable at wallet-creation time. Each order is pinned at creation to the server that minted its wallet, so orders already created on the primary cannot be moved — the backup only helps new checkouts ride through a primary outage. Leave blank to disable fallback.', 'cryptapi'),
                'default' => '',
            ],
            'grc_address' => [
                'title' => __('Gridcoin Address', 'cryptapi'),
                'type' => 'text',
                'description' => __('Your Gridcoin address where payments will be forwarded.', 'cryptapi'),
                'desc_tip' => true,
            ],
            'show_branding' => [
                'title' => __('Show Gridcoin branding', 'cryptapi'),
                'type' => 'checkbox',
                'label' => __('Show Gridcoin logo on the payment page', 'cryptapi'),
                'default' => 'yes',
            ],
            'qrcode_default' => [
                'title' => __('QR Code by default', 'cryptapi'),
                'type' => 'checkbox',
                'label' => __('Show the QR Code by default on the thank you page', 'cryptapi'),
                'default' => 'yes',
            ],
            'qrcode_size' => [
                'title' => __('QR Code size', 'cryptapi'),
                'type' => 'number',
                'default' => 300,
                'description' => __('QR code image size in pixels.', 'cryptapi'),
            ],
            'color_scheme' => [
                'title' => __('Color Scheme', 'cryptapi'),
                'type' => 'select',
                'default' => 'light',
                'description' => __('Color scheme for the payment UI.', 'cryptapi'),
                'options' => [
                    'light' => __('Light', 'cryptapi'),
                    'dark' => __('Dark', 'cryptapi'),
                    'auto' => __('Auto', 'cryptapi'),
                ],
            ],
            'order_cancelation_timeout' => [
                'title' => __('Order cancellation timeout', 'cryptapi'),
                'type' => 'select',
                'default' => '0',
                'options' => [
                    '0' => __('Never', 'cryptapi'),
                    '3600' => __('1 Hour', 'cryptapi'),
                    '21600' => __('6 Hours', 'cryptapi'),
                    '43200' => __('12 Hours', 'cryptapi'),
                    '86400' => __('24 Hours', 'cryptapi'),
                ],
                'description' => __('Cancel unpaid orders after this period.', 'cryptapi'),
            ],
            'virtual_complete' => [
                'title' => __('Auto-complete virtual orders', 'cryptapi'),
                'type' => 'checkbox',
                'label' => __('Mark orders with only virtual products as "completed" when payment is received.', 'cryptapi'),
                'default' => 'no',
            ],
            'disable_conversion' => [
                'title' => __('Disable price conversion', 'cryptapi'),
                'type' => 'checkbox',
                'label' => __('If checked, customers pay the exact shop price in GRC (no fiat-to-GRC conversion).', 'cryptapi'),
                'default' => 'no',
            ],
            'use_proxy_rates' => [
                'title' => __('Use proxy for exchange rates', 'cryptapi'),
                'type' => 'checkbox',
                'label' => __('Fetch GRC exchange rates from the payment proxy instead of CoinGecko directly. Recommended for production (avoids CoinGecko rate limits).', 'cryptapi'),
                'default' => 'yes',
            ],
        ];
    }

    function needs_setup()
    {
        return empty($this->grc_address) || empty($this->api_url);
    }

    public function get_icon()
    {
        if (!$this->show_branding) {
            return '';
        }
        // Inline style so the logo doesn't need cryptapi.css (which only
        // gets enqueued on the thank-you page, not on checkout):
        //   - vertical-align: middle keeps the logo on the same baseline
        //     as the radio button and label text
        //   - height: 1.4em scales the logo to match the current theme's
        //     line-height instead of the 50px HTML attribute, which
        //     dominates the row on most themes
        //   - width: auto preserves the logo's aspect ratio
        //   - margin-left adds breathing room after the payment method
        //     title ("Gridcoin (GRC)")
        $style = 'vertical-align:middle;height:1.4em;width:auto;margin-left:.5em;';
        $icon = '<img src="https://stamp.gridcoin.club/ic-logo-desktop.svg"'
            . ' alt="' . esc_attr($this->get_title()) . '"'
            . ' style="' . esc_attr($style) . '"'
            . ' />';
        return apply_filters('woocommerce_gateway_icon', $icon, $this->id);
    }

    function payment_fields()
    {
        if ($this->description) {
            echo '<p>' . esc_html($this->description) . '</p>';
        }
    }

    /**
     * Process a payment: create a wallet via grc-payment-proxy and redirect to thank you page.
     */
    function process_payment($order_id)
    {
        global $woocommerce;

        $order = new WC_Order($order_id);
        $total = $order->get_total('edit');

        if ($total == 0) {
            $order->payment_complete();
            $woocommerce->cart->empty_cart();
            return [
                'result' => 'success',
                'redirect' => $this->get_return_url($order),
            ];
        }

        try {
            $currency = get_woocommerce_currency();
            $min_tx = Helper::sig_fig(self::MINIMUM_TX, 6);

            // Rate conversion runs against the primary URL only — it's a
            // cheap read that doesn't mint state, and there's nothing to
            // pin yet. If the primary is down for this call the fallback
            // loop below will retry wallet creation on the backup URL,
            // and the rate we just computed is still correct (grcpay uses
            // CoinGecko under the hood regardless of which instance asks).
            $helper = new Helper($this->grc_address, $this->api_url);

            if ($this->disable_conversion) {
                $crypto_total = $total;
            } else {
                $crypto_total = $helper->convertPriceToGrc($total, $currency, $this->use_proxy_rates);
            }

            $crypto_total = Helper::roundInvoiceGrc($crypto_total, 4);

            if ($crypto_total < $min_tx) {
                wc_add_notice(
                    __('Payment error:', 'cryptapi') . ' ' .
                    __('Value too low, minimum is', 'cryptapi') . ' ' . $min_tx . ' GRC',
                    'error'
                );
                return null;
            }

            $candidate_urls = $this->get_candidate_urls();

            // Refuse to send wallet tokens in plaintext over untrusted
            // networks. Any HTTP URL pointing at something other than a
            // loopback / RFC1918 / docker-style host would leak the
            // X-Wallet-Token header on every subsequent poll. See
            // is_insecure_api_url for the full allow-list.
            foreach ($candidate_urls as $check_url) {
                if ($this->is_insecure_api_url($check_url)) {
                    wc_add_notice(
                        __('Payment error:', 'cryptapi') . ' ' . sprintf(
                            // translators: %s is the configured backend URL.
                            __('The configured grcpay backend %s uses plaintext HTTP, which would leak your wallet credentials. Switch to HTTPS in the payment gateway settings before accepting real payments.', 'cryptapi'),
                            esc_html($check_url)
                        ),
                        'error'
                    );
                    return null;
                }
            }

            // Try each candidate in order. A transport failure (network
            // error, timeout, 5xx) on one moves us to the next; a
            // deterministic proxy error (400 bad request, invalid
            // address, etc.) surfaces immediately because retrying
            // against a different backend won't change the answer.
            $wallet = null;
            $pinned_url = null;
            $last_transport_error = null;
            foreach ($candidate_urls as $candidate_url) {
                $helper = new Helper($this->grc_address, $candidate_url);
                try {
                    $wallet = $helper->createWallet($crypto_total);
                    $pinned_url = $candidate_url;
                    break;
                } catch (GrcpayTransportException $e) {
                    $last_transport_error = $e;
                    continue;
                }
            }

            if ($wallet === null) {
                throw $last_transport_error
                    ?: new \Exception('No grcpay backends configured');
            }

            $address = $wallet->attributes->address;
            // One-time reveal of the wallet token from grcpay. Every
            // subsequent GET /wallets/:address and DELETE /wallets/:address
            // must send it in the X-Wallet-Token header. grcpay only stores
            // a SHA-256 hash server-side, so losing this means the wallet
            // becomes read-only via the public QR endpoint forever.
            $token = isset($wallet->attributes->token) ? $wallet->attributes->token : '';

            if (empty($address)) {
                wc_add_notice(__('Payment error:', 'cryptapi') . ' ' . __('Failed to generate payment address. Please try again.', 'cryptapi'), 'error');
                return null;
            }

            // Fetch QR code from the same backend that minted the wallet —
            // $helper is already pointed at the pinned URL from the loop.
            $qr_code = $helper->getQrCode($address, (int)$this->qrcode_size);

            // Store payment metadata on the order
            $order->update_meta_data('grcpay_address', $address);
            $order->update_meta_data('grcpay_token', $token);
            // Pin the backend URL that minted this wallet. Every
            // subsequent plugin ↔ grcpay call for this order (status
            // poll, merchant cancel, cron background check) must hit
            // the same server — grcpay is not horizontally replicated,
            // the wallet's private key and token hash live in ONE
            // instance. Reading this meta per-order lets the plugin
            // keep working even if the gateway setting is later
            // changed or a backup URL was used at creation time.
            $order->update_meta_data('grcpay_api_url', $pinned_url);
            $order->update_meta_data('grcpay_total', Helper::sig_fig($crypto_total, 6));
            $order->update_meta_data('grcpay_total_fiat', $total);
            $order->update_meta_data('grcpay_currency', self::CURRENCY);
            $order->update_meta_data('grcpay_qr_code', $qr_code);
            $order->update_meta_data('grcpay_min', $min_tx);
            $order->save_meta_data();

            if ($pinned_url !== $this->api_url) {
                $order->add_order_note(sprintf(
                    // translators: %s is the fallback grcpay URL
                    __('Primary grcpay backend was unreachable at checkout; order was minted against the fallback backend %s. Status polling will remain pinned to the fallback for the life of this order.', 'cryptapi'),
                    $pinned_url
                ));
            }

            $order->update_status('on-hold', __('Awaiting Gridcoin payment', 'cryptapi'));
            $woocommerce->cart->empty_cart();

            return [
                'result' => 'success',
                'redirect' => $this->get_return_url($order),
            ];
        } catch (Exception $e) {
            wc_add_notice(__('Payment error:', 'cryptapi') . ' ' . $e->getMessage(), 'error');
            return null;
        }
    }

    /**
     * AJAX handler: polls grc-payment-proxy for wallet status and updates the order.
     */
    function order_status()
    {
        $order_id = isset($_REQUEST['order_id']) ? absint($_REQUEST['order_id']) : 0;

        if (!$order_id) {
            status_header(400);
            wp_send_json(['status' => 'error', 'error' => 'Missing order_id']);
        }

        // Per-order nonce gate. Without this the endpoint is a
        // "read arbitrary order state by ID" oracle — a competitor
        // could enumerate every grcpay-paid order on the store by
        // walking sequential IDs and reading back amounts, wallet
        // addresses, and payment status. Nonce is keyed to the
        // specific order_id so a captured one can't walk sideways.
        $nonce = isset($_REQUEST['_wpnonce']) ? sanitize_text_field(wp_unslash($_REQUEST['_wpnonce'])) : '';
        if (!wp_verify_nonce($nonce, self::nonce_action_for_order($order_id))) {
            status_header(403);
            wp_send_json(['status' => 'error', 'error' => 'Invalid or expired nonce']);
        }

        try {
            $order = new WC_Order($order_id);
            $address = $order->get_meta('grcpay_address');
            $token = $order->get_meta('grcpay_token');

            if (empty($address)) {
                wp_send_json(['status' => 'error', 'error' => 'No payment address found']);
            }

            // Always use the server that minted this wallet (see
            // process_payment → grcpay_api_url meta). Legacy orders
            // from before pin-per-order landed don't have the meta,
            // so fall back to the current gateway setting — best
            // effort, matches old behaviour for already-running orders.
            $order_api_url = $order->get_meta('grcpay_api_url') ?: $this->api_url;
            $helper = new Helper($this->grc_address, $order_api_url);
            $wallet = $helper->getWalletStatus($address, $token);

            $flags = $this->reconcile_order_from_wallet($order, $wallet);
            $is_paid = $flags['is_paid'];
            $is_pending = $flags['is_pending'];
            $cancelled = $flags['cancelled'];
            $proxy_error = $flags['proxy_error'];

            $proxy_status = $wallet ? ($wallet->attributes->status ?? '') : '';
            $amount_received_grc = $wallet ? Helper::halfordToGrc($wallet->attributes->amountRecieved ?? 0) : 0;
            $amount_pending_grc = $wallet ? Helper::halfordToGrc($wallet->attributes->amountPending ?? 0) : 0;
            $refund_tx = $wallet ? ($wallet->attributes->refundTx ?? '') : '';
            $refund_amount_grc = $wallet ? Helper::halfordToGrc($wallet->attributes->refundAmount ?? 0) : 0;

            // Merchant-configured cancellation timeout — independent of
            // grcpay's LIFE_SPAN so the plugin can enforce a tighter one.
            if (!$is_paid && !$cancelled && intval($this->order_cancelation_timeout) > 0) {
                $created = $order->get_date_created()->getTimestamp();
                if ((time() - $created) > intval($this->order_cancelation_timeout)) {
                    if ($order->get_status() !== 'cancelled') {
                        $order->update_status('cancelled', __('Order cancelled: payment timeout.', 'cryptapi'));
                    }
                    $cancelled = true;
                }
            }

            // --- Amount math ---
            //
            // grcpay is the source of truth for both amountRequired and
            // amountRecieved. The old code used to run a "refresh the
            // fiat→GRC rate every N minutes" loop against grcpay_total
            // meta, but grcpay has no API to update amountRequired on an
            // existing wallet, so the plugin would silently drift away
            // from what grcpay actually wanted — customer sends the
            // plugin's displayed amount, grcpay never sees enough, wallet
            // stays `new`, order never flips to paid. Freezing the total
            // at order creation + trusting grcpay on every poll is the
            // only correct behaviour.
            $fiat_total = floatval($order->get_meta('grcpay_total_fiat'));
            $crypto_total = floatval($order->get_meta('grcpay_total'));
            if ($wallet && isset($wallet->attributes->amountRequired)) {
                $crypto_total = Helper::halfordToGrc($wallet->attributes->amountRequired);
                // Heal stale meta from pre-fix orders or manual tweaks so
                // the initially-rendered template also shows the right
                // number after a page reload.
                $stored = floatval($order->get_meta('grcpay_total'));
                if (abs($stored - $crypto_total) > 0.0000001) {
                    $order->update_meta_data('grcpay_total', Helper::sig_fig($crypto_total, 6));
                    $order->save_meta_data();
                }
            }

            $already_paid = isset($amount_received_grc) ? $amount_received_grc : 0;
            // Clamp tiny float residuals to zero. Happens when grcpay's
            // amountRequired and amountRecieved differ by a handful of
            // halfords from float→halford→float round-trips — the user
            // sent the full amount but PHP's subtraction leaves a
            // nanogram of dust that otherwise renders as "$2.3e-9" in
            // the fiat column. 1e-7 GRC is four orders of magnitude
            // below MIN_TX, so treating it as zero is safe.
            $remaining = max(0, $crypto_total - $already_paid);
            if ($remaining < 1e-7) {
                $remaining = 0;
            }
            $remaining_ratio = $crypto_total > 0 ? $remaining / $crypto_total : 0;
            $fiat_remaining = max(0, $fiat_total * $remaining_ratio);

            // grcpay's /wallets/:id/qr encodes `amountRequired - amountRecieved`
            // on its side. Only refetch when the received amount actually
            // changed — otherwise we'd burn one HTTP call per poll forever
            // even though the QR payload is identical to last time.
            $qr_code_value = $order->get_meta('grcpay_qr_code');
            $last_received = floatval($order->get_meta('grcpay_last_seen_received'));
            if (!$is_paid && !$cancelled && abs($last_received - $already_paid) > 1e-7) {
                $fresh_qr = $helper->getQrCode($address, (int)$this->qrcode_size);
                if (!empty($fresh_qr)) {
                    $qr_code_value = $fresh_qr;
                    $order->update_meta_data('grcpay_qr_code', $fresh_qr);
                }
                $order->update_meta_data('grcpay_last_seen_received', $already_paid);
                $order->save_meta_data();
            }

            // Fiat amounts go through number_format so PHP can never
            // json_encode them as scientific notation ("$2.3e-9") — a
            // sub-cent residual just renders as "0.00" in the UI.
            $fiat_remaining_str = number_format(round($fiat_remaining, 2), 2, '.', '');
            $already_paid_fiat_str = number_format(round($fiat_total - $fiat_remaining, 2), 2, '.', '');

            wp_send_json([
                'is_paid' => $is_paid,
                'is_pending' => $is_pending,
                'cancelled' => $cancelled,
                'coin' => strtoupper(self::CURRENCY),
                'crypto_total' => $crypto_total,
                'already_paid' => Helper::sig_fig($already_paid, 6),
                'remaining' => Helper::sig_fig($remaining, 6),
                'qr_code_value' => $qr_code_value,
                'fiat_remaining' => $fiat_remaining_str,
                'already_paid_fiat' => $already_paid_fiat_str,
                'fiat_symbol' => get_woocommerce_currency_symbol(),
                'show_min_fee' => ($already_paid > 0 && $remaining > 0) ? 1 : 0,
                // Amount seen at 0-conf that hasn't settled yet. Non-zero
                // when a customer's tx is in the mempool or has landed in
                // a block but hasn't reached MIN_CONFIRMATIONS. Plugin JS
                // surfaces this as a "waiting for N confirmations" notice.
                'pending_amount' => Helper::sig_fig($amount_pending_grc, 6),
                'has_pending' => ($amount_pending_grc > 0) ? 1 : 0,
                // Raw grcpay wallet status. Used by payment.js to pick
                // the right reassurance banner: `new` → "please send",
                // `confirming` → "on chain, almost there", `funded` or
                // `processed` → "payment confirmed", `expired` /
                // `norefund` → "window elapsed", `refunded` → "window
                // elapsed, refund sent", `error` → "something went
                // wrong on our side".
                'proxy_status' => $proxy_status,
                'is_confirming' => ($proxy_status === 'confirming') ? 1 : 0,
                'is_refunded' => ($proxy_status === 'refunded') ? 1 : 0,
                'is_error' => $proxy_error ? 1 : 0,
                'refund_tx' => $refund_tx,
                'refund_amount' => $refund_amount_grc > 0
                    ? Helper::sig_fig($refund_amount_grc, 6)
                    : '',
            ]);

        } catch (Exception $e) {
            wp_send_json(['status' => 'error', 'error' => $e->getMessage()]);
        }
    }

    /**
     * When a merchant cancels a gridcoin-paid order, cancel the grcpay
     * wallet too so its expired-refund flow returns any partial balance
     * to the sender on the next job cycle. No-op if the order wasn't
     * paid via this gateway or the token/address are missing.
     */
    function on_order_cancelled($order_id)
    {
        $order = wc_get_order($order_id);
        if (!$order || $order->get_payment_method() !== $this->id) {
            return;
        }
        $address = $order->get_meta('grcpay_address');
        $token = $order->get_meta('grcpay_token');
        if (empty($address) || empty($token)) {
            return;
        }

        $order_api_url = $order->get_meta('grcpay_api_url') ?: $this->api_url;
        $helper = new Helper($this->grc_address, $order_api_url);
        $ok = $helper->cancelWallet($address, $token);
        $order->add_order_note(
            $ok
                ? __('Gridcoin wallet cancelled at grcpay — refund flow queued.', 'cryptapi')
                : __('Failed to cancel the Gridcoin wallet at grcpay — the refund flow will still trigger when the wallet expires naturally.', 'cryptapi')
        );
    }

    /**
     * WP-Cron: check all on-hold orders for payment completion.
     */
    function check_pending_orders()
    {
        $orders = wc_get_orders([
            'status' => 'on-hold',
            'payment_method' => $this->id,
            'limit' => 50,
        ]);

        if (empty($orders)) {
            return;
        }

        $context = __('(detected via background check)', 'cryptapi');
        foreach ($orders as $order) {
            $address = $order->get_meta('grcpay_address');
            $token = $order->get_meta('grcpay_token');
            if (empty($address)) {
                continue;
            }

            // Each order is pinned to the grcpay backend that minted its
            // wallet — build a per-order Helper so a store with both
            // primary-minted and fallback-minted orders in flight polls
            // each one against its correct server.
            $order_api_url = $order->get_meta('grcpay_api_url') ?: $this->api_url;
            $helper = new Helper($this->grc_address, $order_api_url);

            $wallet = $helper->getWalletStatus($address, $token);
            if (!$wallet) {
                continue;
            }

            $this->reconcile_order_from_wallet($order, $wallet, $context);

            // Merchant-configured cancellation timeout, independent of
            // grcpay's own LIFE_SPAN.
            if (!$order->is_paid() && $order->get_status() !== 'cancelled' && intval($this->order_cancelation_timeout) > 0) {
                $created = $order->get_date_created()->getTimestamp();
                if ((time() - $created) > intval($this->order_cancelation_timeout)) {
                    $order->update_status('cancelled', __('Order cancelled: payment timeout.', 'cryptapi'));
                }
            }
        }
    }

    /**
     * Ordered list of grcpay backend URLs the plugin is willing to
     * talk to when MINTING a new wallet. The list is tried in order
     * on transport failure until one succeeds; whichever URL wins
     * gets pinned onto the order as `grcpay_api_url` meta and is
     * used for every subsequent call about that order (status poll,
     * QR refresh, merchant cancel).
     *
     * Today this returns exactly [primary, backup]. When multi-backend
     * support lands (round-robin, N-way, health-cached) this is the
     * one method that changes — callers just iterate whatever comes
     * back, so the pin-per-order and retry-on-transport-error behaviour
     * stays the same. array_filter drops empty slots and array_unique
     * dedupes the (rare) case of both fields pointing at the same URL.
     */
    private function get_candidate_urls(): array
    {
        return array_values(array_unique(array_filter([
            $this->api_url,
            $this->api_url_backup,
        ])));
    }

    /**
     * Stable nonce action name for a given order. Scoped per-order so
     * a captured nonce only works for that one order — an attacker
     * can't take a nonce from the customer's thankyou page and then
     * sweep it across every other order_id in the store.
     */
    private static function nonce_action_for_order($order_id)
    {
        return 'grcpay_order_status_' . intval($order_id);
    }

    /**
     * `is_protected_meta` filter callback. Hides per-order secrets
     * from WordPress's generic Custom Fields meta box without
     * affecting `$order->get_meta()` access from plugin code.
     */
    public function mark_grcpay_meta_protected($protected, $meta_key)
    {
        static $hidden = [
            'grcpay_token'    => true,
            'grcpay_api_url'  => true,
            'grcpay_qr_code'  => true,
        ];
        if (isset($hidden[$meta_key])) {
            return true;
        }
        return $protected;
    }

    /**
     * Override the gateway's settings-screen output so the insecure-URL
     * warning appears above the form whenever the merchant has a
     * plaintext HTTP URL configured for anything other than a loopback
     * / RFC1918 / docker-style host. Stacks on top of WC's default
     * `admin_options()` output — we're not replacing it, just
     * prepending a notice.
     */
    public function admin_options()
    {
        $warnings = [];
        foreach (['api_url', 'api_url_backup'] as $field) {
            $candidate = $this->get_option($field);
            if ($this->is_insecure_api_url($candidate)) {
                $warnings[] = sprintf(
                    // translators: 1: field label, 2: configured URL
                    __('%1$s is set to <code>%2$s</code>, which uses plaintext HTTP. Wallet tokens would be sent in the clear on every polling tick and any network observer could read or cancel orders. Switch to HTTPS before accepting real payments.', 'cryptapi'),
                    esc_html($field === 'api_url' ? __('Payment Proxy URL', 'cryptapi') : __('Backup Payment Proxy URL', 'cryptapi')),
                    esc_html($candidate)
                );
            }
        }
        if (!empty($warnings)) {
            echo '<div class="notice notice-error" style="margin:10px 0;padding:12px 16px;">';
            echo '<p><strong>' . esc_html__('Gridcoin Payment Gateway — security warning', 'cryptapi') . '</strong></p>';
            echo '<ul style="margin-left:1em;list-style:disc;">';
            foreach ($warnings as $warning) {
                echo '<li>' . wp_kses($warning, ['code' => []]) . '</li>';
            }
            echo '</ul>';
            echo '</div>';
        }
        parent::admin_options();
    }

    /**
     * Decide whether a grcpay URL is safe to use over plain HTTP.
     *
     * Wallet tokens are sent in the X-Wallet-Token header on every
     * poll and cancel call. Over HTTP that header is visible to
     * anyone on the network path — ISPs, router compromises, shared
     * WiFi — and a captured token lets the eavesdropper read and
     * cancel the wallet at will. So plain HTTP is only acceptable
     * for loopback / docker-style private addresses where the
     * network boundary is already trusted:
     *
     *   - localhost / 127.x / ::1 (loopback)
     *   - RFC1918 private ranges (home/office LANs)
     *   - *.local (mDNS / link-local)
     *   - Bare hostnames with no dots (docker service names)
     *
     * Anything else — public DNS, cloud hostnames, IP literals
     * outside RFC1918 — must be HTTPS. HTTPS URLs always pass.
     *
     * Returns false for "safe to use" and true for "rejected".
     */
    private static function is_insecure_api_url($url)
    {
        if (empty($url)) {
            return false;
        }
        $parts = wp_parse_url($url);
        if (empty($parts['scheme']) || empty($parts['host'])) {
            // Malformed. Let the downstream HTTP client fail on its
            // own rather than pretending the URL is "secure".
            return false;
        }
        if (strtolower($parts['scheme']) === 'https') {
            return false;
        }
        if (strtolower($parts['scheme']) !== 'http') {
            // file:// or similar — not our problem, let it through
            // and fail elsewhere.
            return false;
        }
        $host = strtolower($parts['host']);
        if ($host === 'localhost' || $host === '::1') {
            return false;
        }
        if (preg_match('/^127\./', $host)) {
            return false;
        }
        // RFC1918 private IPv4 ranges.
        if (preg_match('/^10\./', $host)) {
            return false;
        }
        if (preg_match('/^192\.168\./', $host)) {
            return false;
        }
        if (preg_match('/^172\.(1[6-9]|2[0-9]|3[0-1])\./', $host)) {
            return false;
        }
        if (preg_match('/\.local$/', $host)) {
            return false;
        }
        // Bare docker-style hostname (no dots, not an IP literal).
        if (strpos($host, '.') === false && !preg_match('/^[0-9.]+$/', $host)) {
            return false;
        }
        return true;
    }

    /**
     * Apply a grcpay wallet state to a WC order. Single source of truth
     * for the status transition table — both the AJAX poll
     * (order_status) and the WP-Cron background check
     * (check_pending_orders) call through here so the two paths can't
     * drift. Returns a flags array the caller can lift straight into
     * its JSON response, or ignore for cron.
     *
     * $context is a short suffix appended to order notes so an operator
     * can later tell which path detected the transition (empty for the
     * AJAX poll, "(detected via background check)" for cron).
     */
    private function reconcile_order_from_wallet($order, $wallet, $context = '')
    {
        $flags = [
            'is_paid' => $order->is_paid(),
            'is_pending' => false,
            'cancelled' => false,
            'proxy_error' => false,
        ];
        if (!$wallet) {
            return $flags;
        }

        $proxy_status = $wallet->attributes->status ?? '';
        $amount_received_grc = Helper::halfordToGrc($wallet->attributes->amountRecieved ?? 0);
        $suffix = $context ? ' ' . $context : '';

        switch ($proxy_status) {
            case 'funded':
            case 'processed':
                if (!$flags['is_paid']) {
                    $order->payment_complete($order->get_meta('grcpay_address'));
                    $order->add_order_note(
                        __('Gridcoin payment confirmed.', 'cryptapi') . $suffix
                        . ' ' . $amount_received_grc . ' GRC received.'
                    );
                    if ($this->virtual_complete && $this->is_all_virtual($order)) {
                        $order->update_status('completed');
                    }
                    $order->save();
                    $flags['is_paid'] = true;
                }
                break;

            case 'new':
                if ($amount_received_grc > 0) {
                    $flags['is_pending'] = true;
                }
                break;

            case 'confirming':
                // No-op — is_confirming in the JSON response drives the
                // thank-you UI; WC order stays on-hold until `funded`.
                break;

            case 'expired':
            case 'norefund':
                if ($order->get_status() !== 'cancelled') {
                    $order->update_status(
                        'cancelled',
                        __('Gridcoin payment window elapsed without a sufficient payment. Wallet has been expired at grcpay.', 'cryptapi') . $suffix
                    );
                    $order->save();
                }
                $flags['cancelled'] = true;
                break;

            case 'refunded':
                if ($order->get_status() !== 'cancelled') {
                    $note = __('Gridcoin payment window elapsed with a partial balance.', 'cryptapi') . $suffix;
                    $refund_amount_grc = Helper::halfordToGrc($wallet->attributes->refundAmount ?? 0);
                    if ($refund_amount_grc > 0) {
                        $note .= ' ' . sprintf(
                            // translators: 1: refund amount in GRC, 2: refund tx id
                            __('grcpay refunded %1$s GRC to the original sender (tx %2$s).', 'cryptapi'),
                            Helper::sig_fig($refund_amount_grc, 6),
                            $wallet->attributes->refundTx ?? ''
                        );
                    }
                    $order->update_status('cancelled', $note);
                    $order->save();
                }
                $flags['cancelled'] = true;
                break;

            case 'error':
                // Leave the order on-hold so a human can investigate.
                // Idempotent via the grcpay_error_noted meta flag —
                // otherwise every poll would spam the order timeline.
                if (!$order->get_meta('grcpay_error_noted')) {
                    $order->add_order_note(
                        __('grcpay wallet entered error state — please inspect. The WC order is left on-hold so an operator can decide whether to complete or cancel manually.', 'cryptapi') . $suffix
                    );
                    $order->update_meta_data('grcpay_error_noted', '1');
                    $order->save();
                }
                $flags['proxy_error'] = true;
                break;
        }

        return $flags;
    }

    /**
     * Check if all items in an order are virtual products.
     */
    private function is_all_virtual($order)
    {
        foreach ($order->get_items() as $item) {
            $product = wc_get_product($item->get_product_id());
            if ($product && !$product->is_virtual()) {
                return false;
            }
        }
        return true;
    }

    /**
     * Thank you page: renders the payment UI with QR code, address, and status polling.
     */
    function thankyou_page($order_id)
    {
        if (self::$HAS_TRIGGERED) {
            return;
        }
        self::$HAS_TRIGGERED = true;

        $order = new WC_Order($order_id);
        $total = $order->get_total();
        $currency_symbol = get_woocommerce_currency_symbol();
        $address_in = $order->get_meta('grcpay_address');
        $crypto_value = $order->get_meta('grcpay_total');
        $crypto_coin = $order->get_meta('grcpay_currency');
        $qr_code_img = $order->get_meta('grcpay_qr_code');
        $color_scheme = $this->color_scheme;
        $min_tx = $order->get_meta('grcpay_min');

        // Per-order nonce on the AJAX polling URL. Without this anyone
        // who can reach wp-admin/admin-ajax.php can enumerate the
        // plaintext wallet state of every order in the store by
        // walking sequential order IDs — addresses, amounts, paid
        // status, refund tx, everything. The nonce is scoped to this
        // specific order_id so a captured one can't be replayed
        // against other orders, and WP's default 24h nonce lifetime
        // covers any realistic checkout session.
        $ajax_nonce = wp_create_nonce(self::nonce_action_for_order($order_id));

        $ajax_url = add_query_arg([
            'action'   => 'cryptapi_order_status',
            'order_id' => $order_id,
            '_wpnonce' => $ajax_nonce,
        ], admin_url('admin-ajax.php'));

        // Version the JS + CSS by file mtime so any edit auto-busts the
        // browser cache. Without this, WordPress appends a static
        // CRYPTAPI_PLUGIN_VERSION query string and a user who loaded the
        // thankyou page before a plugin update keeps getting the old
        // payment.js from their cache — which has historically masked
        // real bugs (e.g. the confirming-state banner never appearing
        // because the cached JS didn't know about is_confirming).
        // filemtime falls back to the constant if the file is missing.
        $js_path = CRYPTAPI_PLUGIN_PATH . 'static/payment.js';
        $css_path = CRYPTAPI_PLUGIN_PATH . 'static/cryptapi.css';
        $js_ver = file_exists($js_path) ? filemtime($js_path) : CRYPTAPI_PLUGIN_VERSION;
        $css_ver = file_exists($css_path) ? filemtime($css_path) : CRYPTAPI_PLUGIN_VERSION;

        wp_enqueue_script('ca-payment', CRYPTAPI_PLUGIN_URL . 'static/payment.js', ['jquery'], $js_ver, true);
        // wp_json_encode emits a proper double-quoted JS string literal and
        // does NOT HTML-entity-encode ampersands. The previous esc_js() call
        // was turning "&order_id" into "&amp;order_id", so the browser sent
        // `?action=cryptapi_order_status&amp;order_id=22` — PHP then parsed
        // it as {action, "amp;order_id"} and $_REQUEST['order_id'] was empty,
        // which made order_status() bail out early with "Missing order_id"
        // and broke all DOM updates on the thank-you page (amount, QR,
        // countdown, partial payment notice). See the comment in payment.js
        // for the downstream effect.
        wp_add_inline_script('ca-payment', "jQuery(function() { var ajax_url = " . wp_json_encode($ajax_url) . "; setTimeout(function(){ check_status(ajax_url) }, 500) })");
        wp_enqueue_style('ca-loader-css', CRYPTAPI_PLUGIN_URL . 'static/cryptapi.css', false, $css_ver);

        $cancel_timer = $order->get_date_created()->getTimestamp() + (int)$this->order_cancelation_timeout - time();

        ?>
        <div class="ca_payment-panel <?php
            if ($color_scheme === 'auto') echo 'auto';
            elseif ($color_scheme === 'dark') echo 'dark';
            else echo 'light';
        ?>">
            <div class="ca_payment_details">
                <?php if ($total > 0) { ?>
                    <div class="ca_payments_wrapper">
                        <div class="ca_qrcode_wrapper" style="<?php echo $this->qrcode_default ? 'display:block' : 'display:none'; ?>; width: <?php echo intval($this->qrcode_size) + 20; ?>px;">
                            <div class="inner-wrapper">
                                <figure>
                                    <?php if ($qr_code_img) { ?>
                                        <img class="ca_qrcode" width="<?php echo intval($this->qrcode_size); ?>" src="<?php echo esc_attr($qr_code_img); ?>" alt="<?php echo esc_attr__('QR Code', 'cryptapi'); ?>" />
                                    <?php } ?>
                                </figure>
                            </div>
                        </div>
                        <div class="ca_details_box">
                            <div class="ca_details_text">
                                <?php echo esc_html__('PLEASE SEND', 'cryptapi'); ?>
                                <button class="ca_copy ca_details_copy" data-tocopy="<?php echo esc_attr($crypto_value); ?>">
                                    <span><b class="ca_value"><?php echo esc_html($crypto_value); ?></b></span>
                                    <span><b><?php echo esc_html(strtoupper($crypto_coin)); ?></b></span>
                                    <span class="ca_tooltip ca_copy_icon_tooltip tip"><?php echo esc_html__('COPY', 'cryptapi'); ?></span>
                                    <span class="ca_tooltip ca_copy_icon_tooltip success" style="display:none"><?php echo esc_html__('COPIED!', 'cryptapi'); ?></span>
                                </button>
                                <strong>(<?php echo esc_html($currency_symbol) . ' <span class="ca_fiat_total">' . esc_html($total) . '</span>'; ?>)</strong>
                            </div>

                            <div class="ca_payment_notification ca_notification_payment_received" style="display:none;">
                                <?php echo sprintf(
                                    esc_html__('So far you sent %s. Please send a new payment to complete the order.', 'cryptapi'),
                                    '<strong><span class="ca_notification_ammount"></span></strong>'
                                ); ?>
                            </div>

                            <div class="ca_payment_notification ca_notification_pending_confs" style="display:none;">
                                <?php echo sprintf(
                                    esc_html__('We detected %s on its way. Waiting for it to confirm on the blockchain — no action needed from you.', 'cryptapi'),
                                    '<strong><span class="ca_pending_amount"></span></strong>'
                                ); ?>
                            </div>

                            <div class="ca_payment_notification ca_notification_confirming" style="display:none;">
                                <div class="ca_confirming_spinner" aria-hidden="true"></div>
                                <div class="ca_confirming_text">
                                    <strong><?php esc_html_e('Payment detected on-chain — waiting for confirmations.', 'cryptapi'); ?></strong>
                                    <br/>
                                    <?php esc_html_e('Your full payment has arrived at the network level. We just need a few more blocks to be absolutely sure before the order is marked paid. This usually takes a couple of minutes — you can safely close this tab, the order will update itself.', 'cryptapi'); ?>
                                </div>
                            </div>

                            <div class="ca_payment_notification ca_notification_remaining" style="display:none">
                                <strong><?php echo esc_html__('Notice', 'cryptapi'); ?></strong>:
                                <?php echo sprintf(
                                    esc_html__('Minimum transaction is %s, value has been adjusted.', 'cryptapi'),
                                    esc_html($min_tx . ' ' . strtoupper($crypto_coin))
                                ); ?>
                            </div>

                            <div class="ca_details_input">
                                <span><?php echo esc_html($address_in); ?></span>
                                <button class="ca_copy ca_copy_icon" data-tocopy="<?php echo esc_attr($address_in); ?>">
                                    <span class="ca_tooltip ca_copy_icon_tooltip tip"><?php echo esc_html__('COPY', 'cryptapi'); ?></span>
                                    <span class="ca_tooltip ca_copy_icon_tooltip success" style="display:none"><?php echo esc_html__('COPIED!', 'cryptapi'); ?></span>
                                </button>
                                <div class="ca_loader"></div>
                            </div>
                        </div>

                        <?php if (intval($this->order_cancelation_timeout) > 0) { ?>
                            <span class="ca_notification_cancel" data-text="<?php echo esc_attr__('Order will be cancelled in less than a minute.', 'cryptapi'); ?>">
                                <?php echo sprintf(
                                    esc_html__('This order will be valid for %s', 'cryptapi'),
                                    '<strong><span class="ca_cancel_timer" data-timestamp="' . esc_attr($cancel_timer) . '">' . esc_html(gmdate('H:i', max(0, $cancel_timer))) . '</span></strong>'
                                ); ?>
                            </span>
                        <?php } ?>

                        <div class="ca_buttons_container">
                            <a class="ca_show_qr" href="#" aria-label="<?php echo esc_attr__('Toggle QR code', 'cryptapi'); ?>">
                                <span class="ca_show_qr_open<?php echo !$this->qrcode_default ? ' active' : ''; ?>"><?php echo esc_html__('Open QR CODE', 'cryptapi'); ?></span>
                                <span class="ca_show_qr_close<?php echo $this->qrcode_default ? ' active' : ''; ?>"><?php echo esc_html__('Close QR CODE', 'cryptapi'); ?></span>
                            </a>
                        </div>

                        <?php if ($this->show_branding) { ?>
                            <div class="ca_branding">
                                <span><?php echo esc_html__('Powered by Gridcoin', 'cryptapi'); ?></span>
                            </div>
                        <?php } ?>
                    </div>
                <?php } ?>

                <div class="ca_payment_processing" style="display:none;">
                    <div class="ca_loader_payment_processing"></div>
                    <h2><?php echo esc_html__('Your payment is being processed!', 'cryptapi'); ?></h2>
                    <h5><?php echo esc_html__('Processing can take some time depending on the blockchain.', 'cryptapi'); ?></h5>
                </div>

                <div class="ca_payment_confirmed" style="display:none;">
                    <div class="ca_payment_confirmed_icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100">
                            <path fill="#66BB6A" d="M504 256c0 136.967-111.033 248-248 248S8 392.967 8 256 119.033 8 256 8s248 111.033 248 248zM227.314 387.314l184-184c6.248-6.248 6.248-16.379 0-22.627l-22.627-22.627c-6.248-6.249-16.379-6.249-22.628 0L216 308.118l-70.059-70.059c-6.248-6.248-16.379-6.248-22.628 0l-22.627 22.627c-6.248 6.248-6.248 16.379 0 22.627l104 104c6.249 6.249 16.379 6.249 22.628.001z"/>
                        </svg>
                    </div>
                    <h2><?php echo esc_html__('Your payment has been confirmed!', 'cryptapi'); ?></h2>
                </div>

                <div class="ca_payment_cancelled" style="display:none;">
                    <div class="ca_payment_cancelled_icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100">
                            <path fill="#c62828" d="M504 256c0 136.997-111.043 248-248 248S8 392.997 8 256C8 119.083 119.043 8 256 8s248 111.083 248 248zm-248 50c-25.405 0-46 20.595-46 46s20.595 46 46 46 46-20.595 46-46-20.595-46-46-46zm-43.673-165.346l7.418 136c.347 6.364 5.609 11.346 11.982 11.346h48.546c6.373 0 11.635-4.982 11.982-11.346l7.418-136c.375-6.874-5.098-12.654-11.982-12.654h-63.383c-6.884 0-12.356 5.78-11.981 12.654z"/>
                        </svg>
                    </div>
                    <h2><?php echo esc_html__('Order has been cancelled due to lack of payment.', 'cryptapi'); ?></h2>
                </div>

                <div class="ca_payment_refunded" style="display:none;">
                    <div class="ca_payment_cancelled_icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100">
                            <path fill="#ef6c00" d="M504 256c0 136.997-111.043 248-248 248S8 392.997 8 256C8 119.083 119.043 8 256 8s248 111.083 248 248zm-248 50c-25.405 0-46 20.595-46 46s20.595 46 46 46 46-20.595 46-46-20.595-46-46-46zm-43.673-165.346l7.418 136c.347 6.364 5.609 11.346 11.982 11.346h48.546c6.373 0 11.635-4.982 11.982-11.346l7.418-136c.375-6.874-5.098-12.654-11.982-12.654h-63.383c-6.884 0-12.356 5.78-11.981 12.654z"/>
                        </svg>
                    </div>
                    <h2><?php echo esc_html__('Payment window elapsed — partial balance refunded.', 'cryptapi'); ?></h2>
                    <p class="ca_refund_details"><?php
                        /* Filled in by payment.js from the wallet refundTx / refundAmount fields. */
                        echo esc_html__('We have returned the GRC you sent to the original sending wallet. No further action is needed from you.', 'cryptapi');
                    ?></p>
                    <p class="ca_refund_tx" style="font-family:monospace;font-size:12px;word-break:break-all;"></p>
                </div>

                <div class="ca_payment_error" style="display:none;">
                    <div class="ca_payment_cancelled_icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100">
                            <path fill="#8e24aa" d="M504 256c0 136.997-111.043 248-248 248S8 392.997 8 256C8 119.083 119.043 8 256 8s248 111.083 248 248zm-248 50c-25.405 0-46 20.595-46 46s20.595 46 46 46 46-20.595 46-46-20.595-46-46-46zm-43.673-165.346l7.418 136c.347 6.364 5.609 11.346 11.982 11.346h48.546c6.373 0 11.635-4.982 11.982-11.346l7.418-136c.375-6.874-5.098-12.654-11.982-12.654h-63.383c-6.884 0-12.356 5.78-11.981 12.654z"/>
                        </svg>
                    </div>
                    <h2><?php echo esc_html__('Payment processing issue — we are looking into it.', 'cryptapi'); ?></h2>
                    <p><?php echo esc_html__('Something went wrong on our end while settling your payment. Please contact support and mention your order number — we can see the full history of your wallet.', 'cryptapi'); ?></p>
                </div>

                <?php if ($total > 0) { ?>
                    <div class="ca_progress">
                        <div class="ca_progress_icon waiting_payment done">
                            <svg width="60" height="60" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M49.2188 25C49.2188 38.3789 38.3789 49.2188 25 49.2188C11.6211 49.2188 0.78125 38.3789 0.78125 25C0.78125 11.6211 11.6211 0.78125 25 0.78125C38.3789 0.78125 49.2188 11.6211 49.2188 25ZM35.1953 22.1777L28.125 29.5508V11.7188C28.125 10.4199 27.0801 9.375 25.7812 9.375H24.2188C22.9199 9.375 21.875 10.4199 21.875 11.7188V29.5508L14.8047 22.1777C13.8965 21.2305 12.3828 21.2109 11.4551 22.1387L10.3906 23.2129C9.47266 24.1309 9.47266 25.6152 10.3906 26.5234L23.3398 39.4824C24.2578 40.4004 25.7422 40.4004 26.6504 39.4824L39.6094 26.5234C40.5273 25.6055 40.5273 24.1211 39.6094 23.2129L38.5449 22.1387C37.6172 21.2109 36.1035 21.2305 35.1953 22.1777V22.1777Z" fill="#0B4B70"/>
                            </svg>
                            <p><?php echo esc_html__('Waiting for payment', 'cryptapi'); ?></p>
                        </div>
                        <div class="ca_progress_icon waiting_network">
                            <svg width="60" height="60" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M46.875 15.625H3.125C1.39912 15.625 0 14.2259 0 12.5V6.25C0 4.52412 1.39912 3.125 3.125 3.125H46.875C48.6009 3.125 50 4.52412 50 6.25V12.5C50 14.2259 48.6009 15.625 46.875 15.625ZM42.1875 7.03125C40.8931 7.03125 39.8438 8.08057 39.8438 9.375C39.8438 10.6694 40.8931 11.7188 42.1875 11.7188C43.4819 11.7188 44.5312 10.6694 44.5312 9.375C44.5312 8.08057 43.4819 7.03125 42.1875 7.03125ZM35.9375 7.03125C34.6431 7.03125 33.5938 8.08057 33.5938 9.375C33.5938 10.6694 34.6431 11.7188 35.9375 11.7188C37.2319 11.7188 38.2812 10.6694 38.2812 9.375C38.2812 8.08057 37.2319 7.03125 35.9375 7.03125ZM46.875 31.25H3.125C1.39912 31.25 0 29.8509 0 28.125V21.875C0 20.1491 1.39912 18.75 3.125 18.75H46.875C48.6009 18.75 50 20.1491 50 21.875V28.125C50 29.8509 48.6009 31.25 46.875 31.25ZM42.1875 22.6562C40.8931 22.6562 39.8438 23.7056 39.8438 25C39.8438 26.2944 40.8931 27.3438 42.1875 27.3438C43.4819 27.3438 44.5312 26.2944 44.5312 25C44.5312 23.7056 43.4819 22.6562 42.1875 22.6562ZM35.9375 22.6562C34.6431 22.6562 33.5938 23.7056 33.5938 25C33.5938 26.2944 34.6431 27.3438 35.9375 27.3438C37.2319 27.3438 38.2812 26.2944 38.2812 25C38.2812 23.7056 37.2319 22.6562 35.9375 22.6562ZM46.875 46.875H3.125C1.39912 46.875 0 45.4759 0 43.75V37.5C0 35.7741 1.39912 34.375 3.125 34.375H46.875C48.6009 34.375 50 35.7741 50 37.5V43.75C50 45.4759 48.6009 46.875 46.875 46.875ZM42.1875 38.2812C40.8931 38.2812 39.8438 39.3306 39.8438 40.625C39.8438 41.9194 40.8931 42.9688 42.1875 42.9688C43.4819 42.9688 44.5312 41.9194 44.5312 40.625C44.5312 39.3306 43.4819 38.2812 42.1875 38.2812ZM35.9375 38.2812C34.6431 38.2812 33.5938 39.3306 33.5938 40.625C33.5938 41.9194 34.6431 42.9688 35.9375 42.9688C37.2319 42.9688 38.2812 41.9194 38.2812 40.625C38.2812 39.3306 37.2319 38.2812 35.9375 38.2812Z" fill="#0B4B70"/>
                            </svg>
                            <p><?php echo esc_html__('Waiting for network confirmation', 'cryptapi'); ?></p>
                        </div>
                        <div class="ca_progress_icon payment_done">
                            <svg width="60" height="60" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M25 0.78125C11.6211 0.78125 0.78125 11.6211 0.78125 25C0.78125 38.3789 11.6211 49.2188 25 49.2188C38.3789 49.2188 49.2188 38.3789 49.2188 25C49.2188 11.6211 38.3789 0.78125 25 0.78125ZM37.4512 19.0723L22.9004 33.623C22.2949 34.2285 21.3184 34.2285 20.7129 33.623L12.5488 25.459C11.9434 24.8535 11.9434 23.877 12.5488 23.2715L14.7363 21.084C15.3418 20.4785 16.3184 20.4785 16.9238 21.084L21.8066 25.9668L33.0762 14.6973C33.6816 14.0918 34.6582 14.0918 35.2637 14.6973L37.4512 16.8848C38.0566 17.4902 38.0566 18.4668 37.4512 19.0723Z" fill="#0B4B70"/>
                            </svg>
                            <p><?php echo esc_html__('Payment confirmed', 'cryptapi'); ?></p>
                        </div>
                    </div>
                <?php } ?>
            </div>
        </div>
        <?php
    }
}
