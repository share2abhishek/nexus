#!/usr/bin/env bash
# Deploy master to production (nexus.radixile.com, Mumbai EC2) from this machine.
#
# Runs by itself after every commit on master (.git/hooks/post-commit, installed with
# scripts/deploy/install-hook.sh). Run it by hand to deploy again:
#   scripts/deploy/deploy-from-local.sh
#
# Steps: push master (and release tags) to Bitbucket, send prod only the new commits as a
# git bundle over SSH, then run the server's deploy script (~/bin/nexus-deploy, source in
# scripts/deploy/nexus-deploy.sh): backup, Docker rebuild, health check, rollback if unhealthy.
#
# Settings (environment): NEXUS_DEPLOY_HOST, NEXUS_DEPLOY_KEY (path to the .pem).
set -euo pipefail

HOST="${NEXUS_DEPLOY_HOST:-ec2-user@ec2-13-235-255-185.ap-south-1.compute.amazonaws.com}"
KEY="${NEXUS_DEPLOY_KEY:-$HOME/radixile/mumbai-reserved-instance-key.pem}"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30)

cd "$(git rev-parse --show-toplevel)"
[ "$(git symbolic-ref --short HEAD 2>/dev/null || true)" = master ] || { echo "Not on master: nothing deployed."; exit 0; }
[ -r "$KEY" ] || { echo "SSH key not found: $KEY (set NEXUS_DEPLOY_KEY)"; exit 1; }
SHA="$(git rev-parse HEAD)"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') deploying $(git log --oneline -1)"

# 1. Keep Bitbucket and prod on the same history
if ! git push --follow-tags origin master; then
  echo "Push to Bitbucket was rejected (someone else pushed first)."
  echo "Run: git pull --rebase   then: scripts/deploy/deploy-from-local.sh"
  exit 1
fi

# 2. What is prod on?
SERVER_HEAD="$("${SSH[@]}" "$HOST" '~/bin/nexus-deploy head' 2>/dev/null | grep -E '^[0-9a-f]{40}$' || true)"
[ -n "$SERVER_HEAD" ] || { echo "Could not reach prod or read its commit."; exit 1; }
echo "Prod is on ${SERVER_HEAD:0:7}"

# 3. Send the new commits and deploy
if [ "$SERVER_HEAD" = "$SHA" ]; then
  "${SSH[@]}" "$HOST" "~/bin/nexus-deploy deploy $SHA" < /dev/null
else
  git merge-base --is-ancestor "$SERVER_HEAD" "$SHA" 2>/dev/null \
    || { echo "Prod's commit ${SERVER_HEAD:0:7} is not in master's history: deploy by hand."; exit 1; }
  BUNDLE="$(mktemp -t nexus-deploy)"
  trap 'rm -f "$BUNDLE"; git update-ref -d refs/heads/deploy 2>/dev/null || true' EXIT
  git update-ref refs/heads/deploy "$SHA"
  git bundle create -q "$BUNDLE" "$SERVER_HEAD..refs/heads/deploy"
  "${SSH[@]}" "$HOST" "~/bin/nexus-deploy deploy $SHA" < "$BUNDLE"
fi
