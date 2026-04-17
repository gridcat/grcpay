#!/usr/bin/env bash
# Produce a distributable WordPress plugin zip at dist/grcpay-woocommerce.zip.
# The zip contains a top-level `grcpay-woocommerce/` directory (WP convention)
# with the plugin PHP, assets, and languages — nothing from the package root.

set -euo pipefail

PKG_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_SLUG="grcpay-woocommerce"
DIST_DIR="${PKG_ROOT}/dist"
STAGING_DIR="${DIST_DIR}/${PLUGIN_SLUG}"
ZIP_PATH="${DIST_DIR}/${PLUGIN_SLUG}.zip"

rm -rf "${DIST_DIR}"
mkdir -p "${STAGING_DIR}"

# rsync keeps it simple: copy plugin/ verbatim, excluding dev files.
rsync -a \
  --exclude='.gitignore' \
  --exclude='.idea' \
  --exclude='*.po' \
  --exclude='node_modules' \
  "${PKG_ROOT}/plugin/" "${STAGING_DIR}/"

( cd "${DIST_DIR}" && zip -qr "${PLUGIN_SLUG}.zip" "${PLUGIN_SLUG}" )
rm -rf "${STAGING_DIR}"

echo "Built ${ZIP_PATH}"
