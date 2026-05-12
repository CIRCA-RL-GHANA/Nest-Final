#!/usr/bin/env bash
# ============================================================
# genie help — Environment Validation Script
#
# Validates that every variable consumed by configuration.ts
# and docker-compose.prod.yml is present, non-empty, and not
# a placeholder value.
#
# Usage: bash scripts/validate-env.sh [--strict]
#   --strict  treat warnings as errors (use in CI)
#
# Exit 0 = passed (or warnings-only in non-strict mode)
# Exit 1 = errors (or warnings in --strict mode)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
STRICT=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
ERRORS=0; WARNINGS=0; PASSES=0

_err()  { echo -e "${RED}[✗]${NC} $*"; (( ERRORS++  )) || true; }
_warn() { echo -e "${YELLOW}[!]${NC} $*"; (( WARNINGS++ )) || true; }
_ok()   { echo -e "${GREEN}[✓]${NC} $*"; (( PASSES++  )) || true; }
_hdr()  { echo ""; echo -e "${BLUE}── $* ${NC}"; }

while [[ $# -gt 0 ]]; do
  case $1 in
    --strict) STRICT=true; shift ;;
    --help)   echo "Usage: $0 [--strict]"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── .env must exist ───────────────────────────────────────────────────────────
_hdr "Checking .env file"
if [ ! -f "$ENV_FILE" ]; then
  _err ".env not found at $ENV_FILE"
  _err "Run:  cp $ROOT_DIR/.env.example $ROOT_DIR/.env  then fill in all values"
  exit 1
fi
_ok ".env exists"

# ── Helper functions ──────────────────────────────────────────────────────────
_val() { grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo ""; }

_check_required() {
  local var="$1"
  local v; v=$(_val "$var")
  if [[ -z "$v" ]]; then
    _err "$var is not set"
  elif [[ "$v" == *CHANGE_ME* || "$v" == *change_me* || "$v" == *change-me* \
       || "$v" == *your-* || "$v" == *replace* || "$v" == *TODO* ]]; then
    _err "$var is still a placeholder: ${v:0:40}..."
  else
    _ok "$var ✓"
  fi
}

_check_recommended() {
  local var="$1"
  local desc="$2"
  local v; v=$(_val "$var")
  if [[ -z "$v" || "$v" == *CHANGE_ME* || "$v" == *your-* ]]; then
    _warn "$var not set — $desc"
  else
    _ok "$var ✓"
  fi
}

_check_optional() {
  local var="$1"
  local v; v=$(_val "$var")
  [[ -n "$v" ]] && _ok "$var ✓ (optional)" || _warn "$var not set (optional)"
}

# ── Required — application ────────────────────────────────────────────────────
_hdr "Application"
for v in NODE_ENV PORT API_PREFIX API_VERSION APP_NAME; do
  _check_required "$v"
done

# ── Required — database ───────────────────────────────────────────────────────
_hdr "Database (PostgreSQL)"
for v in DB_HOST DB_PORT DB_USERNAME DB_PASSWORD DB_NAME DB_SYNCHRONIZE DB_LOGGING DB_SSL; do
  _check_required "$v"
done

# ── Required — redis ──────────────────────────────────────────────────────────
_hdr "Redis"
for v in REDIS_HOST REDIS_PORT REDIS_PASSWORD REDIS_DB; do
  _check_required "$v"
done

# ── Required — JWT / security ─────────────────────────────────────────────────
_hdr "JWT & Security"
for v in JWT_SECRET JWT_EXPIRES_IN JWT_REFRESH_SECRET JWT_REFRESH_EXPIRES_IN \
         BCRYPT_ROUNDS PIN_ENCRYPTION_KEY; do
  _check_required "$v"
done

# ── Required — CORS & domains ─────────────────────────────────────────────────
_hdr "CORS & Domains"
for v in CORS_ORIGIN CORS_CREDENTIALS API_DOMAIN FRONTEND_DOMAIN; do
  _check_required "$v"
done

# ── Required — payment ────────────────────────────────────────────────────────
_hdr "Payment Facilitator"
for v in PAYMENT_FACILITATOR_PROVIDER PAYMENT_FACILITATOR_SECRET_KEY \
         PAYMENT_FACILITATOR_WEBHOOK_SECRET PAYMENT_FACILITATOR_CURRENCY; do
  _check_required "$v"
done

