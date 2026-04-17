<?php
/*
 * Plugin Name: grcpay Demo Viewer Role
 * Description: Makes the `demo_viewer` role a read-only window into
 *              WooCommerce. Visitors can navigate the full WC admin (orders,
 *              products, customers, reports, settings) but cannot save,
 *              create, or delete anything.
 *
 * Strategy (three layers, cheapest first):
 *   1. CSS injection hides every edit/save/delete/bulk-action control in
 *      wp-admin so the UI just looks read-only — no tempting buttons.
 *   2. An `admin_init` guard rejects every POST request from demo viewers,
 *      so form submissions and editor saves fail even if someone reaches
 *      them manually.
 *   3. `map_meta_cap` denies the cap classes that would let a clever user
 *      install plugins, edit users, flip WP core options, or run
 *      destructive WC Status tools via AJAX.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Is the given user a demo_viewer (and ONLY a demo_viewer — never downgrade
 * a real admin who was granted the role for testing).
 */
function grcpay_demo_is_viewer($user): bool
{
    if (!$user || !isset($user->roles)) {
        return false;
    }
    return in_array('demo_viewer', (array) $user->roles, true)
        && !in_array('administrator', (array) $user->roles, true);
}

/**
 * Block every wp-admin POST request from demo viewers. This catches form
 * saves (post.php, options.php, admin-post.php, admin.php?page=wc-settings
 * save actions) without having to enumerate every handler. AJAX is excluded
 * because WC's admin uses POST AJAX for things like list table filters that
 * must still work.
 */
add_action('admin_init', function () {
    if (!grcpay_demo_is_viewer(wp_get_current_user())) {
        return;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        return;
    }
    if (wp_doing_ajax()) {
        return;
    }
    wp_die(
        'This is a read-only grcpay demo. The <code>demo</code> account can view every WooCommerce screen but cannot save changes. Log in as the real administrator if you actually need to edit something.',
        'Read-only demo',
        ['response' => 403, 'back_link' => true]
    );
}, 1);

/**
 * Deny dangerous write capabilities outright. These are the ones that WC's
 * admin UI or any other plugin might reach via AJAX, REST, or JSON handlers
 * — places the POST blocker above wouldn't catch. Order/product/customer
 * viewing caps are intentionally left alone.
 */
add_filter('map_meta_cap', function ($caps, $cap, $user_id, $args) {
    if (!$user_id) {
        return $caps;
    }
    $user = get_userdata($user_id);
    if (!grcpay_demo_is_viewer($user)) {
        return $caps;
    }

    $blocked_exact = [
        'manage_options', 'unfiltered_html', 'export', 'import',
        'customize', 'update_core',
    ];
    if (in_array($cap, $blocked_exact, true)) {
        return ['do_not_allow'];
    }

    $blocked_prefixes = [
        'install_plugin', 'update_plugin', 'delete_plugin', 'activate_plugin', 'edit_plugin',
        'install_theme', 'update_theme', 'delete_theme', 'switch_theme', 'edit_theme',
        'edit_user', 'delete_user', 'create_user', 'promote_user', 'remove_user',
        'edit_file', 'delete_file',
    ];
    foreach ($blocked_prefixes as $prefix) {
        if (strpos($cap, $prefix) === 0) {
            return ['do_not_allow'];
        }
    }

    return $caps;
}, 10, 4);

/**
 * Remove a small number of WC admin surfaces we really don't want visitors
 * reaching — WC Status exposes destructive tools (delete transients, reset
 * tracking, etc.) that can run on simple GET nonces.
 */
add_action('admin_menu', function () {
    if (!grcpay_demo_is_viewer(wp_get_current_user())) {
        return;
    }
    remove_submenu_page('woocommerce', 'wc-status');

    // Top-level WP surfaces visitors don't need and that we don't want to
    // bother read-only proofing (Tools, Plugins, Users, general Settings).
    remove_menu_page('plugins.php');
    remove_menu_page('users.php');
    remove_menu_page('tools.php');
    remove_menu_page('options-general.php');
    remove_menu_page('themes.php');
    remove_menu_page('profile.php');
}, 999);

/**
 * Belt-and-braces server-side guard for the screens whose menu items we
 * removed above, in case a URL is pasted directly.
 */
