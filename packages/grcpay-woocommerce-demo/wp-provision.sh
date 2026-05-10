#!/usr/bin/env bash
# Fresh-init provisioning for the grcpay demo shop.
#
# Runs in the background from docker-entrypoint.sh on EVERY container boot.
# The entrypoint drops and recreates the wordpress database just before
# invoking this script, so there is no idempotency to worry about — we always
# run a clean `wp core install`, re-install WooCommerce, re-activate the
# plugin, and re-seed sample products. Any previous demo orders, users, or
# wallet metadata are gone.
#
# Plugin activation targets the volume-mounted grcpay-woocommerce plugin from
# the monorepo (../grcpay-woocommerce/plugin), so edits take effect live —
# provisioning doesn't copy it anywhere, it just activates whatever is there.

set -euo pipefail

WP_PATH="/var/www/html"
WP="wp --path=${WP_PATH} --allow-root"

log() { echo "[wp-provision] $*"; }

# --- wait for the upstream entrypoint to finish writing wp-config.php ---
log "waiting for wp-config.php…"
for _ in $(seq 1 120); do
    [ -f "${WP_PATH}/wp-config.php" ] && break
    sleep 2
done
if [ ! -f "${WP_PATH}/wp-config.php" ]; then
    log "wp-config.php never appeared — giving up"
    exit 1
fi

# --- wait for the (freshly-recreated) database to accept queries ---
# We can't use `wp db check` here because it runs CHECK TABLE on the WP core
# tables, which don't exist yet in the db we just dropped and recreated. A
# raw `SELECT 1` is the right question: can the WP user reach the db at all.
log "waiting for database…"
for _ in $(seq 1 60); do
    if $WP db query 'SELECT 1' >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

# --- WP core install ---
# Admin is a real administrator, used for backend maintenance. The `demo`
# user created later is a restricted read-mostly account for public visitors
# (see `demo_viewer` role setup further down).
log "installing WordPress core…"
$WP core install \
    --url="${WP_DEMO_URL:-http://localhost:8000}" \
    --title="${WP_DEMO_TITLE:-grcpay demo shop}" \
    --admin_user="${WP_ADMIN_USER:-admin}" \
    --admin_password="${WP_ADMIN_PASS:-admin}" \
    --admin_email="${WP_ADMIN_EMAIL:-admin@grcpay.local}" \
    --skip-email

# --- install the demo-viewer mu-plugin ---
# Must-use plugins load automatically on every request and can't be turned
# off from the admin UI. The one we install here enforces the demo_viewer
# role's read-mostly restrictions.
if [ -d /usr/local/share/grcpay-demo/mu-plugins ]; then
    log "installing grcpay demo mu-plugins…"
    mkdir -p "${WP_PATH}/wp-content/mu-plugins"
    cp -a /usr/local/share/grcpay-demo/mu-plugins/. "${WP_PATH}/wp-content/mu-plugins/"
fi

# wp-provision runs as root (via --allow-root), but apache serves
# requests as www-data. WC writes debug logs and customer uploads to
# wp-content/uploads/, and if that directory is still root-owned after
# install, every failed checkout spews a PHP warning ("touch(): Unable
# to create file .../wc-logs/...: Permission denied"). Make sure the
# tree exists and is owned by the apache user up front.
mkdir -p "${WP_PATH}/wp-content/uploads/wc-logs"
chown -R www-data:www-data "${WP_PATH}/wp-content/uploads"
chmod -R u+rwX,g+rwX "${WP_PATH}/wp-content/uploads"

# --- WooCommerce ---
log "installing and activating WooCommerce…"
$WP plugin install woocommerce --activate

# Suppress WC's first-run setup wizard and onboarding nags.
# (woocommerce_task_list_hidden was removed in recent WC — the onboarding
# profile's "completed" flag now hides the task list on its own.)
$WP option update woocommerce_onboarding_profile '{"completed":true}' --format=json || true
$WP option update woocommerce_show_marketplace_suggestions no || true

# WC ships with a "Store Launch / Coming Soon" block that replaces the
# entire storefront with a placeholder page until the merchant flips a
# switch. Fresh installs default it to `yes`, which means every demo
# boot would hide the seeded products behind "Great things are on the
# horizon". Kill it here so anonymous visitors see the real shop on
# first request.
$WP option update woocommerce_coming_soon no || true
$WP option update woocommerce_store_pages_only no || true

# --- restricted demo viewer role + user ---
# Creates a `demo_viewer` role seeded with the minimum set of capabilities
# needed to inspect and work with WooCommerce orders. The companion mu-plugin
# (grcpay-demo-viewer.php) filters map_meta_cap to deny every write that
# isn't on a narrow order-related allow-list, and hides the WC Settings /
# Plugins / Themes / Users admin surfaces so a URL-paste can't sneak around.
log "creating demo_viewer role…"
$WP eval '
if (!get_role("demo_viewer")) {
    add_role("demo_viewer", "Demo Viewer", [
        "read"                         => true,
        "manage_woocommerce"           => true,
        "view_woocommerce_reports"     => true,
        "read_product"                 => true,
        "read_private_products"        => true,
        "read_shop_order"              => true,
        "read_private_shop_orders"     => true,
        "read_others_shop_orders"      => true,
        "edit_shop_order"              => true,
        "edit_shop_orders"             => true,
        "edit_others_shop_orders"      => true,
        "edit_published_shop_orders"   => true,
        "edit_private_shop_orders"     => true,
    ]);
    echo "created demo_viewer role\n";
} else {
    echo "demo_viewer role already exists\n";
}
' || true

