=== Gridcoin Payment Gateway for WooCommerce ===
Contributors: gridcat
Tags: gridcoin, grc, woocommerce, payment gateway, cryptocurrency, crypto, payment, boinc
Requires at least: 5.0
Tested up to: 6.7
Stable tag: 1.0.0
Requires PHP: 7.4
WC requires at least: 5.8
WC tested up to: 9.4
License: MIT


Accept Gridcoin (GRC) payments on your WooCommerce store via grcpay.


== Description ==

Adds a "Gridcoin (GRC)" payment method to WooCommerce. The plugin talks to
[grcpay](https://grcpay.gridcoin.club), an open-source payment proxy that
mints a fresh receiving address per order, watches the chain for incoming
funds, and forwards what it receives to your own Gridcoin wallet.

= How it works =

1. Customer picks **Gridcoin (GRC)** at checkout.
2. The plugin asks grcpay to mint a per-order wallet for the order's GRC total.
3. The customer is redirected to a thank-you page that shows the address,
   a QR code, and a live-updating amount.
4. The plugin polls grcpay every few seconds for the wallet status.
5. Once grcpay confirms the funds, the WC order is marked paid; if the
   payment window elapses with a partial balance, grcpay refunds the
   sender automatically.

The customer's funds settle directly to your Gridcoin wallet. grcpay never
custodies the money — it only watches the address and forwards what it
sees.

= No sign-up, no API key =

You configure two things:

* The grcpay endpoint (the public `https://grcpay.gridcoin.club`, or your
  own deployment).
* Your own GRC receiving address.

= Currency conversion =

grcpay computes the GRC amount from your shop currency at order time using
a 5-minute-cached CoinGecko rate. You can also point the plugin at
grcpay's own `/rates` endpoint if you'd rather not call CoinGecko
directly. The plugin **does not** convert GRC to fiat — settlement stays
in GRC.

= Why Gridcoin? =

Gridcoin is a Proof-of-Research cryptocurrency that rewards BOINC volunteer
computing. Spending GRC at a merchant gives the coin a real-world utility
loop: science compute → block reward → checkout. This plugin is one of
the merchant-side pieces of that loop.


== Installation ==

= Upload via WordPress Dashboard =

1. Plugins → Add New → Upload Plugin.
2. Choose `grcpay-woocommerce.zip`.
3. Install Now → Activate.

= Manually via FTP / SSH =

1. Extract `grcpay-woocommerce.zip` and copy the contents into
   `/wp-content/plugins/grcpay-woocommerce/`.
2. Activate **Gridcoin Payment Gateway for WooCommerce** in the Plugins
   dashboard.

= Updating =

WordPress's automatic update flow works fine; back up your site first as
usual.


== Configuration ==

1. WooCommerce → Settings → Payments.
2. Enable **Gridcoin (GRC)** and click *Manage*.
3. Set:
   * **Payment Proxy URL** — `https://grcpay.gridcoin.club` or your own
     grcpay deployment.
   * *(optional)* **Backup Payment Proxy URL** — used only if the primary
     is unreachable at wallet-creation time.
   * **Gridcoin Address** — the wallet payments are forwarded to.
4. Adjust QR-code size, branding, and order-cancellation timeout to taste.
5. Save.

The settings screen refuses plain-HTTP grcpay URLs that point at a public
host, because wallet tokens travel over that connection and would leak in
plaintext. Loopback, RFC1918, `*.local`, and bare docker-style hostnames
are allowed for development.


== Frequently Asked Questions ==

= Do I need a grcpay API key? =

No. grcpay is anonymous-by-design. You only need your own Gridcoin
receiving address.

= How long does a payment take to confirm? =

The thank-you page flips to "payment confirmed" once grcpay reports the
wallet as `funded`, which is typically a couple of Gridcoin blocks after
the customer hits send. There's a "detected, waiting for confirmations"
banner during the wait.

= Is there a minimum payment? =

Yes — 0.001 GRC. Smaller order totals are rejected at checkout with a
clear error.

= What if the customer doesn't pay? =

If you've configured an *Order cancellation timeout*, the plugin cancels
the WC order and asks grcpay to cancel the wallet. grcpay's
expired-refund flow then returns any partial balance to the sender on its
next cycle.

= What if grcpay is briefly unreachable? =

The plugin tries the backup URL at wallet creation, pins each order to
whichever URL minted it, and the WP-Cron fallback poller (every 30
seconds) re-checks any on-hold GRC orders so a missed AJAX poll
self-heals.

= Where can I get support? =

Open an issue at https://github.com/gridcat/gridcoin.club or ask in the
Gridcoin community channels.


== Changelog ==

= 1.0.0 =
* Initial release.
* Gridcoin (GRC) payment method via grcpay.
* Per-order wallet, QR-code thank-you page, live amount + status polling
  with a per-order WP nonce.
* WP-Cron fallback poller for on-hold orders.
* Primary + backup grcpay URL support with per-order pinning.
* Plain-HTTP refusal for non-private grcpay URLs.
* Merchant-initiated cancellation propagates to grcpay so the
  expired-refund flow returns any partial balance to the sender.
