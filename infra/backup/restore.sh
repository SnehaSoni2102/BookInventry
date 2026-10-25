#!/usr/bin/env bash
# Restore a snapshot into a THROWAWAY database + directory (never over production by accident).
# Usage: restore.sh <snapshot-id|latest> [target-db=restore_test] [target-dir=/tmp/restore-storage]
# To restore for real after a disaster, run it on the new server and point TARGET_DB at the live DB name
# while the api/worker containers are stopped (see docs/RUNBOOK.md).
set -Eeuo pipefail
SNAP="${1:?snapshot id or 'latest'}"
DB="${2:-restore_test}"
DIR="${3:-/tmp/restore-storage}"
H="${PGHOST:-db}"; U="${PGUSER:-bookstall}"
psql -h "$H" -U "$U" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\""
restic dump "$SNAP" bookstall.pgdump --tag db | pg_restore -h "$H" -U "$U" -d "$DB" --no-owner --exit-on-error
mkdir -p "$DIR"
restic restore "$SNAP" --tag files --target "$DIR" --include /data/storage
echo "restored db '$DB' and files into $DIR"
psql -h "$H" -U "$U" -d "$DB" -Atc "select 'copies', count(*) from copies union all select 'sales', count(*) from sales union all select 'last sale', coalesce(max(sold_at)::text,'-') from sales"
