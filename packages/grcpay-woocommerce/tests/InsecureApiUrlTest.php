<?php

declare(strict_types=1);

namespace CryptAPI\Tests;

use PHPUnit\Framework\TestCase;
use ReflectionMethod;
use WC_CryptAPI_Gateway;

/**
 * Exhaustive tests for `WC_CryptAPI_Gateway::is_insecure_api_url()`.
 *
 * This is the security-critical URL classifier that blocks checkout
 * whenever the merchant has configured a plaintext HTTP endpoint
 * outside of a trusted private network. A regression here either:
 *
 *   (a) lets a merchant silently leak wallet tokens over the public
 *       internet, OR
 *   (b) breaks legitimate local-docker / localhost deployments by
 *       rejecting them as "insecure".
 *
 * Both are user-visible failures with security or usability impact,
 * so every branch gets a named test case via the data provider. The
 * method is private static; reflection is the cleanest way to
 * exercise it without introducing a test-only public wrapper.
 */
final class InsecureApiUrlTest extends TestCase
{
    private ReflectionMethod $method;

    protected function setUp(): void
    {
        $this->method = new ReflectionMethod(WC_CryptAPI_Gateway::class, 'is_insecure_api_url');
        $this->method->setAccessible(true);
    }

    /**
     * @dataProvider provideUrls
     */
    public function testClassification(string $url, bool $expectedInsecure, string $reason): void
    {
        $result = $this->method->invoke(null, $url);
        self::assertSame(
            $expectedInsecure,
            $result,
            $reason . " (url=$url)"
        );
    }

    public function provideUrls(): array
    {
        return [
            // --- https:// always passes, regardless of host ---
            'https public host' => [
                'https://grcpay.gridcoin.club',
                false,
                'HTTPS to a public host is the normal production case',
            ],
            'https with port' => [
                'https://grcpay.example.com:8443',
                false,
                'HTTPS is fine on any port',
            ],
            'https to localhost' => [
                'https://localhost:7001',
                false,
                'HTTPS to localhost is fine (even if pointless)',
            ],
            'https with path' => [
                'https://grcpay.example.com/api/v1',
                false,
                'HTTPS with a path prefix is still HTTPS',
            ],

            // --- Plain http:// is REJECTED unless the host is a trusted private one ---
            'http public host' => [
                'http://grcpay.example.com',
                true,
                'Plain HTTP to a public hostname leaks wallet tokens on the wire',
            ],
            'http cloud hostname with port' => [
                'http://grcpay.example.com:7001',
                true,
                'Ports do not make HTTP safe',
            ],
            'http public ip' => [
                'http://203.0.113.42',
                true,
                'HTTP to a public IP literal leaks tokens',
            ],
            'http with query string' => [
                'http://evil.example.com/?forward=attacker',
                true,
                'Query strings do not suddenly make HTTP safe',
            ],

            // --- Trusted private-network allow-list (HTTP is OK) ---
            'http localhost' => [
                'http://localhost:7001',
                false,
                'localhost is the classic dev loopback',
            ],
            'http 127.0.0.1' => [
                'http://127.0.0.1:7001',
                false,
                'IPv4 loopback range is trusted',
            ],
            'http 127.x.x.x any' => [
                'http://127.42.42.42:7001',
                false,
                'All of 127.0.0.0/8 is loopback',
            ],
            'http ipv6 loopback' => [
                'http://[::1]:7001',
                false,
                'IPv6 loopback is trusted',
            ],
            'http rfc1918 10.x' => [
                'http://10.0.0.5:7001',
                false,
                'RFC1918 10.0.0.0/8 is a private network',
            ],
            'http rfc1918 192.168.x' => [
                'http://192.168.1.100',
                false,
                'RFC1918 192.168.0.0/16 is a home/office LAN range',
            ],
            'http rfc1918 172.16 boundary' => [
                'http://172.16.0.1',
                false,
                'RFC1918 172.16.0.0/12 lower boundary',
            ],
            'http rfc1918 172.31 boundary' => [
                'http://172.31.255.254',
                false,
                'RFC1918 172.16.0.0/12 upper boundary',
            ],
            'http 172.15 NOT private' => [
                'http://172.15.1.1',
                true,
                '172.15 is OUTSIDE RFC1918 and must be rejected',
            ],
            'http 172.32 NOT private' => [
                'http://172.32.1.1',
                true,
                '172.32 is OUTSIDE RFC1918 and must be rejected',
            ],
            'http .local mDNS' => [
                'http://grcpay.local',
                false,
                'Link-local mDNS hostnames are trusted',
            ],
            'http docker service name' => [
                'http://grcpay:7001',
                false,
                'Bare docker-style hostnames (no dots) are trusted',
            ],
            'http docker alias lowercase' => [
                'http://grcpay',
                false,
                'Bare hostname without port still trusted',
            ],

            // --- Edge cases ---
            'empty url' => [
                '',
                false,
                'Empty string short-circuits — not our problem, let downstream fail naturally',
            ],
            'malformed url' => [
                'not-a-url',
                false,
                'Malformed input returns false so downstream HTTP client fails with a clearer error',
            ],
            'unknown scheme file://' => [
                'file:///etc/passwd',
                false,
                'Non-http(s) schemes get through the check — they fail elsewhere with proper errors',
            ],
            'uppercase HTTP scheme' => [
                'HTTP://evil.example.com',
                true,
                'Scheme check must be case-insensitive',
            ],
            'uppercase HTTPS scheme' => [
                'HTTPS://grcpay.example.com',
                false,
                'HTTPS is HTTPS regardless of case',
            ],
            'uppercase hostname' => [
                'http://LOCALHOST:7001',
                false,
                'Host check must be case-insensitive',
            ],
        ];
    }
}
