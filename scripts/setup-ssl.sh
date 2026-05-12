#!/usr/bin/env bash
# ============================================================
# genie help — SSL Certificate Helper
#
# Issues (or re-issues) an SSL certificate for the API domain
# using certbot standalone mode.  Run this only if:
#   a) vps-init.sh was not used (manual server setup), or
#   b) the certificate has expired and auto-renewal failed.
#
# For initial VPS provisioning use vps-init.sh instead —
# it also installs Docker, configures the firewall, etc.
#
# Usage: bash scripts/setup-ssl.sh <api-domain> <email>
# Example: bash scripts/setup-ssl.sh api.genieinprompt.app admin@genieinprompt.app
#
# Prerequisites:
#   - Docker installed and running
#   - Port 80 must be free (the script stops nginx temporarily)
#   - /opt/promptgenie/certbot/{conf,www} must exist
#     (vps-init.sh creates these; script creates them if absent)
# ============================================================
set -euo pipefail

DOMAIN="${1:?Usage: $0 <api-domain> <email>}"
EMAIL="${2:?Usage: $0 <api-domain> <email>}"

CERT_BASE="/opt/promptgenie/certbot"
CERT_CONF="$CERT_BASE/conf"
CERT_WWW="$CERT_BASE/www"
CERT_PATH="$CERT_CONF/live/$DOMAIN/fullchain.pem"
COMPOSE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docker-compose.prod.yml"
COMPOSE="docker compose -f $COMPOSE_FILE"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[›]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

# ── Guards ────────────────────────────────────────────────────────────────────
command -v docker &>/dev/null || die "Docker is not installed"

# Validate domain looks like a hostname (no spaces or shell metacharacters)
case "$DOMAIN" in
  *[\ $'\t'\;\|\&\<\>\'\"\\]*)
    die "DOMAIN '$DOMAIN' contains invalid characters" ;;
esac

# ── Create cert directories if they don't exist ───────────────────────────────
mkdir -p "$CERT_CONF" "$CERT_WWW"
ok "Cert directories ready: $CERT_BASE"

# ── Check if cert already exists ─────────────────────────────────────────────
if [ -f "$CERT_PATH" ]; then
  ok "Certificate already exists: $CERT_PATH"
  warn "To force renewal run: certbot renew --force-renewal"
  warn "Or let the certbot container handle auto-renewal (runs every 12h)."
  exit 0
fi

# ── Stop nginx if running to free port 80 for standalone certbot ──────────────
NGINX_WAS_RUNNING=false
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^promptgenie-nginx$'; then
  log "Stopping promptgenie-nginx to free port 80..."
  $COMPOSE stop nginx
  NGINX_WAS_RUNNING=true
fi

# ── Issue certificate ─────────────────────────────────────────────────────────
log "Issuing Let's Encrypt certificate for $DOMAIN..."
docker run --rm \
  -p 80:80 \
  -v "${CERT_CONF}:/etc/letsencrypt" \
  -v "${CERT_WWW}:/var/www/certbot" \
  certbot/certbot certonly \
    --standalone \
    --agree-tos \
    --no-eff-email \
    --email "$EMAIL" \
    --domain "$DOMAIN" \
    --non-interactive \
    --quiet

ok "Certificate issued: $CERT_PATH"

# ── Restart nginx so it detects the cert and switches to HTTPS mode ───────────
if [ "$NGINX_WAS_RUNNING" = "true" ]; then
  log "Restarting nginx (it will now start in HTTPS mode)..."
  $COMPOSE up -d nginx
  sleep 3
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^promptgenie-nginx$'; then
    ok "Nginx is running"
  else
    warn "Nginx may not have started — check: $COMPOSE logs nginx"
  fi
fi

# ── Register auto-renewal cron if not already present ─────────────────────────
CRON_CMD="0 3 * * * docker run --rm \
  -v ${CERT_CONF}:/etc/letsencrypt \
  -v ${CERT_WWW}:/var/www/certbot \
  certbot/certbot renew --quiet && \
  docker exec promptgenie-nginx nginx -s reload 2>/dev/null || true"

if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
  (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
  ok "SSL auto-renewal cron registered (runs daily at 03:00)"
else
  ok "SSL auto-renewal cron already present"
fi

echo ""
ok "SSL setup complete: https://$DOMAIN"
echo ""
echo "  The certbot container in docker-compose.prod.yml also runs"
echo "  'certbot renew' every 12 hours as a belt-and-suspenders backup."
echo ""