log "creating demo user…"
DEMO_USER="${WP_DEMO_USER:-demo}"
DEMO_PASS="${WP_DEMO_PASS:-demo}"
DEMO_EMAIL="${WP_DEMO_EMAIL:-demo-viewer@grcpay.local}"
if $WP user get "${DEMO_USER}" >/dev/null 2>&1; then
    $WP user update "${DEMO_USER}" --user_pass="${DEMO_PASS}" --role=demo_viewer || true
else
    $WP user create "${DEMO_USER}" "${DEMO_EMAIL}" \
        --role=demo_viewer \
        --user_pass="${DEMO_PASS}" \
        --display_name="Demo Viewer" || true
fi

# --- storefront theme (official WC theme, looks decent out of the box) ---
log "installing and activating the Storefront theme…"
$WP theme install storefront --activate || log "storefront install failed, keeping default theme"

# --- grcpay-woocommerce plugin (mounted from the monorepo as a volume) ---
if [ -d "${WP_PATH}/wp-content/plugins/grcpay-woocommerce" ]; then
    log "activating grcpay-woocommerce plugin…"
    $WP plugin activate grcpay-woocommerce || log "activation failed — the plugin may not be compatible yet"

    # Seed the gateway settings so the payment method actually shows up at
    # checkout. Without these, WC_Payment_Gateway::is_available() returns
    # false because the plugin treats an empty grc_address/api_url as
    # "needs setup" and refuses to render on the checkout page.
    #
    # The grcpay API URL defaults to http://grcpay:7001 so the demo hits our
    # own dev grcpay container (resolved via the docker link). PHP is the
    # only caller of this URL — the browser polls WP's admin-ajax.php, not
    # grcpay directly, so the url doesn't need to be reachable from the
    # user's browser.
    # Modern WC defaults the Cart and Checkout pages to the Gutenberg
    # `woocommerce/cart` and `woocommerce/checkout` blocks. The block-based
    # checkout hides classic payment gateways that haven't declared block
    # compatibility via the block-checkout registration API — and grcpay is
    # a classic gateway (the codebase predates WC blocks). Result: the
    # checkout page says "There are no payment methods available" even
    # though WC()->payment_gateways() server-side reports the grcpay
    # gateway as available.
    #
    # Fix: rewrite the Cart and Checkout page content to use the classic
    # shortcodes, which surface all enabled classic gateways. Long-term the
    # plugin should add block support; short-term this is the right thing
    # for the demo.
    log "reverting Cart/Checkout pages to classic shortcodes (so the classic gateway shows up)…"
    CHECKOUT_ID=$($WP option get woocommerce_checkout_page_id 2>/dev/null || echo "")
    if [ -n "${CHECKOUT_ID}" ] && [ "${CHECKOUT_ID}" != "0" ]; then
        $WP post update "${CHECKOUT_ID}" --post_content='[woocommerce_checkout]' || true
    fi
    CART_ID=$($WP option get woocommerce_cart_page_id 2>/dev/null || echo "")
    if [ -n "${CART_ID}" ] && [ "${CART_ID}" != "0" ]; then
        $WP post update "${CART_ID}" --post_content='[woocommerce_cart]' || true
    fi

    log "configuring grcpay gateway settings…"
    GRCPAY_API_URL="${GRCPAY_DEMO_API_URL:-http://grcpay:7001}"
    # The local grc_wallet container runs gridcointestnetd, so the recipient
    # must be a TESTNET address (m/n prefix). We default to the grc_wallet's
    # own default account address (the one `getaccountaddress ""` returns)
    # so the demo is a full loopback: testnet coins the user sends to a
    # grcpay-minted wallet get forwarded straight back to the same wallet
    # they came from. If you're repointing the demo at a mainnet grc_wallet,
    # override GRCPAY_DEMO_ADDRESS with an S-prefix address instead.
    #
    # This address is stable across container restarts because it lives in
    # .GridcoinResearch/testnet/wallet.dat (bind-mounted from the host).
    GRCPAY_ADDRESS="${GRCPAY_DEMO_ADDRESS:-n3NA3AwTMEc3Bs6Wrth66armFbmmEfqSj8}"
    $WP option update woocommerce_grcpay_settings --format=json "$(cat <<JSON
{
  "enabled": "yes",
  "title": "Gridcoin (GRC)",
  "description": "Pay with Gridcoin cryptocurrency — try it with a tiny amount, fees are almost nothing.",
  "api_url": "${GRCPAY_API_URL}",
  "grc_address": "${GRCPAY_ADDRESS}",
  "show_branding": "yes",
  "qrcode_default": "yes",
  "qrcode_size": "300",
  "color_scheme": "light",
  "order_cancelation_timeout": "0",
  "auto_complete_virtual": "no",
  "disable_conversion": "no",
  "use_proxy_rates": "no"
}
JSON
)"
else
    log "WARNING: grcpay-woocommerce plugin dir not found — is the volume mounted?"
