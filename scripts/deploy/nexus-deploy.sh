#!/usr/bin/env bash
# Production deploy for nexus on the EC2 host. Installed on the server as
# /home/ec2-user/bin/nexus-deploy and run by scripts/deploy/deploy-from-local.sh over SSH
# (it can also be an SSH forced command, so a CI key could do nothing else). It is NOT
# updated by a deploy: after changing this file, copy it to the server by hand.
#
# Commands (passed as the SSH command line):
#   head                  print the commit the server is on
#   deploy <40-char sha>  read a git bundle on stdin (may be empty when re-deploying the
#                         current commit), fast-forward to <sha>, back up, rebuild the
#                         Docker image, restart, health-check; roll back if unhealthy
set -euo pipefail

APP=/home/ec2-user/projects/nexus
BACKUPS=/home/ec2-user/projects/nexus-backups
LOG=/home/ec2-user/projects/nexus-deploy.log
IMAGE=nexus-nexus-app
SERVICE=nexus-app
DB_CONTAINER=nexus-nexus-db-1
HEALTH_URL=http://127.0.0.1:3300/__health
KEEP_BACKUPS=15

read -r -a ARGS <<< "${SSH_ORIGINAL_COMMAND:-${*:-}}"
CMD="${ARGS[0]:-}"
cd "$APP"

case "$CMD" in
  head) git rev-parse HEAD; exit 0 ;;
  deploy) ;;
  *) echo "usage: head | deploy <commit-sha>" >&2; exit 2 ;;
esac

SHA="${ARGS[1]:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy needs the full 40-character commit sha" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/in.bundle"          # read stdin before waiting for the lock

exec 9>/tmp/nexus-deploy.lock
flock -w 1200 9 || { echo "Another deploy is still running; gave up waiting." >&2; exit 1; }

exec > >(tee -a "$LOG") 2>&1
echo
echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') deploy ${SHA:0:7} ==="

PREV="$(git rev-parse HEAD)"

# 1. Bring in the code (nothing running changes yet)
if [ -s "$TMP/in.bundle" ]; then
  git bundle verify -q "$TMP/in.bundle"
  git fetch -q "$TMP/in.bundle" deploy
  [ "$(git rev-parse FETCH_HEAD)" = "$SHA" ] || { echo "Bundle does not contain $SHA" >&2; exit 1; }
elif [ "$PREV" != "$SHA" ]; then
  echo "No bundle sent and server is on ${PREV:0:7}, not ${SHA:0:7}" >&2; exit 1
fi

# 2. Back up: uncommitted server edits, .env, database; keep the running image as :previous
TS="$(date +%Y%m%d-%H%M%S)"; B="$BACKUPS/$TS"; mkdir -p "$B"
if ! git diff --quiet; then
  git diff > "$B/server-uncommitted.patch"
  echo "WARNING: tracked files were edited on the server; saved to $B/server-uncommitted.patch and discarded."
  git checkout -- .
fi
cp .env "$B/env.copy"; chmod 600 "$B/env.copy"
docker exec "$DB_CONTAINER" pg_dump -U postgres -d nexus | gzip > "$B/nexus-db.sql.gz"
echo "$PREV" > "$B/previous-commit"
docker tag "$IMAGE:latest" "$IMAGE:previous"
echo "Backup: $B"

# 3. Move the code forward
if [ "$PREV" != "$SHA" ]; then
  git merge -q --ff-only "$SHA" || { echo "Cannot fast-forward ${PREV:0:7} -> ${SHA:0:7} (history rewritten, or untracked files in the way). Prod unchanged." >&2; exit 1; }
fi
echo "Code: ${PREV:0:7} -> $(git log --oneline -1)"

# 4. Build (prod keeps running during the build)
if ! docker compose build -q "$SERVICE"; then
  echo "Build failed; code put back to ${PREV:0:7}. Prod unchanged." >&2
  git reset -q --hard "$PREV"; exit 1
fi

# 5. Restart and health-check
EXPECTED="$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' package.json | head -1)"
docker compose up -d "$SERVICE"
healthy=""
for _ in $(seq 1 40); do
  sleep 3
  if curl -fsS -m 4 "$HEALTH_URL" 2>/dev/null | grep -q "\"version\":\"$EXPECTED\""; then healthy=1; break; fi
done

if [ -z "$healthy" ]; then
  echo "UNHEALTHY: no healthy answer for version $EXPECTED in 120s. Last log lines:" >&2
  docker compose logs --tail 40 "$SERVICE" >&2 || true
  echo "Rolling back to ${PREV:0:7} (migrations are additive and stay)." >&2
  git reset -q --hard "$PREV"
  docker tag "$IMAGE:previous" "$IMAGE:latest"
  docker compose up -d --no-build --force-recreate "$SERVICE"
  exit 1
fi
echo "Healthy: $(curl -s -m 4 "$HEALTH_URL")"

# 6. Tidy up (disk on this shared host is tight)
ls -1dt "$BACKUPS"/*/ 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -rf
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
echo "=== deployed ${SHA:0:7} ==="
