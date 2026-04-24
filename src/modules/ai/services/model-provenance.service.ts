/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ModelProvenanceService
 *
 * Recommendation 5 — Model Provenance and Signing.
 *
 * Manages cryptographic signatures for all ML model artifacts:
 *   • Signs model files with HMAC-SHA256 using a server-side secret key
 *   • Verifies a client-supplied signature before a model is allowed to run
 *   • Records provenance metadata (version, hash, role shard, training date)
 *     in the database for audit and rollback capability
 *   • Exposes endpoints consumed by the MLOps pipeline at deploy time
 *
 * Client verification flow:
 *   1. MLOps pipeline deploys a model → calls POST /ai/models/:id/sign
 *   2. Client downloads the model bundle + signature header
 *   3. Client calls POST /ai/models/:id/verify with its computed hash
 *   4. Server confirms match; client proceeds to load model
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface ModelProvenanceRecord {
  modelId: string;
  version: string;
  roleShard: string;          // 'owner' | 'administrator' | 'driver' | 'all'
  sha256Hash: string;         // hex digest of the model bundle
  hmacSignature: string;      // HMAC-SHA256(sha256Hash, signingSecret)
  sizeBytes: number;
  trainedAt: Date;
  signedAt: Date;
  isActive: boolean;
}

@Injectable()
export class ModelProvenanceService {
  private readonly logger = new Logger(ModelProvenanceService.name);

  // In production, persist to a dedicated `model_provenance` table.
  // Here we use an in-memory map; swap for a TypeORM repository.
  private readonly registry = new Map<string, ModelProvenanceRecord>();

  constructor(private readonly config: ConfigService) {}

  private get signingSecret(): string {
    const secret = this.config.get<string>('ML_MODEL_SIGNING_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error('ML_MODEL_SIGNING_SECRET must be at least 32 characters.');
    }
    return secret;
  }

  // ─── Sign a Model Artifact ──────────────────────────────────────────────

  /**
   * Called by the MLOps pipeline after producing a model bundle.
   * Computes and stores the HMAC signature for later client verification.
   */
  sign(params: {
    modelId: string;
    version: string;
    roleShard: string;
    sha256Hash: string;
    sizeBytes: number;
    trainedAt: Date;
  }): ModelProvenanceRecord {
    const hmac = crypto
      .createHmac('sha256', this.signingSecret)
      .update(params.sha256Hash)
      .digest('hex');

    const record: ModelProvenanceRecord = {
      ...params,
      hmacSignature: hmac,
      signedAt: new Date(),
      isActive: true,
    };

    // Deactivate any previous version of the same shard
    for (const [key, existing] of this.registry.entries()) {
      if (
        existing.roleShard === params.roleShard &&
        existing.modelId === params.modelId &&
        existing.isActive
      ) {
        existing.isActive = false;
        this.registry.set(key, existing);
      }
    }

    const key = `${params.modelId}@${params.version}`;
    this.registry.set(key, record);
    this.logger.log(
      `Model signed: ${key} | shard=${params.roleShard} | size=${params.sizeBytes}B`,
    );
    return record;
  }

  // ─── Verify Client Hash ─────────────────────────────────────────────────

  /**
   * Client downloads the model and computes its SHA-256. This endpoint
   * confirms the hash matches the signed record, preventing tampered models
   * from being executed.
   *
   * @throws UnauthorizedException if the hash does not match.
   */
  verify(modelId: string, version: string, clientHash: string): boolean {
    const key = `${modelId}@${version}`;
    const record = this.registry.get(key);
    if (!record) {
      throw new NotFoundException(`No provenance record for model ${key}`);
    }

    const expectedHmac = crypto
      .createHmac('sha256', this.signingSecret)
      .update(clientHash)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const expectedBuf = Buffer.from(record.hmacSignature, 'hex');
    const clientBuf = Buffer.from(expectedHmac, 'hex');

    if (
      expectedBuf.length !== clientBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, clientBuf)
    ) {
      this.logger.warn(
        `Model verification FAILED for ${key} — possible tampering detected.`,
      );
      throw new UnauthorizedException(
        'Model integrity check failed. The model bundle may have been tampered with.',
      );
    }

    this.logger.log(`Model verified: ${key}`);
    return true;
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  getActive(roleShard: string): ModelProvenanceRecord[] {
    return [...this.registry.values()].filter(
      (r) => r.isActive && (r.roleShard === roleShard || r.roleShard === 'all'),
    );
  }

  getAll(): ModelProvenanceRecord[] {
    return [...this.registry.values()];
  }

  rollback(modelId: string, version: string): void {
    const key = `${modelId}@${version}`;
    const record = this.registry.get(key);
    if (!record) throw new NotFoundException(`Model ${key} not found`);
    record.isActive = false;
    this.registry.set(key, record);
    this.logger.warn(`Model rolled back: ${key}`);
  }
}
