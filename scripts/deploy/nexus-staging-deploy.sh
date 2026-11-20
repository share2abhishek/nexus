#!/usr/bin/env bash
# Staging deploy for nexus on the EC2 host (Q0). Installed on the server as /home/ec2-user/bin/nexus-staging-deploy
# by scripts/deploy/staging-setup.sh, and run by scripts/deploy/deploy-from-local.sh --staging over SSH.
# Unlike production it deploys ANY commit (a feature branch), so it checks out the commit instead of fast-forwarding.
# It never touches production: its own folder, Compose project, database and port.
#
# Commands:
#   head                  print the commit staging is on (or "none")
#   deploy <40-char sha>  read a git bundle on stdin, check out <sha>, rebuild, restart, health-check
#   make-admin <email>    staging only: make an existing staging user a verified super admin (staging has no e-mail)
#   reset-db              staging only: delete the staging database volume and start empty again
set -euo pipefail

APP=/home/ec2-user/projects/nexus-staging
LOG=/home/ec2-user/projects/nexus-staging-deploy.log
HEALTH_URL=http://127.0.0.1:3301/__health
DC=(docker compose -f docker-compose.staging.yml --env-file .env.staging -p nexus-staging)

read -r -a ARGS <<< "${SSH_ORIGINAL_COMMAND:-${*:-}}"
CMD="${ARGS[0]:-}"
cd "$APP"
[ -f .env.staging ] || { echo "Staging is not set up (.env.staging missing): run scripts/deploy/staging-setup.sh" >&2; exit 1; }

case "$CMD" in
  head) git rev-parse --verify -q HEAD || echo none; exit 0 ;;
  make-admin)
    EMAIL="${ARGS[1]:-}"
    [[ "$EMAIL" =~ ^[^[:space:]@\']+@[^[:space:]@\']+$ ]] || { echo "usage: make-admin <email>" >&2; exit 2; }
    "${DC[@]}" exec -T nexus-db psql -U postgres -d nexus -v ON_ERROR_STOP=1 -c \
      "UPDATE users SET role='superadmin', email_verified_at=COALESCE(email_verified_at, extract(epoch from now())::int) WHERE lower(email)=lower('$EMAIL');"
    exit 0 ;;
  reset-db)
    "${DC[@]}" down -v
    echo "Staging database deleted. Next deploy starts empty."; exit 0 ;;
  deploy) ;;
  *) echo "usage: head | deploy <commit-sha> | make-admin <email> | reset-db" >&2; exit 2 ;;
esac

SHA="${ARGS[1]:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy needs the full 40-character commit sha" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/in.bundle"

exec 9>/tmp/nexus-staging-deploy.lock
flock -w 1200 9 || { echo "Another staging deploy is still running; gave up waiting." >&2; exit 1; }

exec > >(tee -a "$LOG") 2>&1
echo
echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') staging deploy ${SHA:0:7} ==="

if [ -s "$TMP/in.bundle" ]; then
  git bundle verify -q "$TMP/in.bundle"
  git fetch -q "$TMP/in.bundle" deploy
  [ "$(git rev-parse FETCH_HEAD)" = "$SHA" ] || { echo "Bundle does not contain $SHA" >&2; exit 1; }
fi
git cat-file -e "$SHA^{commit}" 2>/dev/null || { echo "Staging does not have $SHA (send a bundle)" >&2; exit 1; }
git checkout -q -f --detach "$SHA"
echo "Code: $(git log --oneline -1)"

"${DC[@]}" build -q nexus-app
EXPECTED="$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' package.json | head -1)"
"${DC[@]}" up -d
for _ in $(seq 1 40); do
  sleep 3
  if curl -fsS -m 4 "$HEALTH_URL" 2>/dev/null | grep -q "\"version\":\"$EXPECTED\""; then
    echo "Healthy: $(curl -s -m 4 "$HEALTH_URL")"
    docker image prune -f >/dev/null
    echo "=== staging deployed ${SHA:0:7} ==="
    exit 0
  fi
done
echo "UNHEALTHY: no healthy answer for version $EXPECTED in 120s. Last log lines:" >&2
"${DC[@]}" logs --tail 40 nexus-app >&2 || true
exit 1
