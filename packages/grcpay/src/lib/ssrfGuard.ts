import { lookup as dnsLookup } from 'dns';
import { promisify } from 'util';
import { isIPv4, isIPv6 } from 'net';
import { config } from '../config';

const dnsLookupAll = promisify(dnsLookup);

// Two-layer URL validation, deliberately split (see the plan / docs):
//
//   isValidWebhookUrl   — SYNTACTIC ONLY. Run at POST /wallets accept
//                          time. No DNS, no socket — we do not ping a
//                          caller-supplied URL at creation.
//   assertSafeWebhookUrl — FULL SSRF GUARD. Run on EVERY delivery. DNS
//                          resolves, every resolved IP is range-checked,
//                          and the connection is pinned to the validated
//                          IP so DNS can't rebind between check and
//                          connect. This is the only place egress DNS
//                          happens.
//
// The origin server sits behind Cloudflare; an outbound POST to an
// attacker-controlled URL that resolves to an internal/loopback address
// is both an SSRF vector and an origin-IP leak. Hence the guard.

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookUrlError';
  }
}

function schemeAllowed(protocol: string): boolean {
  if (protocol === 'https:') return true;
  // http:// only when the operator explicitly allowed private targets
  // (the docker-network test install). Never on a public instance.
  return protocol === 'http:' && config.WEBHOOK_ALLOW_PRIVATE;
}

/**
 * Syntactic-only validation. True iff `rawUrl` is a well-formed
 * absolute http(s) URL with a host and no embedded credentials.
 * Performs NO name resolution.
 */
export function isValidWebhookUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!schemeAllowed(url.protocol)) return false;
  if (!url.hostname) return false;
  // Reject userinfo (http://user:pass@host) — it's never needed for a
  // webhook target and is a classic parser-confusion / credential-leak
  // vector.
  if (url.username || url.password) return false;
  return true;
}

type IpClass = 'ok' | 'private' | 'blocked';

// 'blocked'  — never a valid webhook target, rejected even when
//              WEBHOOK_ALLOW_PRIVATE is on (unspecified, multicast,
//              reserved/broadcast, documentation ranges).
// 'private'  — internal-ish (loopback / RFC1918 / CGNAT / link-local /
//              ULA). Rejected unless WEBHOOK_ALLOW_PRIVATE is on.
// 'ok'       — routable public address.
function classifyIpv4(ip: string): IpClass {
  const parts = ip.split('.').map((o) => Number(o));
  if (parts.length !== 4 || parts.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return 'blocked';
  }
  const [a, b] = parts;
  // Always blocked regardless of WEBHOOK_ALLOW_PRIVATE.
  if (a === 0) return 'blocked'; // 0.0.0.0/8 "this network"
  if (a >= 224) return 'blocked'; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  if (a === 192 && b === 0 && parts[2] === 0) return 'blocked'; // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && parts[2] === 2) return 'blocked'; // TEST-NET-1
  if (a === 198 && b === 51 && parts[2] === 100) return 'blocked'; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return 'blocked'; // TEST-NET-3
  if (a === 198 && (b === 18 || b === 19)) return 'blocked'; // 198.18/15 benchmarking
  // Private-ish: rejected unless the operator opted in.
  if (a === 10) return 'private';
  if (a === 127) return 'private'; // loopback
  if (a === 169 && b === 254) return 'private'; // link-local
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT 100.64/10
  return 'ok';
}

function classifyIpv6(raw: string): IpClass {
  const ip = raw.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d) — unwrap and apply the v4 rules so a
  // mapped private address can't sneak past. WHATWG URL parsing
  // normalizes mapped literals to the compact hex pair form
  // (`[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`), so we MUST match
  // BOTH the dotted form AND the compact hex form. Without the hex
  // branch, `::ffff:7f00:1` falls through every classifier branch to
  // 'ok' — a full SSRF guard bypass that would let
  // `https://[::ffff:169.254.169.254]/` (AWS instance metadata) and
  // every private IPv4 reach the dispatcher.
  const mappedDotted = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return classifyIpv4(mappedDotted[1]);
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    // Each pair encodes two octets of the underlying IPv4 in
    // network byte order: `::ffff:AABB:CCDD` ⇒ AA.BB.CC.DD.
    const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return classifyIpv4(dotted);
  }
  // 6to4 (2002::/16) embeds an IPv4 in the 2nd+3rd hextets:
  // 2002:AABB:CCDD:: → AA.BB.CC.DD. Without unwrapping it, a target
  // like 2002:7f00:1:: (127.0.0.1) or a private-range embedding would
  // tunnel straight past the classifier to 'ok'.
  const sixToFour = ip.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1], 16);
    const lo = parseInt(sixToFour[2], 16);
    return classifyIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }
  // NAT64 well-known prefix (64:ff9b::/96) embeds the IPv4 in the last
  // 32 bits: 64:ff9b::AABB:CCDD → AA.BB.CC.DD (WHATWG normalizes the
  // dotted form to this compact hex pair).
  const nat64 = ip.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64) {
    const hi = parseInt(nat64[1], 16);
    const lo = parseInt(nat64[2], 16);
    return classifyIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
  }
  if (ip === '::' || ip === '::0') return 'blocked'; // unspecified
  if (ip.startsWith('ff')) return 'blocked'; // ff00::/8 multicast
  if (ip.startsWith('2001:db8')) return 'blocked'; // documentation
  if (ip === '::1') return 'private'; // loopback
  // fe80::/10 link-local (fe80–febf) and fc00::/7 ULA (fc/fd).
  if (/^fe[89ab]/.test(ip)) return 'private';
  if (ip.startsWith('fc') || ip.startsWith('fd')) return 'private';
  return 'ok';
}

