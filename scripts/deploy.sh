#!/usr/bin/env bash
# ============================================================
# genie help — Production Deployment Script
#
# MASTER STANDARD (applied to every script in this repo):
#   1. set -euo pipefail — fail fast, no silent errors
#   2. All paths derived from SCRIPT_DIR — never assume cwd
#   3. All critical env vars validated before any destructive action
#   4. Health checks poll until healthy — never rely on sleep
#   5. Image tagged :previous before each build — rollback always possible
#   6. Explicit project name (name: promptgenie in compose) — stable everywhere
#   7. All compose commands use -f $COMPOSE_FILE — never the default file
#   8. Container names are explicit in compose — referenced by name here
#
# Usage: bash scripts/deploy.sh {deploy|build|healthcheck|status|rollback|logs [svc]|preflight}
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
COMPOSE="docker compose -f $COMPOSE_FILE"

# Dump full diagnostics on any exit-with-error
on_error() {
  local rc=$?
  echo ""
  echo "============================================================"
  echo "[TRAP] deploy.sh exiting with code $rc — dumping diagnostics"
  echo "============================================================"
  echo "===== compose ps ====="
  $COMPOSE ps 2>&1 || true
  echo "===== promptgenie-app compose logs (last 250) ====="
  $COMPOSE logs --tail=250 --no-color app 2>&1 || true
  echo "===== promptgenie-app docker logs (last 250) ====="
  docker logs --tail=250 promptgenie-app 2>&1 || true
  echo "===== promptgenie-app inspect state ====="
  docker inspect promptgenie-app --format '{{json .State}}' 2>&1 || true
  exit $rc
}
trap on_error ERR

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()  { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
preflight() {
  log "Running pre-flight checks..."

  command -v docker &>/dev/null       || die "Docker is not installed"
  docker compose version &>/dev/null  || die "Docker Compose v2 is not installed"
  ok "Docker: $(docker --version | head -1)"
  ok "Docker Compose: $(docker compose version --short)"

  [ -f "$COMPOSE_FILE" ] || die "Compose file not found: $COMPOSE_FILE"
  ok "Compose file: $COMPOSE_FILE"

  [ -f "$ROOT_DIR/.env" ] || die ".env not found — cp .env.example .env and fill in values"
  ok ".env file exists"

  # Validate critical secrets — must be non-empty and not a placeholder
  # shellcheck source=/dev/null
  set -a; source "$ROOT_DIR/.env"; set +a
  local failed=0
  for var in DB_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET \
             PIN_ENCRYPTION_KEY API_DOMAIN FRONTEND_DOMAIN; do
    local val="${!var:-}"
    if [[ -z "$val" || "$val" == *CHANGE_ME* || "$val" == *change_me* \
       || "$val" == *your-* || "$val" == *replace* ]]; then
      echo -e "${RED}[ERROR]${NC} $var is not set or is still a placeholder" >&2
      failed=1
    fi
  done
  [ $failed -eq 0 ] || die "Fix the missing/placeholder env vars above, then retry"
  ok "All critical env vars are set"

  # Nginx template files (rendered at runtime by docker-entrypoint.sh via envsubst)
  [ -f "$ROOT_DIR/nginx/nginx.conf.template" ]      || die "nginx/nginx.conf.template not found"
  [ -f "$ROOT_DIR/nginx/nginx-http.conf.template" ] || die "nginx/nginx-http.conf.template not found"
  [ -f "$ROOT_DIR/nginx/docker-entrypoint.sh" ]     || die "nginx/docker-entrypoint.sh not found"
  ok "Nginx templates present"

  ok "Pre-flight complete ✓"
}

# ── Build ─────────────────────────────────────────────────────────────────────
build_image() {
  log "Building application image (nestjs-ready-app:latest)..."
  $COMPOSE build --no-cache app
  ok "Image built successfully"
}

# ── Poll until a service's Docker healthcheck reports healthy ─────────────────
wait_for_healthy() {
  local service="$1"
  local timeout="${2:-60}"
  log "Waiting for $service to be healthy (up to ${timeout}s)..."
  local deadline=$(( $(date +%s) + timeout ))
  until $COMPOSE ps "$service" 2>/dev/null | grep -q "(healthy)"; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      $COMPOSE logs --tail=40 "$service"
      die "$service did not become healthy within ${timeout}s"
    fi
    sleep 3
  done
  ok "$service is healthy"
}

# ── Deploy ────────────────────────────────────────────────────────────────────
deploy() {
  # Always build the app image first so docker compose up never has to rely on
  # pull_policy to trigger a build.  This makes 'deploy' safe to call both
  # standalone (e.g. after a manual rollback) and from full_deploy().
  build_image

  log "Pulling third-party images (postgres / redis / nginx / certbot)..."
  $COMPOSE pull --ignore-pull-failures postgres redis nginx certbot

  log "Starting postgres and redis..."
  $COMPOSE up -d postgres redis
  wait_for_healthy postgres 60
  wait_for_healthy redis    30

  log "Running database migrations..."
  $COMPOSE run --rm \
    --no-deps \
    --entrypoint "" \
    app sh -c "npm run migration:run:prod"
  ok "Migrations applied"

  log "Starting all services..."
  if ! $COMPOSE up -d --remove-orphans; then
    warn "compose up failed — dumping diagnostic logs"
    echo "===== promptgenie-app logs (last 200) ====="
    $COMPOSE logs --tail=200 --no-color app || true
    echo "===== promptgenie-app docker logs (last 200) ====="
    docker logs --tail=200 promptgenie-app 2>&1 || true
    echo "===== container ps ====="
    $COMPOSE ps || true
    echo "===== container inspect (state) ====="
    docker inspect promptgenie-app --format '{{json .State}}' 2>&1 || true
    die "compose up -d --remove-orphans failed (see logs above)"
  fi

  wait_for_app_healthy
}

# ── Poll the app's HTTP health endpoint ───────────────────────────────────────
wait_for_app_healthy() {
  log "Waiting for app health endpoint (up to 120s)..."
  local deadline=$(( $(date +%s) + 120 ))
  until docker exec promptgenie-app \
      wget -qO- http://localhost:3000/api/v1/health/live 2>/dev/null \
      | grep -q '"status":"ok"'; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      $COMPOSE logs --tail=60 app
      die "App did not pass health check within 120s"
    fi
    sleep 5
  done
  ok "App is healthy ✓"
}

# ── Health check ──────────────────────────────────────────────────────────────
healthcheck() {
  log "Running health checks..."
  # shellcheck source=/dev/null
  [[ -f "$ROOT_DIR/.env" ]] && { set -a; source "$ROOT_DIR/.env"; set +a; } || true

  local fail_count=0

  # App
  local app_resp
  app_resp=$(docker exec promptgenie-app \
    wget -qO- http://localhost:3000/api/v1/health/live 2>/dev/null || echo "UNREACHABLE")
  if echo "$app_resp" | grep -q '"status":"ok"'; then
    ok "App: healthy"
  else
    echo -e "${RED}[FAIL]${NC} App: $app_resp"; (( fail_count++ )) || true
  fi

  # PostgreSQL
  local db_user="${DB_USERNAME:-postgres}"
  if docker exec promptgenie-postgres pg_isready -U "$db_user" 2>/dev/null \
      | grep -q "accepting"; then
    ok "PostgreSQL: accepting connections"
  else
    echo -e "${RED}[FAIL]${NC} PostgreSQL: not ready"; (( fail_count++ )) || true
  fi

  # Redis
  local redis_resp
  redis_resp=$(docker exec promptgenie-redis \
    redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} ping 2>/dev/null || echo "FAIL")
  if [ "$redis_resp" = "PONG" ]; then
    ok "Redis: PONG"
  else
    echo -e "${RED}[FAIL]${NC} Redis: $redis_resp"; (( fail_count++ )) || true
  fi

  [ $fail_count -eq 0 ] || die "$fail_count health check(s) failed"
  ok "All health checks passed ✓"
}

# ── Status ────────────────────────────────────────────────────────────────────
status() {
  $COMPOSE ps
  echo ""
  docker stats --no-stream --format \
    "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" \
    promptgenie-app promptgenie-postgres promptgenie-redis promptgenie-nginx 2>/dev/null || true
}

# ── Rollback ──────────────────────────────────────────────────────────────────
rollback() {
  warn "Rolling back app to nestjs-ready-app:previous..."
  docker image inspect nestjs-ready-app:previous &>/dev/null \
    || die "No previous image found (nestjs-ready-app:previous). Cannot roll back."

  docker tag nestjs-ready-app:latest   nestjs-ready-app:failed   2>/dev/null || true
  docker tag nestjs-ready-app:previous nestjs-ready-app:latest
  $COMPOSE up -d app
  wait_for_app_healthy
  ok "Rollback complete ✓"
}

# ── Logs ──────────────────────────────────────────────────────────────────────
logs() {
  $COMPOSE logs -f --tail=100 "${1:-app}"
}

# ── Full deploy pipeline ──────────────────────────────────────────────────────
full_deploy() {
  preflight

  # Tag current image as :previous before building so rollback is always available
  if docker image inspect nestjs-ready-app:latest &>/dev/null; then
    docker tag nestjs-ready-app:latest nestjs-ready-app:previous
    log "Saved nestjs-ready-app:previous (rollback available if this deploy fails)"
  fi

  # build_image() is called inside deploy() — no separate call needed here.
  deploy
  healthcheck
  ok "Deployment complete! ✓"
}

# ── Entry point ───────────────────────────────────────────────────────────────
case "${1:-help}" in
  deploy)      full_deploy ;;
  build)       build_image ;;
  healthcheck) healthcheck ;;
  status)      status ;;
  rollback)    rollback ;;
  logs)        logs "${2:-app}" ;;
  preflight)   preflight ;;
  *)
    echo "Usage: $0 {deploy|build|healthcheck|status|rollback|logs [svc]|preflight}"
    echo ""
    echo "Commands:"
    echo "  deploy       Full pipeline: preflight → build → deploy → healthcheck"
    echo "  build        Build app image only (nestjs-ready-app:latest)"
    echo "  healthcheck  Check app, postgres, and redis are responding"
    echo "  status       Show container status and resource usage"
    echo "  rollback     Restore nestjs-ready-app:previous and restart app"
    echo "  logs [svc]   Tail logs (default: app)"
    echo "  preflight    Validate env and required files without deploying"
    ;;
esac
