<p align="center">
  <img src="static/files/logo_grc.png" width="420" alt="grcpay">
</p>

# Gridcoin Payment Gateway for WooCommerce

Accept Gridcoin (GRC) payments on your WooCommerce store. The plugin talks to
[grcpay](https://grcpay.gridcoin.club) — an open-source payment proxy that
mints a fresh GRC address per order, watches it for incoming funds, and
forwards what it receives to your own wallet.

### Requirements

```
PHP        >= 7.4
WordPress  >= 5.0
WooCommerce >= 5.8
A grcpay endpoint (https://grcpay.gridcoin.club, or self-hosted)
A Gridcoin address you own (S- prefix for mainnet, m/n for testnet)
```

### What it does

- Adds a "Gridcoin (GRC)" payment method to WooCommerce checkout.
- On Place Order, calls grcpay to mint a per-order receiving wallet and
  redirects the customer to a thank-you page that shows the address, a QR
  code, and a live-updating amount.
- Polls grcpay for confirmation and flips the WC order to paid when the
  customer has sent enough GRC.
- Forwards funds from the per-order wallet to the merchant's address you
  configure in the gateway settings.
- Refunds partial payments automatically when an order's payment window
  elapses (handled on grcpay's side; the plugin surfaces the refund tx
  and amount on the order timeline).

Files never leave the customer's wallet — the plugin only ever sees
on-chain addresses, transaction IDs, and grcpay's own status enum.

### Why grcpay instead of an exchange?

- No sign-up, no KYC, no API keys — you only configure your own GRC
  receiving address.
- Funds settle directly to your wallet. grcpay never custodies them.
- The price the customer pays is converted from your shop currency to
  GRC at order time using a 5-minute-cached CoinGecko rate (or grcpay's
  own `/rates` endpoint if you'd rather not call CoinGecko from your
  store).

The plugin does **not** convert GRC to fiat. If you need that, run a
self-hosted exchange relay or wait for the atomic-swap support that
grcpay is tracking on the roadmap.

### Installation

#### From a downloaded ZIP

1. Build or download `grcpay-woocommerce.zip` (see the package-level
   `README.md` for `npm run build`).
2. WordPress admin → **Plugins → Add New → Upload Plugin**.
3. Choose `grcpay-woocommerce.zip`, click *Install Now*, then *Activate*.

#### Manually via FTP / SSH

1. Copy the contents of `plugin/` into
   `/wp-content/plugins/grcpay-woocommerce/` on your server.
2. WordPress admin → **Plugins** → activate **Gridcoin Payment Gateway for
   WooCommerce**.

### Configuration

1. WooCommerce → **Settings → Payments**.
2. Enable **Gridcoin (GRC)**, click *Manage*.
3. Fill in:
   - **Payment Proxy URL** — `https://grcpay.gridcoin.club` (the public
     test instance), or your own grcpay deployment.
   - **Backup Payment Proxy URL** *(optional)* — used only if the primary
     is unreachable at wallet-creation time. Each order is then pinned to
     whichever URL minted it.
   - **Gridcoin Address** — the wallet you want payments forwarded to.
4. Tweak the QR-code, branding, and order-cancellation timeout knobs to
   taste.
5. Save.

The settings screen will refuse to accept a plain-HTTP `Payment Proxy URL`
that points at a public host — wallet tokens travel over that connection
and would leak in plaintext. Loopback, RFC1918, `*.local`, and bare
docker-style hostnames are allowed for development.

### FAQ

#### Do I need an API key for grcpay?

No. grcpay is anonymous-by-design. You just point the plugin at a grcpay
URL and supply your own GRC receiving address.

#### How long until a payment is confirmed?

grcpay reports `funded` (the chain has seen the tx) and `processed` (the
forward to the merchant address landed). The plugin marks the WC order
paid as soon as `funded` is reported, which is typically a couple of
Gridcoin blocks after the customer hits send. Customers see a "payment
detected, waiting for confirmations" banner during that window.

#### Is there a minimum payment?

Yes — `MINIMUM_TX = 0.001 GRC`. Orders that round below the minimum are
rejected at checkout with a clear notice.

#### What happens if the customer doesn't pay?

If you set an *Order cancellation timeout* in the gateway settings, the
plugin cancels the WC order and asks grcpay to cancel the wallet. grcpay
then runs its expired-refund flow, which returns any partial balance to
the original sender on the next cycle.

#### What happens if grcpay is briefly unreachable?

- During order creation: the plugin tries the backup URL if you've set
  one. Each order is pinned to the URL that minted its wallet, so all
  later polls go to the same backend.
- During status polling: the AJAX handler logs the failure and the
  thank-you page keeps polling. A WP-Cron job also re-checks all on-hold
  GRC orders every 30 seconds, so missed AJAX polls self-heal.

#### Where can I get support?

Open an issue at
[github.com/gridcat/gridcoin.club](https://github.com/gridcat/gridcoin.club)
or join the discussion on the Gridcoin community channels. This is a
community plugin maintained alongside grcpay itself.

### Changelog

#### 1.0.0
- Initial release.
- Adds the **Gridcoin (GRC)** payment method to WooCommerce checkout.
- Per-order grcpay wallet, QR-code thank-you page, live amount + status
  polling via AJAX with a per-order WP nonce.
- WP-Cron fallback poller for on-hold orders.
- Primary + backup grcpay URL support with per-order pinning.
- Plain-HTTP refusal for non-private grcpay URLs (wallet token leak
  protection).
- Merchant-initiated order cancellation propagates to grcpay so the
  expired-refund flow returns any partial balance to the sender.