function classifyIp(ip: string): IpClass {
  return isIPv4(ip) ? classifyIpv4(ip) : classifyIpv6(ip);
}

export interface SafeWebhookTarget {
  url: URL;
  pinnedIp: string;
  family: 4 | 6;
}

/**
 * Full guard. Throws WebhookUrlError if the URL is syntactically bad,
 * uses a disallowed scheme, fails to resolve, or ANY resolved address
 * is in a disallowed range. On success returns the validated URL plus
 * the single IP the caller MUST pin the connection to (see
 * createPinnedLookup) — resolving again at connect time would reopen a
 * DNS-rebinding window.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<SafeWebhookTarget> {
  if (!isValidWebhookUrl(rawUrl)) {
    throw new WebhookUrlError(`Webhook URL is not a valid http(s) URL: ${rawUrl}`);
  }
  const url = new URL(rawUrl);

  // WHATWG URL preserves brackets on IPv6-literal hostnames
  // (new URL('http://[::1]/').hostname === '[::1]'), but dns.lookup /
  // getaddrinfo does NOT accept bracketed input and throws ENOTFOUND.
  // Strip the brackets before any DNS-or-classify work so legitimate
  // IPv6-literal webhook URLs (https://[2001:db8::1]/hook,
  // http://[fd00::1]/hook under WEBHOOK_ALLOW_PRIVATE) reach
  // classifyIpv6 instead of being rejected as "did not resolve".
  const bareHostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;

  // Short-circuit DNS for literal IPv4/IPv6: dns.lookup on a literal
  // round-trips through getaddrinfo for nothing, and the classify
  // step is the only thing that matters anyway.
  let resolved: { address: string; family: number }[];
  if (isIPv4(bareHostname)) {
    resolved = [{ address: bareHostname, family: 4 }];
  } else if (isIPv6(bareHostname)) {
    resolved = [{ address: bareHostname, family: 6 }];
  } else {
    try {
      resolved = await dnsLookupAll(bareHostname, { all: true });
    } catch (e) {
      throw new WebhookUrlError(`Webhook host did not resolve (${url.hostname}): ${e}`);
    }
  }
  if (!resolved.length) {
    throw new WebhookUrlError(`Webhook host resolved to no addresses: ${url.hostname}`);
  }

  const allowPrivate = config.WEBHOOK_ALLOW_PRIVATE;
  for (const { address } of resolved) {
    const klass = classifyIp(address);
    if (klass === 'blocked' || (klass === 'private' && !allowPrivate)) {
      throw new WebhookUrlError(
        `Webhook host ${url.hostname} resolves to a disallowed address `
        + `(${address}, ${klass}) — refusing to deliver.`,
      );
    }
  }

  // Pin to the first resolved address (all passed the range check).
  const chosen = resolved[0];
  return {
    url,
    pinnedIp: chosen.address,
    family: isIPv4(chosen.address) ? 4 : 6,
  };
}

// Node's dns.lookup signature, narrowed to the shapes the http(s)
// Agent actually invokes. Returning the pre-validated IP here is what
// pins the TCP connection to the address we range-checked, defeating a
// rebind between assertSafeWebhookUrl and connect.
type LookupCb = (err: Error | null, address: string, family: number) => void;
type LookupAllCb = (err: Error | null, addresses: { address: string; family: number }[]) => void;

export function createPinnedLookup(pinnedIp: string, family: 4 | 6) {
  return function pinnedLookup(
    _hostname: string,
    options: { all?: boolean } | LookupCb,
    callback?: LookupCb | LookupAllCb,
  ): void {
    const cb = (typeof options === 'function' ? options : callback)!;
    const all = typeof options === 'object' && options?.all === true;
    if (all) {
      (cb as LookupAllCb)(null, [{ address: pinnedIp, family }]);
    } else {
      (cb as LookupCb)(null, pinnedIp, family);
    }
  };
}
