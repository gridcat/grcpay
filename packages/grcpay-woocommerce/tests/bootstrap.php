<?php
/**
 * PHPUnit bootstrap for the grcpay-woocommerce plugin test suite.
 *
 * The plugin lives inside WooCommerce, which lives inside WordPress.
 * Neither is available when PHPUnit runs in isolation, so we do the
 * minimum stubbing needed to load the plugin's class files and
 * exercise the pure-logic methods in isolation:
 *
 *   1. Load Composer's autoloader (Brain Monkey + PHPUnit itself).
 *   2. Declare a stub `WC_Payment_Gateway` parent class with a no-op
 *      constructor so `WC_CryptAPI_Gateway` can be instantiated
 *      without needing a running WooCommerce.
 *   3. Polyfill a tiny handful of WordPress globals (`__()`,
 *      `esc_html()`, etc.) that the class file calls at parse time
 *      or inside methods we actually test.
 *   4. Require the plugin files so their class definitions are
 *      available, WITHOUT running the top-level `add_action()` /
 *      `add_filter()` registrations that the main plugin entry
 *      (CryptAPI.php) fires at load time — we only load the helper
 *      and the controller, not the bootstrap file.
 *
 * Tests that need richer WP behaviour (hooks firing, user caps,
 * option storage) should use Brain Monkey's setUp/tearDown in the
 * test class itself — the bootstrap stays minimal.
 */

declare(strict_types=1);

error_reporting(E_ALL);

$composerAutoload = __DIR__ . '/../vendor/autoload.php';
if (!file_exists($composerAutoload)) {
    fwrite(STDERR, "\nComposer dependencies not installed. Run `composer install` in the plugin directory first.\n\n");
    exit(1);
}
require_once $composerAutoload;

// ---------------------------------------------------------------------
// Stub the WooCommerce parent class. Provides the absolute minimum
// surface the controller constructor touches before our test code
// overrides it — we skip the real constructor entirely via reflection
// in the tests that need an instance.
// ---------------------------------------------------------------------
if (!class_exists('WC_Payment_Gateway')) {
    class WC_Payment_Gateway
    {
        public $id = '';

        public $icon = '';

        public $has_fields = false;

        public $method_title = '';

        public $method_description = '';

        public $title = '';

        public $description = '';

        public $enabled = 'no';

        public $supports = [];

        public $form_fields = [];

        public $settings = [];

        public function __construct()
        {
        }

        public function init_form_fields()
        {
        }

        public function init_settings()
        {
        }

        public function get_option($key, $empty_value = null)
        {
            return $this->settings[$key] ?? $empty_value ?? '';
        }

        public function process_admin_options()
        {
            return true;
        }

        public function admin_options()
        {
        }
    }
}

// ---------------------------------------------------------------------
// Polyfill the WordPress globals the plugin files call during class
// parsing / method execution. Each is a minimal identity or no-op
// implementation — tests that care about specific WP behaviour should
// wrap them with Brain Monkey instead.
// ---------------------------------------------------------------------
if (!function_exists('__')) {
    function __($text, $domain = null)
    {
        return $text;
    }
}
if (!function_exists('_e')) {
    function _e($text, $domain = null)
    {
        echo $text;
    }
}
if (!function_exists('esc_html')) {
    function esc_html($text)
    {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }
}
if (!function_exists('esc_html__')) {
    function esc_html__($text, $domain = null)
    {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }
}
if (!function_exists('esc_html_e')) {
    function esc_html_e($text, $domain = null)
    {
        echo htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }
}
if (!function_exists('esc_attr')) {
    function esc_attr($text)
    {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }
}
if (!function_exists('esc_attr__')) {
    function esc_attr__($text, $domain = null)
    {
        return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8');
    }
}
if (!function_exists('wp_parse_url')) {
    function wp_parse_url($url, $component = -1)
    {
        // parse_url raises a warning on seriously malformed input; the
        // WP shim just returns false, matching that behaviour.
        return parse_url($url, $component);
    }
}
if (!function_exists('wp_kses')) {
    function wp_kses($text, $allowed_html = [])
    {
        return (string) $text;
    }
}
if (!function_exists('wp_json_encode')) {
    function wp_json_encode($data, $options = 0, $depth = 512)
    {
        return json_encode($data, $options, $depth);
    }
}
if (!function_exists('add_action')) {
    function add_action(...$args)
    {
    }
}
if (!function_exists('add_filter')) {
    function add_filter(...$args)
    {
    }
}
if (!function_exists('wp_schedule_event')) {
    function wp_schedule_event(...$args)
    {
    }
}
if (!function_exists('wp_next_scheduled')) {
    function wp_next_scheduled(...$args)
    {
        return false;
    }
}

// ---------------------------------------------------------------------
// Load the plugin class files. NOTE: we deliberately do NOT require
// CryptAPI.php (the main plugin entry) because it registers real WP
// hooks and schedules cron events. We only need the class definitions.
// ---------------------------------------------------------------------
define('CRYPTAPI_PLUGIN_VERSION', '0.0.0-test');
define('CRYPTAPI_PLUGIN_PATH', dirname(__DIR__) . '/plugin/');
define('CRYPTAPI_PLUGIN_URL', 'https://example.test/wp-content/plugins/grcpay-woocommerce/');

require_once CRYPTAPI_PLUGIN_PATH . 'utils/helper.php';
require_once CRYPTAPI_PLUGIN_PATH . 'controllers/CryptAPI.php';
