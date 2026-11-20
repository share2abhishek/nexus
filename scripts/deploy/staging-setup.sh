#!/usr/bin/env bash
# One-time (idempotent) setup of the staging environment on the EC2 host (Q0, docs/platform/ROADMAP.md).
# Run from a developer machine:  scripts/deploy/staging-setup.sh
#
# On the server it:
#   1. clones ~/projects/nexus into ~/projects/nexus-staging (reads the production repo, changes nothing in it);
#   2. writes ~/projects/nexus-staging/.env.staging once, mode 600: fresh database password and session secret,
#      server edition, the staging URL and the platform admin e-mails. NO AI, social, SMTP, WhatsApp or payment
#      credentials are copied: staging must never act on real customers' accounts;
#   3. installs ~/bin/nexus-staging-deploy (scripts/deploy/nexus-staging-deploy.sh).
# Then deploy a branch with:  scripts/deploy/deploy-from-local.sh --staging
set -euo pipefail

HOST="${NEXUS_DEPLOY_HOST:-ec2-user@ec2-13-235-255-185.ap-south-1.compute.amazonaws.com}"
KEY="${NEXUS_DEPLOY_KEY:-$HOME/radixile/mumbai-reserved-instance-key.pem}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20)
cd "$(git rev-parse --show-toplevel)"

"${SSH[@]}" "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
S="$HOME/projects/nexus-staging"
PROD_ENV="$HOME/projects/nexus/.env"
if [ ! -d "$S/.git" ]; then
  git clone -q "$HOME/projects/nexus" "$S"
  echo "Cloned staging checkout into $S"
fi
cd "$S"
if [ ! -f .env.staging ]; then
  umask 077
  get() { grep -E "^$1=" "$PROD_ENV" | head -1 | cut -d= -f2- || true; }
  P="$(openssl rand -hex 16)"
  cat > .env.staging <<ENV
# Staging only. Written by scripts/deploy/staging-setup.sh. No customer or production credentials.
PORT=3000
NEXUS_MODE=server
DB_CLIENT=pg
STAGING_DB_PASSWORD=$P
DATABASE_URL=postgres://postgres:$P@nexus-db:5432/nexus
SESSION_SECRET=$(openssl rand -hex 32)
APP_URL=https://staging.nexus.radixile.com
HOST=$(get HOST)
TRUST_PROXY=$(get TRUST_PROXY)
PLATFORM_ADMIN_EMAILS=$(get PLATFORM_ADMIN_EMAILS)
OLLAMA_ENABLED=false
ENV
  echo "Wrote $S/.env.staging (mode 600)"
else
  echo ".env.staging already exists: left as it is"
fi
mkdir -p "$HOME/bin"
REMOTE

"${SSH[@]}" "$HOST" 'cat > ~/bin/nexus-staging-deploy && chmod 755 ~/bin/nexus-staging-deploy' < scripts/deploy/nexus-staging-deploy.sh
echo "Installed ~/bin/nexus-staging-deploy"
echo "Next: scripts/deploy/deploy-from-local.sh --staging   (deploys the current branch)"
