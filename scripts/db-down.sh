#!/usr/bin/env bash
set -euo pipefail

docker stop safebooks-pg >/dev/null 2>&1 && echo "Stopped safebooks-pg." || echo "safebooks-pg is not running."
