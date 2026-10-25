#!/usr/bin/env bash
# Nightly / pre-deploy backup: pg_dump + storage -> restic (Backblaze B2). Pings Healthchecks.io.
# Usage: backup.sh [tag]      Env: see .env.backup.example
set -Eeuo pipefail
TAG="${1:-manual}"
ping() { [ -n "${HEALTHCHECKS_PING_URL:-}" ] && curl -fsS -m 10 --retry 3 "${HEALTHCHECKS_PING_URL}${1:-}" >/dev/null || true; }
trap 'ping /fail; echo "backup FAILED" >&2' ERR
ping /start

restic snapshots >/dev/null 2>&1 || restic init
echo "[backup] database"
pg_dump -h "${PGHOST:-db}" -U "${PGUSER:-bookstall}" -d "${PGDATABASE:-bookstall}" -Fc \
  | restic backup --stdin --stdin-filename bookstall.pgdump --tag "$TAG" --tag db
echo "[backup] files"
restic backup /data/storage --tag "$TAG" --tag files
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune --tag nightly || true
restic check --read-data-subset=2% >/dev/null
ping
echo "[backup] done ($TAG)"