fi

# --- store settings ---
log "configuring store settings…"
$WP option update woocommerce_store_address "1 Demo Avenue"
$WP option update woocommerce_store_city "Demo City"
$WP option update woocommerce_default_country "US:CA"
$WP option update woocommerce_store_postcode "00000"
$WP option update woocommerce_currency "USD"
$WP option update woocommerce_product_type physical
$WP option update woocommerce_allow_tracking no

# --- kill comments + product reviews (spam magnet) ---
log "disabling comments and product reviews…"
$WP option update default_comment_status closed
$WP option update default_ping_status closed
$WP option update comment_registration 1
$WP option update comments_notify 0
$WP option update moderation_notify 0
$WP option update woocommerce_enable_reviews no
# Close comments on the sample "Hello world" post and sample page if they
# exist. wp post update accepts multiple IDs in one call, which is cleaner
# than piping through xargs (and sidesteps xargs getting confused by the
# space-separated IDs that --format=ids emits on a single line).
EXISTING_POST_IDS=$($WP post list --post_type=post,page --format=ids 2>/dev/null || true)
if [ -n "${EXISTING_POST_IDS}" ]; then
    # Intentionally unquoted so IDs are passed as separate args.
    $WP post update ${EXISTING_POST_IDS} --comment_status=closed --ping_status=closed || true
fi

# --- sample products ---
# Tiny prices on purpose so visitors can test with a real transaction without
# spending meaningful money — the whole point of the demo is to watch a real
# GRC payment flow end-to-end. Products are created as virtual=true so WC
# doesn't demand a shipping method at checkout (without a shipping zone,
# physical products cause WC to hide ALL payment gateways, including grcpay).
log "seeding sample products…"
$WP wc product create --name="Gridcoin Sticker (single)" --regular_price="0.01" --type=simple --virtual=1 --status=publish --reviews_allowed=false --user=1 || true
$WP wc product create --name="GRC Research Postcard"     --regular_price="0.02" --type=simple --virtual=1 --status=publish --reviews_allowed=false --user=1 || true
$WP wc product create --name="BOINC Bumper Sticker"      --regular_price="0.03" --type=simple --virtual=1 --status=publish --reviews_allowed=false --user=1 || true
$WP wc product create --name="Gridcoin Enamel Badge"     --regular_price="0.05" --type=simple --virtual=1 --status=publish --reviews_allowed=false --user=1 || true

# Safety net: add a worldwide free-shipping zone so any physical product
# added later still gets a shipping method and doesn't accidentally hide all
# payment gateways. Uses wp eval because WC CLI has no shipping-zone command.
log "adding worldwide free-shipping zone…"
$WP eval '
$existing = WC_Shipping_Zones::get_zones();
if (empty($existing)) {
    $zone = new WC_Shipping_Zone();
    $zone->set_zone_name("Worldwide");
    $zone->set_zone_order(0);
    $zone->save();
    $zone->add_shipping_method("free_shipping");
    echo "created zone " . $zone->get_id() . PHP_EOL;
} else {
    echo "shipping zone already exists" . PHP_EOL;
}
' || true

# --- front page → the shop ---
log "pointing the front page at the shop…"
SHOP_ID=$($WP option get woocommerce_shop_page_id 2>/dev/null || echo "")
if [ -n "${SHOP_ID}" ] && [ "${SHOP_ID}" != "0" ]; then
    $WP option update show_on_front page
    $WP option update page_on_front "${SHOP_ID}"
fi

# --- pretty permalinks (WP default is ugly ?p=123) ---
$WP rewrite structure '/%postname%/' --hard || true
$WP rewrite flush --hard || true

# --- final ownership sweep for wp-content/uploads ---
# The initial chown/mkdir at the top of this script creates the dir
# owned by www-data, but several wp-cli actions that follow (WC plugin
# activation, product creation, storefront theme install) run as root
# via --allow-root and can lazily create files/dirs inside uploads/
# that end up root-owned. Apache then can't write to them and every
# failed checkout spews a PHP warning. Do a final recursive chown
# here, after all wp-cli activity has settled, so the persisted state
# is always apache-writable regardless of what touched it in between.
log "final wp-content/uploads ownership sweep…"
chown -R www-data:www-data "${WP_PATH}/wp-content/uploads" || true
chmod -R u+rwX,g+rwX "${WP_PATH}/wp-content/uploads" || true

log "done — visit ${WP_DEMO_URL:-http://localhost:8000}"
