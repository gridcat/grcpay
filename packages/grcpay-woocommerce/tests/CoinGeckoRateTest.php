<?php

declare(strict_types=1);

namespace Grcpay\Tests;

use Brain\Monkey;
use Brain\Monkey\Functions;
use Exception;
use Grcpay\Helper;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * The direct CoinGecko fallback reads the coin endpoint
 * (`coins/gridcoin-research`), the same one grcpay uses, and takes the
 * rate from `market_data.current_price[<currency>]`.
 */
final class CoinGeckoRateTest extends TestCase
{
    private ?string $requestedUrl = null;

    protected function setUp(): void
    {
        parent::setUp();
        Monkey\setUp();
        Functions\when('is_wp_error')->justReturn(false);
        Functions\when('wp_remote_retrieve_body')->alias(fn ($response) => $response['body']);
    }

    protected function tearDown(): void
    {
        Monkey\tearDown();
        parent::tearDown();
    }

    private function respondWith(array $payload): void
    {
        Functions\when('wp_remote_get')->alias(function ($url) use ($payload) {
            $this->requestedUrl = $url;
            return ['body' => json_encode($payload)];
        });
    }

    private function fetchRate(string $currency): float
    {
        $method = new ReflectionMethod(Helper::class, 'getRateViaCoinGecko');
        $method->setAccessible(true);
        return $method->invoke(null, $currency);
    }

    public function testReadsTheRateFromMarketData(): void
    {
        $this->respondWith(['market_data' => ['current_price' => ['eur' => 0.0052, 'usd' => 0.0058]]]);

        self::assertSame(0.0052, $this->fetchRate('eur'));
        self::assertStringContainsString('coins/gridcoin-research?', (string) $this->requestedUrl);
        self::assertStringContainsString('market_data=true', (string) $this->requestedUrl);
        self::assertStringNotContainsString('simple/price', (string) $this->requestedUrl);
    }

    public function testThrowsWhenTheCurrencyIsMissing(): void
    {
        $this->respondWith(['market_data' => ['current_price' => ['usd' => 0.0058]]]);

        $this->expectException(Exception::class);
        $this->fetchRate('eur');
    }

    public function testThrowsOnTheOldSimplePriceShape(): void
    {
        $this->respondWith(['gridcoin-research' => ['eur' => 0.0052]]);

        $this->expectException(Exception::class);
        $this->fetchRate('eur');
    }
}
