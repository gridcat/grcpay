<?php
/*
 * Plugin Name: grcpay Demo Checkout Prefill
 * Description: Pre-fills billing fields on the checkout form with plausible
 *              test data so visitors to the public demo can reach the
 *              payment screen in one click. Applies to every unauthenticated
 *              checkout — logged-in users still get their own stored
 *              customer data.
 *
 * Uses WC's `default_checkout_<field>` filters, which only return a value
 * when the field is empty, so real user input is never overwritten.
 */

if (!defined('ABSPATH')) {
    exit;
}

const GRCPAY_DEMO_PREFILL = [
    'billing_first_name' => 'Demo',
    'billing_last_name'  => 'Visitor',
    'billing_company'    => 'Gridcoin Demo Inc.',
    'billing_email'      => 'demo-visitor@grcpay.local',
    'billing_phone'      => '+1 555 0100',
    'billing_address_1'  => '1 Demo Avenue',
    'billing_address_2'  => 'Suite 100',
    'billing_city'       => 'Demo City',
    'billing_state'      => 'CA',
    'billing_postcode'   => '90210',
    'billing_country'    => 'US',
    // Shipping mirrors billing — our sample products are virtual so
    // shipping fields usually aren't rendered, but set them anyway in case
    // an admin later adds a physical product.
    'shipping_first_name' => 'Demo',
    'shipping_last_name'  => 'Visitor',
    'shipping_company'    => 'Gridcoin Demo Inc.',
    'shipping_address_1'  => '1 Demo Avenue',
    'shipping_address_2'  => 'Suite 100',
    'shipping_city'       => 'Demo City',
    'shipping_state'      => 'CA',
    'shipping_postcode'   => '90210',
    'shipping_country'    => 'US',
];

/**
 * Register a `default_checkout_<field>` filter for every entry in the
 * prefill table. WC calls these with the current value — we only inject a
 * default when it's empty, so real user typing always wins.
 */
add_action('init', function () {
    foreach (GRCPAY_DEMO_PREFILL as $field => $value) {
        add_filter("default_checkout_{$field}", function ($current) use ($value) {
            return (null === $current || '' === $current) ? $value : $current;
        }, 10, 1);
    }
});

/**
 * Seed the WC customer session with the same data up-front so it also
 * shows correctly in the order review block, shipping calculator, and tax
 * estimation. Runs on the checkout page load.
 */
add_action('woocommerce_before_checkout_form', function () {
    if (is_user_logged_in() || !function_exists('WC')) {
        return;
    }
    $customer = WC()->customer;
    if (!$customer) {
        return;
    }
    foreach (GRCPAY_DEMO_PREFILL as $field => $value) {
        $setter = 'set_' . $field;
        if (method_exists($customer, $setter) && '' === (string) $customer->{'get_' . $field}()) {
            $customer->{$setter}($value);
        }
    }
    $customer->save();
});
