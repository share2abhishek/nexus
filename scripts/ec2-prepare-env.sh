#!/usr/bin/env bash
# Prepares the .env of a hosted (server edition) install for 2.2.0 and later.
# Run it ON THE SERVER, in the app folder. It is safe to run again.
#
#   ./scripts/ec2-prepare-env.sh --app-url https://app.example.com --admin-email you@example.com
#
# Options
#   --app-url URL        public https address of the service (required)
#   --admin-email EMAIL  Radixile staff address that becomes a platform admin once its
#                        email is verified (repeat for more than one)
#   --proxies N          reverse proxies in front of the app (default 1; 0 = none)
#   --env-file PATH      the file to prepare (default ./.env)
#
# It never prints a secret. The old file is kept as .env.backup-<time>.
set -euo pipefail

ENV_FILE=".env"; APP_URL=""; PROXIES="1"; ADMINS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --app-url) APP_URL="${2:-}"; shift 2 ;;
    --admin-email) ADMINS+=("${2:-}"); shift 2 ;;
    --proxies) PROXIES="${2:-1}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-.env}"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ "$APP_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$ ]] || { echo "Give --app-url as the public https address, e.g. https://app.example.com" >&2; exit 2; }
[[ "$PROXIES" =~ ^[0-9]+$ ]] || { echo "--proxies must be a number" >&2; exit 2; }
for a in "${ADMINS[@]:-}"; do
  [ -z "$a" ] || [[ "$a" =~ ^[^[:space:]@,]+@[^[:space:]@,]+\.[^[:space:]@,]+$ ]] || { echo "Not an email address: $a" >&2; exit 2; }
done

touch "$ENV_FILE"
cp "$ENV_FILE" "${ENV_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
chmod 600 "$ENV_FILE" 2>/dev/null || true

get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
# Replace the line, or add it at the end. The value is never echoed.
put() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' "$ENV_FILE" > "$tmp"
  else
    cp "$ENV_FILE" "$tmp"; [ -s "$tmp" ] && [ "$(tail -c1 "$tmp" | wc -l)" -eq 0 ] && echo >> "$tmp"
    echo "${key}=${value}" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

weak_secret() {
  local v; v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [ "${#v}" -lt 24 ] && return 0
  case "$v" in
    nexus-dev-secret|nexus-super-secret-change-this-in-production|changeme|change-me|secret|your-secret-here|replace-me) return 0 ;;
    your*|change*|replace*|example*|nexus-super-secret*|nexus-dev*) return 0 ;;
  esac
  return 1
}

new_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

changed=()
note() { changed+=("$1"); }

# 1. Session secret: required, long, not a placeholder (the app refuses to start otherwise)
current="$(get SESSION_SECRET)"
if [ -z "$current" ] || weak_secret "$current"; then
  put SESSION_SECRET "$(new_secret)"; note "SESSION_SECRET   made a new random one (everyone is signed out once)"
else note "SESSION_SECRET   already strong: kept"; fi

# 2. Hosted edition on, public address, proxies
[ "$(get NEXUS_MODE)" = "server" ] || { put NEXUS_MODE server; note "NEXUS_MODE       server"; }
[ "$(get APP_URL)" = "$APP_URL" ] || { put APP_URL "$APP_URL"; note "APP_URL          $APP_URL"; }
if [ "$PROXIES" != "0" ]; then
  [ "$(get TRUST_PROXY)" = "$PROXIES" ] || { put TRUST_PROXY "$PROXIES"; note "TRUST_PROXY      $PROXIES"; }
fi

# 3. Platform admins (a listed address counts only once it is verified)
if [ "${#ADMINS[@]}" -gt 0 ] && [ -n "${ADMINS[0]}" ]; then
  list="$(get PLATFORM_ADMIN_EMAILS)"
  for a in "${ADMINS[@]}"; do
    lower="$(printf '%s' "$a" | tr '[:upper:]' '[:lower:]')"
    case ",$(printf '%s' "$list" | tr '[:upper:]' '[:lower:]' | tr -d ' ')," in
      *",$lower,"*) ;;
      *) list="${list:+$list,}$a" ;;
    esac
  done
  [ "$list" = "$(get PLATFORM_ADMIN_EMAILS)" ] || { put PLATFORM_ADMIN_EMAILS "$list"; note "PLATFORM_ADMIN_EMAILS updated"; }
fi

# 4. Things that no longer belong on a hosted install
if grep -qE '^LICENSE_SERVER_URL=http://(127\.0\.0\.1|localhost)' "$ENV_FILE"; then
  echo "WARNING: LICENSE_SERVER_URL points at this machine. A hosted install needs no licence server: remove that line."
fi
[ "$(get DB_CLIENT)" = "pg" ] || echo "NOTE: DB_CLIENT is not 'pg'. The hosted edition normally uses Postgres (DB_CLIENT=pg and DATABASE_URL)."

echo
echo "Prepared $ENV_FILE (previous copy kept as ${ENV_FILE}.backup-*):"
for c in "${changed[@]}"; do echo "  - $c"; done
cat <<'EOF'

Next, on this server:
  1. npm ci --omit=dev          (dependencies changed in 2.2.0)
  2. Restart the app (the new relay_approvals table is created at start-up).
  3. Check it:  curl -s http://127.0.0.1:${PORT:-3000}/__health     -> {"app":"social-nexus","version":"2.2.0",...}
  4. Platform admin: sign in with the admin address and confirm its email, or run in Postgres:
       UPDATE users SET role = 'superadmin' WHERE lower(email) = lower('you@example.com');
  5. Open a client approval link from the Calendar once to confirm https://<APP_URL>/a/... opens.
EOF
