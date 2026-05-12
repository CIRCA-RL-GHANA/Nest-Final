# Deploying genie help Backend to Hostinger VPS

This guide walks through a one-time VPS initialisation and the automated CI/CD
pipeline that deploys every push to `main`.

## Raw GitHub file URLs

Use these URLs to pull individual files directly from GitHub without cloning
the repository — useful when bootstrapping a fresh VPS or referencing files
in scripts.

| File | Raw GitHub URL |
|---|---|
| VPS init script | `https://raw.githubusercontent.com/CIRCA-RL-GHANA/NestJS-Ready/main/scripts/vps-init.sh` |
| Production Compose file | `https://raw.githubusercontent.com/CIRCA-RL-GHANA/NestJS-Ready/main/docker-compose.prod.yml` |
| Deploy script | `https://raw.githubusercontent.com/CIRCA-RL-GHANA/NestJS-Ready/main/scripts/deploy.sh` |
| SSL setup script | `https://raw.githubusercontent.com/CIRCA-RL-GHANA/NestJS-Ready/main/scripts/setup-ssl.sh` |
| `.env` example | `https://raw.githubusercontent.com/CIRCA-RL-GHANA/NestJS-Ready/main/.env.example` |

> **Note:** `docker-compose.prod.yml` builds the app image from the local
> `Dockerfile` and references `./nginx/nginx.conf`, so it requires the full
> repository to be present on the VPS (handled automatically by the rsync
> step in CI/CD). Download it standalone only as a reference.

Quick one-liner to download all deployment files onto the VPS after provisioning:

```bash
BASE="https://raw.githubusercontent.com/CIRCA-RL-GHANA/NestJS-Ready/main"
mkdir -p /opt/promptgenie/scripts /opt/promptgenie/nginx
curl -fsSL "$BASE/docker-compose.prod.yml" -o /opt/promptgenie/docker-compose.prod.yml
curl -fsSL "$BASE/scripts/deploy.sh"       -o /opt/promptgenie/scripts/deploy.sh
curl -fsSL "$BASE/scripts/setup-ssl.sh"    -o /opt/promptgenie/scripts/setup-ssl.sh
curl -fsSL "$BASE/.env.example"            -o /opt/promptgenie/.env.example
chmod +x /opt/promptgenie/scripts/*.sh
```

---

**Infrastructure overview**

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage Node 18 production image |
| `docker-compose.prod.yml` | Nginx + Certbot + PostgreSQL + Redis + App |
| `nginx/nginx.conf` | TLS termination, rate limiting, reverse proxy |
| `.github/workflows/backend.yml` | CI (lint/test) → CD (rsync + Docker build on VPS) |
| `scripts/vps-init.sh` | One-time VPS bootstrap (Docker, firewall, SSL, user) |
| `scripts/deploy.sh` | Manual deploy helper (build, healthcheck, rollback, logs) |
| `scripts/setup-ssl.sh` | Re-issue / rotate Let's Encrypt certificates |

---

## Step 1 — Provision your Hostinger VPS

1. In the Hostinger panel create a **VPS** running **Ubuntu 22.04 LTS**.
   - Minimum **2 GB RAM** (4 GB recommended — TensorFlow requires headroom).
2. Note the public IPv4 address; you will need it in steps 5 and 6.

---

## Step 2 — Initialise the VPS (run once as root)

SSH in as `root` and run the bundled initialisation script:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/CIRCA-RL-GHANA/NestJS-Ready/main/scripts/vps-init.sh) \
  --domain api.genieinprompt.app \
  --email admin@genieinprompt.app