add_action('current_screen', function ($screen) {
    if (!grcpay_demo_is_viewer(wp_get_current_user())) {
        return;
    }
    // profile.php is intentionally NOT blocked — WP's default redirect sends
    // users without edit_posts to their own profile, and it's harmless here
    // because the POST blocker already prevents saves on it.
    $blocked_screens = [
        'woocommerce_page_wc-status',
        'plugins', 'plugin-install', 'plugin-editor',
        'themes', 'theme-install', 'theme-editor', 'customize',
        'users', 'user-new',
        'options-general', 'options-writing', 'options-reading',
        'options-discussion', 'options-media', 'options-permalink',
        'tools', 'import', 'export',
    ];
    if (in_array($screen->id ?? '', $blocked_screens, true)) {
        wp_die(
            'This page is disabled on the grcpay read-only demo.',
            'Disabled on demo',
            ['response' => 403, 'back_link' => true]
        );
    }
});

/**
 * Send demo viewers straight to WooCommerce → Orders after login, instead
 * of WP's default dashboard → profile.php redirect chain (WP sends users
 * without `edit_posts` to their profile page, which isn't a useful landing
 * spot for a read-only WC demo).
 */
add_filter('login_redirect', function ($redirect_to, $requested, $user) {
    if ($user instanceof WP_User && grcpay_demo_is_viewer($user)) {
        return admin_url('admin.php?page=wc-orders');
    }
    return $redirect_to;
}, 10, 3);

/**
 * Inject CSS that hides every write-shaped control in wp-admin. Fires on
 * every admin page but only outputs styles for demo viewers.
 */
add_action('admin_head', function () {
    if (!grcpay_demo_is_viewer(wp_get_current_user())) {
        return;
    }
    ?>
    <style id="grcpay-demo-readonly">
        /* "Add New" header buttons */
        .page-title-action,
        .wrap .wp-heading-inline + .page-title-action,
        .wc-admin-breadcrumb .components-button,
        .woocommerce-layout__header-button,
        .woocommerce-experimental-select-control__custom-container + button,
        a.add-new-h2 {
            display: none !important;
        }
        /* Classic post editor action buttons */
        #publishing-action, #delete-action, #minor-publishing,
        #post-preview, #save-post, #publish,
        #save-action .spinner, .edit-post-header__settings {
            display: none !important;
        }
        /* Generic submit/save/delete/update buttons in wp-admin forms */
        #wpbody-content form input[type=submit],
        #wpbody-content form button[type=submit],
        #wpbody-content .button-primary[name="save"],
        #wpbody-content .submitdelete,
        #wpbody-content .trash,
        #wpbody-content .delete-tag {
            display: none !important;
        }
        /* Bulk action dropdowns + Apply buttons on list tables */
        .tablenav .bulkactions,
        .wp-list-table .check-column,
        .wp-list-table .row-actions .trash,
        .wp-list-table .row-actions .delete {
            display: none !important;
        }
        /* WC Orders (HPOS) edit screen — the whole meta-box row of status /
           customer selects and the Update button. Title, line items, meta
           data and notes stay visible. */
        .woocommerce_page_wc-orders #submitdiv .submitbox #publishing-action,
        .woocommerce_page_wc-orders #submitdiv .submitbox #delete-action,
        .woocommerce_page_wc-orders .order_actions .wc-order-delete,
        .woocommerce_page_wc-orders .order_actions .wc-order-trash,
        .woocommerce_page_wc-orders #order_notes_submit,
        .woocommerce_page_wc-orders .add_order_note,
        .woocommerce_page_wc-orders .add_note {
            display: none !important;
        }
        /* WC Settings screens: hide save button and disable inputs visually */
        .woocommerce_page_wc-settings .submit .button-primary,
        .woocommerce_page_wc-settings .submit .button[name="save"] {
            display: none !important;
        }
        .woocommerce_page_wc-settings input:not([type=hidden]):not([type=button]),
        .woocommerce_page_wc-settings select,
        .woocommerce_page_wc-settings textarea {
            pointer-events: none !important;
            background: #f6f7f7 !important;
        }
        /* Banner above every admin page so visitors know why nothing saves */
        #wpbody-content::before {
            content: "Read-only demo — you are logged in as demo/demo. Everything you see is live, but no changes can be saved.";
            display: block;
            margin: 16px 20px 0 2px;
            padding: 10px 14px;
            border-left: 4px solid #2271b1;
            background: #f0f6fc;
            color: #0a4b78;
            font-size: 13px;
            line-height: 1.5;
        }
    </style>
    <?php
});
