#!/usr/bin/env bash
# Wrapper around the upstream wordpress image entrypoint.
#
# The upstream entrypoint (also named docker-entrypoint.sh, living at
# /usr/local/bin in the base image) copies WP core into /var/www/html on first
# boot and writes wp-config.php from WORDPRESS_DB_* env vars. It does NOT run
# `wp core install`, so the site would normally boot straight into the WP
# 5-minute install screen.
#
# We kick off wp-provision in the background — it polls until WP is
# configured, then runs `wp core install`, installs WooCommerce, creates the
# demo admin, seeds products, and activates the grcpay-woocommerce plugin
# (which is mounted in from the monorepo). Once provisioning is done it touches
# a sentinel file and subsequent boots skip straight to apache.

set -e

# The wordpress:X-apache image ships TWO copies of WP core:
#   /usr/src/wordpress    — the pristine, up-to-date copy (currently 6.8.x)
#   /var/www/html         — an older snapshot baked into the image layer (6.7.x)
# The upstream entrypoint only extracts from /usr/src/wordpress when
# /var/www/html has no wp-includes/version.php, which it already does, so it
# skips the copy and we're stuck on the older version — which is below
# WooCommerce's minimum (6.8). Fix: wipe /var/www/html on every boot so the
# upstream entrypoint always re-extracts the fresh copy. We preserve
# wp-content/plugins/grcpay-woocommerce because it is a bind mount from the
# monorepo — touching it would fail noisily and we want edits to persist.
echo "[entrypoint] cleaning /var/www/html to force fresh WP core extract…"
find /var/www/html -mindepth 1 -maxdepth 1 -not -name 'wp-content' -exec rm -rf {} +
if [ -d /var/www/html/wp-content ]; then
    find /var/www/html/wp-content -mindepth 1 -maxdepth 1 -not -name 'plugins' -exec rm -rf {} +
fi
if [ -d /var/www/html/wp-content/plugins ]; then
    find /var/www/html/wp-content/plugins -mindepth 1 -maxdepth 1 -not -name 'grcpay-woocommerce' -exec rm -rf {} +
fi

# The grcpay-woocommerce plugin is bind-mounted from the host, so its files
# keep the host's permissions (often 0770 owned by the developer's UID). WP
# CLI runs as root so it can read them, but apache runs as www-data and can't
# — the gateway then silently fails to load in HTTP render context, and the
# checkout page shows "no available payment methods". A recursive chmod fixes
# this on every boot and is safe because we're root inside the container.
if [ -d /var/www/html/wp-content/plugins/grcpay-woocommerce ]; then
    chmod -R a+rX /var/www/html/wp-content/plugins/grcpay-woocommerce 2>/dev/null || true
fi

# The demo is intentionally ephemeral: every container start drops and
# recreates the wordpress database so demo orders, signups, and test wallet
# metadata never carry over. The grc_mysql service is shared with the rest of
# the stack, so we can't just throw away its data volume — we target the
# wordpress database specifically and leave everything else alone.
#
# wp-provision then re-runs `wp core install` against the fresh db on every
# boot. wp-config.php inside the container's layer persists across restarts,
# which is fine because it's just credentials — the actual state lives in the
# database we just wiped.
#
# WORDPRESS_DB_* env vars are the same ones the upstream entrypoint reads to
# render wp-config.php, so there's one source of truth for the credentials WP
# actually runs as. The reset itself needs DROP/CREATE DATABASE which a
# per-database user doesn't have, so it runs as root via MYSQL_ROOT_PASSWORD
# and then re-grants the WP user privileges on the fresh database.
if [ -n "${WORDPRESS_DB_HOST:-}" ] && [ -n "${WORDPRESS_DB_NAME:-}" ]; then
    echo "[entrypoint] resetting database '${WORDPRESS_DB_NAME}' on ${WORDPRESS_DB_HOST}…"
    DB_HOST="${WORDPRESS_DB_HOST%%:*}"
    DB_PORT="${WORDPRESS_DB_HOST#*:}"
    if [ "${DB_PORT}" = "${WORDPRESS_DB_HOST}" ]; then DB_PORT=3306; fi

    RESET_SQL="DROP DATABASE IF EXISTS \`${WORDPRESS_DB_NAME}\`;
               CREATE DATABASE \`${WORDPRESS_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
               GRANT ALL PRIVILEGES ON \`${WORDPRESS_DB_NAME}\`.* TO '${WORDPRESS_DB_USER}'@'%';
               FLUSH PRIVILEGES;"

    reset_ok=0
    for _ in $(seq 1 60); do
        if MYSQL_PWD="${MYSQL_ROOT_PASSWORD}" mysql -h "${DB_HOST}" -P "${DB_PORT}" -u root \
                 -e "${RESET_SQL}" 2>/tmp/mysql-reset.err; then
            echo "[entrypoint] database reset."
            reset_ok=1
            break
        fi
        sleep 2
    done
    if [ "${reset_ok}" != "1" ]; then
        echo "[entrypoint] FAILED to reset database after retries. Last error:"
        cat /tmp/mysql-reset.err >&2 || true
    fi
fi

/usr/local/bin/wp-provision &

exec docker-entrypoint.sh "$@"
