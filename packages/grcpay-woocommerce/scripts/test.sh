#!/usr/bin/env bash
# Local test runner for the grcpay-woocommerce plugin.
#
# Runs PHPUnit (and anything else expressed as a `composer` script)
# inside a throwaway `composer:2` container, so developers don't need
# PHP or Composer on their host and don't need the demo stack running.
# The container is ephemeral; only the bind-mounted package root
# (containing `vendor/`, `tests/`, etc.) is persisted.
#
# Usage:
#   ./scripts/test.sh                 # runs `composer test`
#   ./scripts/test.sh test:coverage   # runs `composer test:coverage`
#   ./scripts/test.sh install         # (re)installs dependencies
#
# First run auto-installs `vendor/` from `composer.lock` so the
# happy path is one command.

set -euo pipefail

PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PKG_ROOT}"

if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker is required but not installed" >&2
    exit 1
fi

run_composer() {
    docker run --rm \
        -v "${PKG_ROOT}:/app" \
        -w /app \
        --user "$(id -u):$(id -g)" \
        composer:2 composer "$@"
}

# First-run convenience: pull dependencies if vendor/ doesn't exist.
# Subsequent runs reuse the cached vendor/ for fast test loops.
if [ ! -d "${PKG_ROOT}/vendor" ]; then
    echo "==> vendor/ missing, installing dependencies from composer.lock"
    run_composer install --no-interaction --no-progress --prefer-dist
fi

run_composer "${1:-test}"
