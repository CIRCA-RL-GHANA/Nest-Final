# Multi-stage build for production
# Debian (glibc) base — @tensorflow/tfjs-node ships pre-built native binaries
# for linux-x64 (glibc) only; musl/Alpine is not supported upstream.
FROM node:18-bookworm-slim AS builder

# python3 + build-essential + git: required for node-gyp compilation of native
# modules (bcrypt, @tensorflow/tfjs-node, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Install dependencies
RUN npm ci

# Copy ML model training script and any pre-existing model files
COPY ml-models ./ml-models

# Copy source code
COPY src ./src

# Build application
RUN npm run build

# Train & export all 5 TF.js models (fraud, pricing, recommendations, discount, churn).
# Runs inside the builder stage where @tensorflow/tfjs-node native binary is
# already compiled.  Output files are written back to ./ml-models/.
# Fails soft: if training cannot run for any reason, the pre-committed model
# artifacts already copied above are used at runtime.
RUN node ml-models/train-models.js || echo "[WARN] ML training skipped - using pre-committed models"

# Prune dev dependencies so the production stage can copy node_modules directly,
# preserving pre-compiled native binaries (bcrypt, @tensorflow/tfjs-node).
RUN npm prune --production

# Production stage
FROM node:18-bookworm-slim AS production

# Runtime libs for native modules + tini for proper signal handling
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy runtime path-alias registration helper (needed because tsc does not
# resolve TypeScript path aliases in compiled output)
COPY register-paths.js ./

# Copy pre-compiled production node_modules from the builder stage.
# Native modules (bcrypt, @tensorflow/tfjs-node) are already compiled there;
# re-running npm ci here would fail because this stage lacks python3/make/g++.
COPY --from=builder /app/node_modules ./node_modules

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy trained ML models from builder (trained during image build)
COPY --from=builder /app/ml-models ./ml-models

# Create non-root user (Debian syntax)
RUN groupadd -g 1001 nodejs && useradd -m -u 1001 -g nodejs nestjs

# Create necessary directories (logs + uploads); ml-models already copied from builder
RUN mkdir -p logs uploads && chown -R nestjs:nodejs /app

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health/live', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application (register-paths.js resolves TypeScript path aliases at runtime)
CMD ["node", "-r", "./register-paths.js", "dist/main"]
