FROM wordpress:6.8-apache

# WP-CLI + mariadb-client (used by the provisioning script to wait on the DB).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        less \
        default-mysql-client \
        ca-certificates \
        curl; \
    rm -rf /var/lib/apt/lists/*; \
    curl -sSLo /usr/local/bin/wp \
        https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar; \
    chmod +x /usr/local/bin/wp

COPY wp-provision.sh         /usr/local/bin/wp-provision
COPY docker-entrypoint.sh    /usr/local/bin/grcpay-demo-entrypoint
# Must-use plugins are copied into a staging location that survives the
# entrypoint's /var/www/html cleanup — the provision script installs them
# from here on every boot.
COPY mu-plugins/             /usr/local/share/grcpay-demo/mu-plugins/
RUN chmod +x /usr/local/bin/wp-provision /usr/local/bin/grcpay-demo-entrypoint

# Wrap the upstream wordpress entrypoint so we can kick off first-boot
# provisioning in the background, then hand off to apache as usual.
ENTRYPOINT ["grcpay-demo-entrypoint"]
CMD ["apache2-foreground"]
