<?php

declare(strict_types=1);

namespace Grcpay\Tests;

use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use ReflectionProperty;
use WC_Grcpay_Gateway;

/**
 * Tests for the gateway's smaller private helpers that didn't
 * deserve their own file:
 *
 *   - nonce_action_for_order (static, per-order nonce scope)
 *   - get_candidate_urls (instance, reads api_url + api_url_backup)
 *   - mark_grcpay_meta_protected (instance, is_protected_meta callback)
 *
 * The instance methods are exercised by building a gateway via
 * reflection WITHOUT running the real constructor (which would need
 * WooCommerce loaded). The stub `WC_Payment_Gateway` in bootstrap.php
 * provides just enough surface for `new WC_Grcpay_Gateway()` to
 * resolve; we then reach in with reflection to set only the
 * properties each test actually depends on.
 */
final class GatewayHelpersTest extends TestCase
{
    /**
     * Build a gateway instance WITHOUT running its constructor, so
     * we don't need WooCommerce's init_settings / init_form_fields
     * / hook registration machinery. Each test sets the properties
     * it needs directly.
     */
    private function gatewayWithProperties(array $properties = []): WC_Grcpay_Gateway
    {
        $instance = (new \ReflectionClass(WC_Grcpay_Gateway::class))->newInstanceWithoutConstructor();
        foreach ($properties as $name => $value) {
            $prop = new ReflectionProperty(WC_Grcpay_Gateway::class, $name);
            $prop->setAccessible(true);
            $prop->setValue($instance, $value);
        }
        return $instance;
    }

    // ------------------------------------------------------------------
    // nonce_action_for_order
    // ------------------------------------------------------------------

    public function testNonceActionIsScopedPerOrder(): void
    {
        $method = new ReflectionMethod(WC_Grcpay_Gateway::class, 'nonce_action_for_order');
        $method->setAccessible(true);

        self::assertSame('grcpay_order_status_1', $method->invoke(null, 1));
        self::assertSame('grcpay_order_status_42', $method->invoke(null, 42));
    }

    public function testNonceActionCoercesStringIdsToInt(): void
    {
        // A stolen nonce from order 42 must not be replayable against
        // order '42abc' if a future path ever accepts string IDs.
        // intval() strips trailing non-numeric suffixes.
        $method = new ReflectionMethod(WC_Grcpay_Gateway::class, 'nonce_action_for_order');
        $method->setAccessible(true);

        self::assertSame('grcpay_order_status_42', $method->invoke(null, '42abc'));
        self::assertSame('grcpay_order_status_0', $method->invoke(null, 'not-a-number'));
    }

    public function testNonceActionsAreDistinctBetweenOrders(): void
    {
        // Regression guard: if someone accidentally drops the order_id
        // from the nonce action name, every order would share one
        // nonce scope and a captured nonce could walk the store.
        $method = new ReflectionMethod(WC_Grcpay_Gateway::class, 'nonce_action_for_order');
        $method->setAccessible(true);

        $actions = [];
        foreach ([1, 2, 3, 100, 999, 12345] as $id) {
            $actions[] = $method->invoke(null, $id);
        }
        self::assertSame($actions, array_unique($actions));
    }

    // ------------------------------------------------------------------
    // get_candidate_urls
    // ------------------------------------------------------------------

    public function testCandidateUrlsWithOnlyPrimary(): void
    {
        $gateway = $this->gatewayWithProperties([
            'api_url'        => 'https://primary.example.com',
            'api_url_backup' => '',
        ]);

        self::assertSame(
            ['https://primary.example.com'],
            $this->invokeCandidateUrls($gateway)
        );
    }

    public function testCandidateUrlsWithPrimaryAndBackup(): void
    {
        $gateway = $this->gatewayWithProperties([
            'api_url'        => 'https://primary.example.com',
            'api_url_backup' => 'https://backup.example.com',
        ]);

        self::assertSame(
            ['https://primary.example.com', 'https://backup.example.com'],
            $this->invokeCandidateUrls($gateway)
        );
    }

