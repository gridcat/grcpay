# grcpay-woocommerce-demo

Fresh WordPress + WooCommerce install used as a **live demo** for the
[`grcpay-woocommerce`](../grcpay-woocommerce) plugin. Anyone can hit the URL,
poke the checkout, and see the grcpay payment gateway in action end-to-end.

Not a generic demo environment — this package only exists to exercise the
plugin in `../grcpay-woocommerce/plugin/`, which is mounted in as a volume so
plugin edits reflect live without a rebuild.

## How it boots

**The demo is intentionally ephemeral.** Every container start wipes the
WordPress database and reprovisions from scratch — demo orders, signups, and
test wallet metadata never accumulate. The only thing that persists across
boots is the grcpay-woocommerce plugin itself, because it is bind-mounted
from the monorepo.

1. `Dockerfile` extends `wordpress:6.7-apache` and layers in WP-CLI plus a
   couple of helper scripts.
2. `docker-entrypoint.sh` is our wrapper. On every boot it:
   - `DROP DATABASE` + `CREATE DATABASE` against the shared `grc_mysql`
     container, targeting only the `wordpress` db
   - kicks off `wp-provision` in the background
   - hands control to the upstream wordpress entrypoint so apache comes up
3. `wp-provision.sh` polls until WP core files + the (freshly empty) database
   are ready, then:
   - `wp core install` with the demo admin
   - installs and activates **WooCommerce**
   - installs the **Storefront** theme
   - activates the **grcpay-woocommerce** plugin from the bind-mounted
     monorepo directory
   - seeds a few sample products
   - sets sensible store settings and points the homepage at the shop

## Configuration

All tunable values live in `grc-infra/grcpay_wc_demo.env` (gitignored, copy
from the committed `grcpay_wc_demo.env.example` before the first `docker
compose up`). Never inline secrets in `docker-compose.yaml` — the compose
file references the env file, so any edits you make propagate without
touching version-controlled yaml.

**⚠️ `WORDPRESS_DB_NAME` is reserved.** `docker-entrypoint.sh` runs
`DROP DATABASE IF EXISTS $WORDPRESS_DB_NAME; CREATE DATABASE …` against
the shared `grc_mysql` container on **every** container boot. The default
is `wordpress` and must not be reused by another service sharing that
MariaDB instance — if you rename it to something a different service also
writes to, that service's data will be obliterated on every demo restart.

## Demo credentials

Two accounts are created on each boot, each overridable via env vars:

| User    | Role           | Capability summary                       | Env vars                                      |
| ------- | -------------- | ---------------------------------------- | --------------------------------------------- |
| `admin` | administrator  | Full backend. Reserved for maintenance.  | `WP_ADMIN_USER`, `WP_ADMIN_PASS`, `WP_ADMIN_EMAIL` |
| `demo`  | demo_viewer    | Can inspect and work with WC orders only | `WP_DEMO_USER`, `WP_DEMO_PASS`, `WP_DEMO_EMAIL`    |

**`demo_viewer`** is a custom role created on boot and paired with a must-use
plugin (`grcpay-demo-viewer.php`) that:

- Denies every write/create/delete capability outside a narrow order
  allow-list (`edit_shop_order*`, `read_*`, etc).
- Hides the WC Settings, Status, Plugins, Themes, Users, Tools and top-level
  Posts/Pages/Media/Comments admin menus.
- Guards the same screens server-side so a pasted URL still hits a 403.
- Redirects the admin landing page straight to **WooCommerce → Orders**.

Visitors who want to test the checkout flow do **not** need to log in at all
— the storefront is fully anonymous. Logging in as `demo/demo` is only
useful for poking around the orders admin.

The defaults above (`admin/admin`, `demo/demo`) are intentionally weak
because the demo is a throwaway ephemeral sandbox. Do **not** reuse these
defaults anywhere else.

## Running it

The service is wired into the repo-wide Docker Compose stack in
`grc-infra/docker-compose.yaml` as `grcpay_wc_demo`. Bring up the whole stack
with:

```bash
cd ../../../grc-infra
docker compose up
```

Then visit:

- **Storefront**: http://localhost:8000
- **Admin**:      http://localhost:8000/wp-admin  (`demo` / `demo`)
- **grcpay API**: http://localhost:7001

## Resetting the demo

Just restart it — the entrypoint drops the wordpress db and reprovisions on
every boot:

```bash
docker compose -f grc-infra/docker-compose.yaml restart grcpay_wc_demo
```

`docker compose up` (with or without `--force-recreate`) gives the same
behaviour. There is no persistent volume to wipe.

## Hacking on the plugin

Edit files under `../grcpay-woocommerce/plugin/` — they show up live inside
the container at `/var/www/html/wp-content/plugins/grcpay-woocommerce/`
because the directory is bind-mounted from the host. PHP is interpreted
per-request so a browser refresh is all you need; you do **not** need to
restart the container to pick up plugin changes.

Restart the container only when you want a clean database (fresh orders,
users, settings) or when you change something that WordPress reads at
activation time and you need the provisioning script to re-run.