# ── Recommended — third-party services ───────────────────────────────────────
_hdr "Third-Party Services (required for full functionality)"
_check_recommended "SENDGRID_API_KEY"       "email delivery will not work"
_check_recommended "EMAIL_FROM"             "outbound email sender address"
_check_recommended "TWILIO_ACCOUNT_SID"     "SMS delivery will not work"
_check_recommended "TWILIO_AUTH_TOKEN"      "SMS delivery will not work"
_check_recommended "TWILIO_PHONE_NUMBER"    "SMS delivery will not work"

# ── Optional ──────────────────────────────────────────────────────────────────
_hdr "Optional"
_check_optional "AI_API_KEY"
_check_optional "GOOGLE_MAPS_API_KEY"
_check_optional "AWS_ACCESS_KEY_ID"

# ── Security checks ───────────────────────────────────────────────────────────
_hdr "Security Quality Checks"

jwt=$(_val JWT_SECRET)
jwt_r=$(_val JWT_REFRESH_SECRET)

if [[ ${#jwt} -lt 32 ]]; then
  _err "JWT_SECRET is too short (${#jwt} chars — need ≥ 32). Generate: openssl rand -base64 64"
else
  _ok "JWT_SECRET length OK (${#jwt} chars)"
fi

if [[ ${#jwt_r} -lt 32 ]]; then
  _err "JWT_REFRESH_SECRET is too short (${#jwt_r} chars — need ≥ 32)"
else
  _ok "JWT_REFRESH_SECRET length OK (${#jwt_r} chars)"
fi

if [[ "$jwt" == "$jwt_r" ]]; then
  _err "JWT_SECRET and JWT_REFRESH_SECRET must be different values"
else
  _ok "JWT_SECRET ≠ JWT_REFRESH_SECRET"
fi

pin=$(_val PIN_ENCRYPTION_KEY)
if [[ ${#pin} -lt 32 ]]; then
  _err "PIN_ENCRYPTION_KEY is too short (${#pin} chars — need ≥ 32). Generate: openssl rand -hex 32"
else
  _ok "PIN_ENCRYPTION_KEY length OK"
fi

redis_pw=$(_val REDIS_PASSWORD)
if [[ ${#redis_pw} -lt 16 ]]; then
  _warn "REDIS_PASSWORD is short (${#redis_pw} chars — recommend ≥ 16)"
else
  _ok "REDIS_PASSWORD length OK"
fi

ml_secret=$(_val ML_MODEL_SIGNING_SECRET)
if [[ -z "$ml_secret" || "$ml_secret" == *change-me* || "$ml_secret" == *CHANGE_ME* ]]; then
  _err "ML_MODEL_SIGNING_SECRET is not set or is still a placeholder. Generate: openssl rand -base64 48"
elif [[ ${#ml_secret} -lt 32 ]]; then
  _err "ML_MODEL_SIGNING_SECRET is too short (${#ml_secret} chars — need ≥ 32)"
else
  _ok "ML_MODEL_SIGNING_SECRET length OK (${#ml_secret} chars)"
fi

# Production-specific safety checks
node_env=$(_val NODE_ENV)
if [[ "$node_env" == "production" ]]; then
  _hdr "Production Safety Checks"

  sync=$(_val DB_SYNCHRONIZE)
  [[ "$sync" == "true" ]] \
    && _err  "DB_SYNCHRONIZE=true in production — TypeORM can DROP columns on schema changes!" \
    || _ok   "DB_SYNCHRONIZE=false ✓"

  logging=$(_val DB_LOGGING)
  [[ "$logging" == "true" ]] \
    && _warn "DB_LOGGING=true in production — expect high log volume" \
    || _ok   "DB_LOGGING=false ✓"

  swagger=$(_val ENABLE_SWAGGER)
  [[ "$swagger" == "true" ]] \
    && _warn "ENABLE_SWAGGER=true in production — API schema is publicly visible" \
    || _ok   "ENABLE_SWAGGER=false (or unset) ✓"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}────────────────────────────────────${NC}"
echo -e "  ${GREEN}Passed:   $PASSES${NC}"
echo -e "  ${YELLOW}Warnings: $WARNINGS${NC}"
echo -e "  ${RED}Errors:   $ERRORS${NC}"
echo -e "${BLUE}────────────────────────────────────${NC}"

if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}✗ Validation FAILED — fix errors before deploying${NC}"
  exit 1
fi

if [ "$WARNINGS" -gt 0 ] && [ "$STRICT" = "true" ]; then
  echo -e "${YELLOW}✗ Strict mode — $WARNINGS warning(s) treated as errors${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Validation passed${NC}"
exit 0