    public function testCandidateUrlsPreservesOrderPrimaryFirst(): void
    {
        // The fallback policy depends on primary being tried first.
        // If this order ever flips, every failover test breaks.
        $gateway = $this->gatewayWithProperties([
            'api_url'        => 'https://a.example.com',
            'api_url_backup' => 'https://b.example.com',
        ]);

        $result = $this->invokeCandidateUrls($gateway);
        self::assertSame('https://a.example.com', $result[0]);
        self::assertSame('https://b.example.com', $result[1]);
    }

    public function testCandidateUrlsDedupesWhenBothFieldsMatch(): void
    {
        $gateway = $this->gatewayWithProperties([
            'api_url'        => 'https://primary.example.com',
            'api_url_backup' => 'https://primary.example.com',
        ]);

        self::assertSame(
            ['https://primary.example.com'],
            $this->invokeCandidateUrls($gateway)
        );
    }

    public function testCandidateUrlsDropsEmptyBackup(): void
    {
        $gateway = $this->gatewayWithProperties([
            'api_url'        => 'https://primary.example.com',
            'api_url_backup' => '',
        ]);

        $result = $this->invokeCandidateUrls($gateway);
        self::assertCount(1, $result);
    }

    public function testCandidateUrlsReturnsEmptyWhenBothUnset(): void
    {
        $gateway = $this->gatewayWithProperties([
            'api_url'        => '',
            'api_url_backup' => '',
        ]);

        self::assertSame([], $this->invokeCandidateUrls($gateway));
    }

    public function testCandidateUrlsWithOnlyBackup(): void
    {
        // Unusual but legal: operator clears primary but leaves backup
        // set. The backup becomes the sole candidate.
        $gateway = $this->gatewayWithProperties([
            'api_url'        => '',
            'api_url_backup' => 'https://backup.example.com',
        ]);

        self::assertSame(
            ['https://backup.example.com'],
            $this->invokeCandidateUrls($gateway)
        );
    }

    private function invokeCandidateUrls(WC_Grcpay_Gateway $gateway): array
    {
        $method = new ReflectionMethod(WC_Grcpay_Gateway::class, 'get_candidate_urls');
        $method->setAccessible(true);
        return $method->invoke($gateway);
    }

    // ------------------------------------------------------------------
    // mark_grcpay_meta_protected
    // ------------------------------------------------------------------

    public function testProtectedMetaHidesWalletToken(): void
    {
        $gateway = $this->gatewayWithProperties();
        self::assertTrue($gateway->mark_grcpay_meta_protected(false, 'grcpay_token'));
    }

    public function testProtectedMetaHidesPinnedApiUrl(): void
    {
        $gateway = $this->gatewayWithProperties();
        self::assertTrue($gateway->mark_grcpay_meta_protected(false, 'grcpay_api_url'));
    }

    public function testProtectedMetaHidesQrCodeDataUrl(): void
    {
        // Hides the massive base64 data URL from the Custom Fields UI
        // more for ergonomics than security, but still deliberate.
        $gateway = $this->gatewayWithProperties();
        self::assertTrue($gateway->mark_grcpay_meta_protected(false, 'grcpay_qr_code'));
    }

    public function testProtectedMetaPassesThroughUnrelatedKeys(): void
    {
        $gateway = $this->gatewayWithProperties();
        // An unrelated meta key should preserve whatever protection
        // state WordPress already decided on — we only add to the
        // protected set, never remove from it.
        self::assertFalse(
            $gateway->mark_grcpay_meta_protected(false, 'some_other_plugin_meta'),
            'Unrelated meta should preserve false'
        );
        self::assertTrue(
            $gateway->mark_grcpay_meta_protected(true, 'some_other_plugin_meta'),
            'Unrelated meta should preserve true'
        );
    }

    public function testProtectedMetaPassesThroughGrcpayPublicMeta(): void
    {
        // grcpay_address and grcpay_total are intentionally NOT in the
        // hidden list — they're shown on the order edit screen as
        // part of the normal merchant workflow.
        $gateway = $this->gatewayWithProperties();
        self::assertFalse($gateway->mark_grcpay_meta_protected(false, 'grcpay_address'));
        self::assertFalse($gateway->mark_grcpay_meta_protected(false, 'grcpay_total'));
        self::assertFalse($gateway->mark_grcpay_meta_protected(false, 'grcpay_total_fiat'));
    }
}
