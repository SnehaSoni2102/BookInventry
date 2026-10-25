#!/usr/bin/env bash
# Runs on the server: /opt/bookstall/deploy.sh <version>.  Backup -> pull -> up -> health check -> rollback on failure.
set -Eeuo pipefail
cd /opt/bookstall
VERSION="${1:?usage: deploy.sh <version>}"
PREV="$(cat .last_version 2>/dev/null || true)"
DC="docker compose -f docker-compose.prod.yml"
set_version() { sed -i "s/^APP_VERSION=.*/APP_VERSION=$1/" .env; grep -q '^APP_VERSION=' .env || echo "APP_VERSION=$1" >> .env; }
healthy() { local d; d="$(grep ^DOMAIN= .env | cut -d= -f2)"; for _ in $(seq 1 45); do curl -fsS -m 3 --resolve "$d:443:127.0.0.1" "https://$d/api/v1/health/ready" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }

[ -n "$PREV" ] && $DC exec -T backup /usr/local/bin/backup.sh pre-deploy || echo "skipping pre-deploy backup (first deploy)"
set_version "$VERSION"
$DC pull
$DC up -d --remove-orphans
if healthy; then
  echo "$VERSION" > .last_version
  docker image prune -af --filter "until=168h" >/dev/null
  echo "deployed $VERSION"
else
  echo "UNHEALTHY - rolling back to ${PREV:-<none>}" >&2
  if [ -n "$PREV" ]; then set_version "$PREV"; $DC up -d; fi
  exit 1
fi
