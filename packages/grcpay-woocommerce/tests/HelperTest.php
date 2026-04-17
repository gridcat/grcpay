<?php

declare(strict_types=1);

namespace CryptAPI\Tests;

use CryptAPI\Helper;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the static numeric helpers in Helper.
 *
 * These are the pure functions that every other code path in the
 * plugin delegates to for amount math — rounding at wallet creation,
 * halford-to-GRC conversion on polling, and significant-figure
 * formatting for display. A bug in any of them silently corrupts
 * displayed amounts or invoice totals, so they're the leaf nodes
 * most worth pinning first.
 */
final class HelperTest extends TestCase
{
    public function testHalfordToGrcHandlesZero(): void
    {
        self::assertSame(0.0, Helper::halfordToGrc(0));
    }

    public function testHalfordToGrcHandlesNullAndEmptyString(): void
    {
        self::assertSame(0.0, Helper::halfordToGrc(null));
        self::assertSame(0.0, Helper::halfordToGrc(''));
        self::assertSame(0.0, Helper::halfordToGrc(false));
    }

    public function testHalfordToGrcConvertsIntegerHalfords(): void
    {
        // 1 GRC = 100,000,000 halfords.
        self::assertSame(1.0, Helper::halfordToGrc(100_000_000));
        self::assertSame(0.5, Helper::halfordToGrc(50_000_000));
        self::assertSame(0.00000001, Helper::halfordToGrc(1));
    }

    public function testHalfordToGrcAcceptsStringInputFromJsonApi(): void
    {
        // grcpay returns halford amounts as JSON strings (they exceed
        // JS Number safe range). The helper has to floatval() them.
        self::assertSame(4.48266665, Helper::halfordToGrc('448266665'));
    }

    public function testHalfordToGrcRejectsNonNumericStringAsZero(): void
    {
        // floatval('abc') is 0 in PHP — document the behaviour so a
        // future change doesn't accidentally start throwing.
        self::assertSame(0.0, Helper::halfordToGrc('abc'));
    }

    /**
     * @dataProvider provideRoundInvoiceCases
     */
    public function testRoundInvoiceGrcCeilsTo4Decimals(float $input, float $expected): void
    {
        self::assertSame($expected, Helper::roundInvoiceGrc($input, 4));
    }

    public function provideRoundInvoiceCases(): array
    {
        return [
            // Already on the 4-decimal grid — no change.
            'exact 4-decimal value'       => [2.2429, 2.2429],
            'exact integer'               => [5.0, 5.0],
            // Ceiling, not rounding — never undercharges the merchant.
            'classic session residual'    => [4.48266665, 4.4827],
            'just below grid up'          => [4.48260001, 4.4827],
            'just above grid up'          => [4.48270001, 4.4828],
            // Minimum-tx neighbourhood. Without the ceiling, raw
            // conversion rates like 0.00099xxx would round DOWN to
            // 0.0009 and fail the MIN_TX gate even though the true
            // value is fractionally above it.
            'below MIN_TX ceils up'       => [0.00099, 0.001],
            'tiny value ceils to 0.0001'  => [0.00005, 0.0001],
            'exactly zero stays zero'     => [0.0, 0.0],
        ];
    }

    public function testRoundInvoiceGrcHonoursCustomDecimals(): void
    {
        // Two decimals: 4.48266665 → 4.49 (ceiling).
        self::assertSame(4.49, Helper::roundInvoiceGrc(4.48266665, 2));
        // Six decimals: finer-grained, still ceiling semantics.
        self::assertEqualsWithDelta(
            4.482667,
            Helper::roundInvoiceGrc(4.48266665, 6),
            1e-9
        );
    }

    public function testSigFigOnZeroDoesNotExplode(): void
    {
        // Guard against log10(0) = -INF; the helper has a special
        // branch for zero input and should just produce a value
        // with (digits - 1) trailing zeros.
        self::assertSame('0.00000', Helper::sig_fig(0, 6));
    }

    public function testSigFigTrimsToSixFigures(): void
    {
        self::assertSame('4.48267', Helper::sig_fig(4.48266665, 6));
    }

    public function testSigFigHandlesSmallValues(): void
    {
        // Sub-unit values need more decimal places to keep six sig
        // figs. 0.00259665 has 3 leading zeros past the decimal,
        // so 6 sig figs = 8 decimal places.
        self::assertSame('0.00259665', Helper::sig_fig(0.00259665, 6));
    }
}
