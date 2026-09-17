#!/usr/bin/env bash
set -Eeuo pipefail
cd "${APP_DIR:-/home/hallaym/masofaviy}"
bash ops/bootstrap-env.sh
bash ops/deploy-university.sh
bash ops/verify-production.sh
