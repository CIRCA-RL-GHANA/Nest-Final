#!/usr/bin/env bash
# ============================================================
# genie help — Environment Bootstrap Script
#
# Creates .env from .env.example and injects freshly generated
# cryptographic secrets so no value is ever a placeholder.
#
# Usage: bash scripts/setup-env.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[›]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

# ── Guards ────────────────────────────────────────────────────────────────────
[ -f "$ENV_EXAMPLE" ] || die ".env.example not found at $ENV_EXAMPLE"
command -v openssl &>/dev/null || die "openssl not found — install it to generate secrets"

if [ -f "$ENV_FILE" ]; then
  warn ".env already exists at $ENV_FILE"
  printf "Overwrite? This will back up the current file. [y/N] "
  read -r -n1 ans; echo
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    log "Aborted. Existing .env kept."
    exit 0
  fi
  local_bak="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  cp "$ENV_FILE" "$local_bak"
  ok "Backed up existing .env → $local_bak"
fi

# ── Copy template ─────────────────────────────────────────────────────────────
cp "$ENV_EXAMPLE" "$ENV_FILE"
ok "Copied .env.example → .env"

# ── Secret generation helpers ─────────────────────────────────────────────────
gen_b64()    { openssl rand -base64 "$1" | tr -d '\n'; }
gen_hex()    { openssl rand -hex "$1"; }
gen_alpnum() { openssl rand -base64 32 | tr -d '+/=' | head -c "$1"; }

# sed helper that handles / and & in values (use | as delimiter)
sedit() {
  local key="$1" val="$2"
  # Escape chars that are special in sed replacement with | delimiter
  local escaped_val
  escaped_val=$(printf '%s' "$val" | sed 's/[&\\|]/\\&/g')
  sed -i "s|^${key}=.*|${key}=${escaped_val}|" "$ENV_FILE"
}

# ── Generate and inject all secrets ───────────────────────────────────────────
log "Generating cryptographic secrets..."

JWT_SECRET=$(gen_b64 64)
JWT_REFRESH_SECRET=$(gen_b64 64)
PIN_KEY=$(gen_hex 32)
PIN_IV=$(gen_hex 16)
REDIS_PASS=$(gen_alpnum 32)
DB_PASS=$(gen_alpnum 32)
WEBHOOK_SECRET=$(gen_hex 20)

sedit JWT_SECRET                         "$JWT_SECRET"
sedit JWT_REFRESH_SECRET                 "$JWT_REFRESH_SECRET"
sedit PIN_ENCRYPTION_KEY                 "$PIN_KEY"
sedit PIN_ENCRYPTION_IV                  "$PIN_IV"
sedit REDIS_PASSWORD                     "$REDIS_PASS"
sedit DB_PASSWORD                        "$DB_PASS"
sedit PAYMENT_FACILITATOR_WEBHOOK_SECRET "$WEBHOOK_SECRET"

ok "All secrets generated and injected"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  .env created with fresh cryptographic secrets    ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Auto-generated (ready to use):"
echo "    JWT_SECRET, JWT_REFRESH_SECRET"
echo "    PIN_ENCRYPTION_KEY, PIN_ENCRYPTION_IV"
echo "    REDIS_PASSWORD, DB_PASSWORD"
echo "    PAYMENT_FACILITATOR_WEBHOOK_SECRET"
echo ""
echo "  You MUST still fill in manually:"
echo "    API_DOMAIN        e.g. api.genieinprompt.app"
echo "    FRONTEND_DOMAIN   e.g. genieinprompt.app"
echo "    SENDGRID_API_KEY"
echo "    TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER"
echo "    AI_API_KEY        (if using OpenAI)"
echo ""
echo "  Validate when done:"
echo "    bash scripts/validate-env.sh"
echo ""