```

Or copy the repo first and run it locally:

```bash
scp scripts/vps-init.sh root@<VPS_IP>:/tmp/
ssh root@<VPS_IP> "bash /tmp/vps-init.sh --domain api.genieinprompt.app --email admin@genieinprompt.app"
```

The script:

- Updates system packages
- Creates a 2 GB swap file (safety net for small VPS)
- Installs **Docker** and **Docker Compose v2**
- Creates a `promptgenie` deploy user and adds it to the `docker` group
- Creates `/opt/promptgenie/{logs,uploads,certbot/conf,certbot/www}`
- Configures **UFW** firewall (22, 80, 443 open; all else denied)
- Hardens SSH (key-only, no root login, max 3 auth tries)
- Applies performance kernel parameters
- Issues a **Let's Encrypt** TLS certificate via Certbot standalone
- Registers a daily cron for automatic certificate renewal
- Configures logrotate for application logs

---

## Step 3 — Generate a deploy SSH key pair

Run this on your **local machine** (not the VPS):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/promptgenie_deploy -N ""
```

Copy the public key to the VPS:

```bash
ssh root@<VPS_IP> \
  "echo '$(cat ~/.ssh/promptgenie_deploy.pub)' >> /home/promptgenie/.ssh/authorized_keys"
```

Verify the key works:

```bash
ssh -i ~/.ssh/promptgenie_deploy promptgenie@<VPS_IP> "echo OK"
```

---

## Step 4 — Create the production `.env` on the VPS

```bash
ssh promptgenie@<VPS_IP>
cp /opt/promptgenie/.env.example /opt/promptgenie/.env   # if rsync hasn't run yet
nano /opt/promptgenie/.env
```

At minimum set:

```dotenv
NODE_ENV=production
PORT=3000

# ── Database ───────────────────────────────────────
DB_HOST=postgres          # Docker service name — do NOT use localhost
DB_PORT=5432
DB_USERNAME=promptgenie
DB_PASSWORD=<strong-random-password>
DB_NAME=promptgenie_prod
DB_SYNCHRONIZE=false
DB_MIGRATIONS_RUN=true

# ── Redis ───────────────────────────────────────────
REDIS_HOST=redis          # Docker service name — do NOT use localhost
REDIS_PORT=6379
REDIS_PASSWORD=<strong-random-password>

# ── Secrets (generate with: openssl rand -base64 64) ──
JWT_SECRET=<64-char-random>
JWT_REFRESH_SECRET=<64-char-random>

# ── PIN encryption (generate with: openssl rand -base64 32) ──
PIN_ENCRYPTION_KEY=<32-char-random>
PIN_ENCRYPTION_IV=<16-char-random>

# ── CORS ────────────────────────────────────────────
CORS_ORIGIN=https://genieinprompt.app

# ── Email (SendGrid) ────────────────────────────────
SENDGRID_API_KEY=SG.<your-key>
EMAIL_FROM=noreply@genieinprompt.app

# ── SMS (Twilio) ────────────────────────────────────
TWILIO_ACCOUNT_SID=AC<your-sid>
TWILIO_AUTH_TOKEN=<your-token>
TWILIO_PHONE_NUMBER=+<your-number>
```

Generate strong secrets:

```bash
openssl rand -base64 64   # JWT_SECRET / JWT_REFRESH_SECRET
openssl rand -base64 32   # PIN_ENCRYPTION_KEY
openssl rand -base64 16   # PIN_ENCRYPTION_IV
```

> **Never commit `.env` to version control.** It is already in `.gitignore`.

---

## Step 5 — Add GitHub Actions secrets

Go to **GitHub → Settings → Secrets and variables → Actions → New repository secret**
and add the following (names must match exactly):

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | VPS public IP or `api.genieinprompt.app` |
| `DEPLOY_USER` | `promptgenie` |
| `DEPLOY_SSH_KEY` | Full contents of `~/.ssh/promptgenie_deploy` (private key) |
| `DEPLOY_PORT` | `22` (or your custom SSH port) |

---

## Step 6 — Point your DNS

In the **Hostinger DNS panel** add an A record:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `api` | `<VPS_IP>` | 300 |

Wait for propagation (usually a few minutes with a 300 s TTL).
Verify with:

```bash
dig +short api.genieinprompt.app
```

---

## Step 7 — Deploy

Push to the `main` branch (or merge a PR):

```bash
git push origin main
```

The workflow in `.github/workflows/backend.yml` will:

1. **Lint** (`npm run lint`) and **type-check** (`tsc --noEmit`)
2. **Unit test** (`npm test`) against ephemeral Postgres + Redis containers
3. **Rsync** the repository to `/opt/promptgenie/` on the VPS
4. **Build** the Docker image on the VPS (`docker compose build --no-cache app`)
5. Start **Postgres + Redis** and wait for health checks
6. Run **DB migrations** (`npm run migration:run:prod`)
7. **Rolling restart** all services (`docker compose up -d --remove-orphans`)
8. Poll the **liveness probe** for up to 120 s
9. **Smoke test** `https://api.genieinprompt.app/api/v1/health/live` from the
   GitHub Actions runner

A failed health check or smoke test will cause the workflow to exit non-zero
and leave the previous containers running.

---

## Manual operations

### Run a full deploy manually from the VPS

```bash
ssh promptgenie@<VPS_IP>
cd /opt/promptgenie
bash scripts/deploy.sh deploy
```

### Other `deploy.sh` commands

```bash
bash scripts/deploy.sh status       # running containers + resource usage
bash scripts/deploy.sh healthcheck  # test app, postgres, redis
bash scripts/deploy.sh logs app     # tail NestJS logs (ctrl-c to stop)
bash scripts/deploy.sh logs nginx   # tail Nginx logs
bash scripts/deploy.sh rollback     # restart app from the previous image
bash scripts/deploy.sh preflight    # check Docker, .env, nginx config
```

### Re-issue / rotate SSL certificate

```bash
ssh promptgenie@<VPS_IP>
cd /opt/promptgenie
bash scripts/setup-ssl.sh api.genieinprompt.app admin@genieinprompt.app
```

---

## Monitoring & maintenance

### Health endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health` | Full check (DB + Redis + disk) |
| `GET /api/v1/health/ready` | Readiness probe |
| `GET /api/v1/health/live` | Liveness probe |

All three are public and return `200 OK` or `503 Service Unavailable`.

### View live logs

```bash
# NestJS application
docker compose -f /opt/promptgenie/docker-compose.prod.yml logs -f --tail=100 app

# Nginx access/error
docker compose -f /opt/promptgenie/docker-compose.prod.yml logs -f --tail=100 nginx
```

### Disk usage

```bash
docker system df
df -h /opt/promptgenie
```

### Container status

```bash
docker compose -f /opt/promptgenie/docker-compose.prod.yml ps
```

---

## Firewall reference

The VPS firewall (UFW) is configured by `vps-init.sh` to allow only:

| Port | Protocol | Purpose |
|---|---|---|
| 22 | TCP | SSH |
| 80 | TCP | HTTP (redirects to HTTPS, used for ACME challenge) |
| 443 | TCP | HTTPS |

All other inbound traffic is denied. PostgreSQL (5432) and Redis (6379) are
exposed only on `127.0.0.1` inside the VPS; they are not reachable from the
public internet.

---

## Troubleshooting

### `docker compose build` fails on the VPS

```bash
# Check disk space
df -h
# Prune old images and build cache
docker system prune -f
```

### App container is unhealthy

```bash
docker compose -f docker-compose.prod.yml logs --tail=60 app
```

### Migrations fail

```bash
# Run interactively to see detailed output
docker compose -f docker-compose.prod.yml run --rm \
  -e NODE_ENV=production --entrypoint "" \
  app sh -c "npm run migration:run:prod"
```

### Nginx fails to start (SSL cert missing)

The certificate is created by `vps-init.sh`. If it is missing, re-run:

```bash
bash scripts/vps-init.sh --domain api.genieinprompt.app --email admin@genieinprompt.app
```

Or use the standalone Certbot container directly:

```bash
docker run --rm -p 80:80 \
  -v /opt/promptgenie/certbot/conf:/etc/letsencrypt \
  -v /opt/promptgenie/certbot/www:/var/www/certbot \
  certbot/certbot certonly --standalone \
    --agree-tos --no-eff-email \
    -m admin@genieinprompt.app \
    -d api.genieinprompt.app \
    --non-interactive
```
