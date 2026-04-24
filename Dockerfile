# Multi-stage build for production
FROM node:18-alpine AS builder

# libc6-compat: required for @tensorflow/tfjs-node native binary (glibc shim on Alpine/musl)
# python3 + make + g++ + git: required for node-gyp compilation of native modules (bcrypt, etc.)
RUN apk add --no-cache libc6-compat python3 make g++ git

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
RUN node ml-models/train-models.js

# Prune dev dependencies so the production stage can copy node_modules directly,
# preserving pre-compiled native binaries (bcrypt, @tensorflow/tfjs-node).
RUN npm prune --production

# Production stage
FROM node:18-alpine AS production

# libc6-compat: required for @tensorflow/tfjs-node native binary on Alpine/musl
RUN apk add --no-cache libc6-compat

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

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

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
