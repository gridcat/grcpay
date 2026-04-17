<?php
/*
Plugin Name: Gridcoin Payment Gateway for WooCommerce
Plugin URI: https://github.com/gridcat/gridcoin.club
Description: Accept Gridcoin (GRC) payments on your WooCommerce store via grc-payment-proxy
Version: 1.0.0
Requires at least: 5.0
Tested up to: 6.7
WC requires at least: 5.8
Requires PHP: 7.4
Author: gridcat
License: MIT
*/

require_once 'define.php';

function grcpay_missing_wc_notice()
{
    echo '<div class="error"><p><strong>' .
        esc_html__('Gridcoin Payment Gateway requires WooCommerce to be installed and active.', 'cryptapi') .
        '</strong></p></div>';
}

function grcpay_include_gateway($methods)
{
    $methods[] = 'WC_CryptAPI_Gateway';
    return $methods;
}

function grcpay_loader()
{
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', 'grcpay_missing_wc_notice');
        return;
    }

    require_once CRYPTAPI_PLUGIN_PATH . 'utils/helper.php';
    require_once CRYPTAPI_PLUGIN_PATH . 'controllers/CryptAPI.php';
}

/**
 * Instantiate the gateway lazily on demand so its AJAX handler is accessible
 * from admin-ajax.php.
 *
 * The gateway class normally registers `wp_ajax_*cryptapi_order_status` in
 * its constructor — but WC only instantiates payment gateways when something
 * actively asks for them (front-end checkout, admin settings screen, WC's
 * own init call), and plain admin-ajax.php does not. Without this shim the
 * AJAX endpoint returns HTTP 400 because has_action() can't find the hook,
 * which breaks the thank-you page status polling + countdown refresh.
 */
function grcpay_dispatch_order_status_ajax()
{
    if (!class_exists('WC_CryptAPI_Gateway')) {
        require_once CRYPTAPI_PLUGIN_PATH . 'utils/helper.php';
        require_once CRYPTAPI_PLUGIN_PATH . 'controllers/CryptAPI.php';
    }
    $gateway = new WC_CryptAPI_Gateway();
    $gateway->order_status();
}

// Register custom cron interval for payment checking
function grcpay_cron_schedules($schedules)
{
    $schedules['grcpay_interval'] = [
        'interval' => 30,
        'display' => __('Every 30 seconds (GRC Payment Check)', 'cryptapi'),
    ];
    return $schedules;
}

add_filter('cron_schedules', 'grcpay_cron_schedules');
add_action('plugins_loaded', 'grcpay_loader');
add_filter('woocommerce_payment_gateways', 'grcpay_include_gateway');

// Register the status-poll AJAX handler at the top level so admin-ajax.php
// sees it regardless of whether WC has instantiated the gateway yet. See
// grcpay_dispatch_order_status_ajax() above for the full rationale.
add_action('wp_ajax_cryptapi_order_status', 'grcpay_dispatch_order_status_ajax');
add_action('wp_ajax_nopriv_cryptapi_order_status', 'grcpay_dispatch_order_status_ajax');

// Cleanup cron on deactivation
register_deactivation_hook(__FILE__, function () {
    wp_clear_scheduled_hook('grcpay_check_pending_orders');
});
