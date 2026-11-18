#!/usr/bin/env bash
# Turn on "deploy to production after every commit on master" for this clone.
# Needs the prod SSH key (default ~/radixile/mumbai-reserved-instance-key.pem).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
HOOK="$(git rev-parse --git-path hooks)/post-commit"
cp scripts/deploy/post-commit "$HOOK"
chmod +x "$HOOK" scripts/deploy/deploy-from-local.sh
echo "Installed $HOOK: commits on master now deploy to production."
