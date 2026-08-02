#!/usr/bin/env bash
# Apply Trusty's realm settings to a RUNNING Keycloak (idempotent).
#
# Why this exists: `--import-realm` only creates realms that don't exist yet,
# so anything we change in infra/keycloak/realm-export.json never reaches a
# server whose realm was created earlier. These settings must be pushed.
#
#   ./scripts/keycloak-setup.sh                 # uses .env admin credentials
#   KC_ADMIN=admin KC_PASS=secret ./scripts/keycloak-setup.sh
#
# Run it from the repo root on the server, after `docker compose up -d keycloak`.
set -euo pipefail

REALM="${KC_REALM:-constellation}"
THEME="${KC_LOGIN_THEME:-trusty}"
KC="docker compose exec -T keycloak"

# Credentials: explicit env wins, else the container's own admin env vars.
ADMIN_ARGS='--user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"'
if [ -n "${KC_ADMIN:-}" ] && [ -n "${KC_PASS:-}" ]; then
  ADMIN_ARGS="--user '${KC_ADMIN}' --password '${KC_PASS}'"
fi

# Keycloak needs ~10-40s after `up -d` before it accepts connections; the same
# bash/dev-tcp probe the compose healthcheck uses (no curl in the KC image).
echo "→ waiting for Keycloak to be ready…"
for i in $(seq 1 60); do
  if $KC bash -c 'exec 3<>/dev/tcp/127.0.0.1/9000; echo -e "GET /health/ready HTTP/1.1
Host: localhost
Connection: close

" >&3; grep -q "200 OK" <&3' 2>/dev/null; then
    echo "  ready after ${i}s-ish"
    break
  fi
  if [ "$i" = 60 ]; then
    echo "✗ Keycloak never became ready — check: docker compose logs keycloak" >&2
    exit 1
  fi
  sleep 2
done

echo "→ authenticating against realm master…"
$KC bash -c "/opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080/auth --realm master ${ADMIN_ARGS}"

echo "→ applying settings to realm '${REALM}'…"
$KC /opt/keycloak/bin/kcadm.sh update "realms/${REALM}" \
  -s "loginTheme=${THEME}" \
  -s "accountTheme=keycloak.v3" \
  -s registrationAllowed=true \
  -s registrationEmailAsUsername=true \
  -s rememberMe=true \
  -s resetPasswordAllowed=true

echo "→ verifying:"
$KC /opt/keycloak/bin/kcadm.sh get "realms/${REALM}" \
  --fields realm,loginTheme,registrationAllowed,registrationEmailAsUsername

echo "✓ done — hard-refresh the login page (theme CSS caches aggressively)."
