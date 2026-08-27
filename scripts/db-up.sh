#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't reachable. On macOS with colima: run 'colima start' first." >&2
  exit 1
fi

if docker start safebooks-pg >/dev/null 2>&1; then
  echo "Started existing safebooks-pg container."
else
  docker run -d \
    --name safebooks-pg \
    -e POSTGRES_USER=safebooks \
    -e POSTGRES_PASSWORD=safebooks \
    -e POSTGRES_DB=safebooks \
    -p 127.0.0.1:5432:5432 \
    -v safebooks-pg-data:/var/lib/postgresql \
    -v "$(pwd)/docker/initdb:/docker-entrypoint-initdb.d" \
    postgres:18
  echo "Created and started safebooks-pg container."
fi

for _ in $(seq 1 30); do
  if docker exec safebooks-pg pg_isready -U safebooks >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec safebooks-pg pg_isready -U safebooks >/dev/null 2>&1; then
  echo "Postgres did not become ready in time." >&2
  exit 1
fi

# Reused volumes from a run predating this database don't get it from initdb, which
# only runs against a fresh data directory - so create it here if it's still missing.
if [ "$(docker exec safebooks-pg psql -U safebooks -d safebooks -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'safebooks_test'")" != "1" ]; then
  docker exec safebooks-pg psql -U safebooks -d safebooks -c "CREATE DATABASE safebooks_test;" >/dev/null
  echo "Created safebooks_test database."
fi

echo "Postgres is accepting connections on localhost:5432."
