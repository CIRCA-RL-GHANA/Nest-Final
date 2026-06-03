import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AINlpService } from '../../ai/services/ai-nlp.service';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { v4 as uuidv4 } from 'uuid';
import { Readable } from 'stream';

export interface FileUploadResponse {
  fileId: string;
  key: string;
  url: string;
  size: number;
  type: string;
  uploadedAt: Date;
}

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly aiNlp: AINlpService,
  ) {
    cloudinary.config({
      cloud_name: this.config.get<string>('cloudinary.cloudName'),
      api_key: this.config.get<string>('cloudinary.apiKey'),
      api_secret: this.config.get<string>('cloudinary.apiSecret'),
      secure: true,
    });
  }

  /**
   * Upload file to Cloudinary
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string,
    userId: string,
  ): Promise<FileUploadResponse> {
    this.validateFile(file, folder);

    const publicId = `${folder}/${userId}/${Date.now()}-${uuidv4()}`;

    try {
      const result = await this.uploadStream(file.buffer, {
        public_id: publicId,
        folder: `promptgenie/${folder}`,
        resource_type: 'auto',
        type: 'authenticated',
      });

      this.logger.log(`File uploaded: ${result.public_id}`);

      return {
        fileId: uuidv4(),
        key: result.public_id,
        url: result.secure_url,
        size: file.size,
        type: file.mimetype,
        uploadedAt: new Date(),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Upload failed: ${msg}`);
      throw new BadRequestException(`Upload failed: ${msg}`);
    }
  }

  /**
   * Generate a signed URL for private file access (1 hour expiry)
   */
  async getSignedUrl(fileKey: string, expiresIn = 3600): Promise<string> {
    try {
      return cloudinary.utils.private_download_url(fileKey, '', {
        expires_at: Math.floor(Date.now() / 1000) + expiresIn,
        attachment: false,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to generate signed URL: ${msg}`);
      throw new BadRequestException('Failed to generate download URL');
    }
  }

  /**
   * Delete file from Cloudinary
   */
  async deleteFile(fileKey: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(fileKey, { resource_type: 'auto', invalidate: true });
      this.logger.log(`File deleted: ${fileKey}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Delete failed: ${msg}`);
      throw new BadRequestException(`Delete failed: ${msg}`);
    }
  }

  /**
   * Get file metadata from the public_id path convention:
   * promptgenie/{folder}/{userId}/{timestamp}-{uuid}
   */
  async getFileMetadata(fileKey: string): Promise<{ userId: string; key: string }> {
    const parts = fileKey.split('/');
    // format: promptgenie / folder / userId / filename
    const userId = parts.length >= 3 ? parts[parts.length - 2] : '';
    return { userId, key: fileKey };
  }

  /**
   * AI: Classify a filename to suggest the best storage folder.
   * extractKeywords is synchronous — no await needed.
   */
  classifyFileAI(filename: string): { folder: string; keywords: string[] } {
    try {
      const keywords = this.aiNlp.extractKeywords(filename);
      const lower = filename.toLowerCase();
      let folder = 'attachments';
      if (/avatar|profile|photo|picture/.test(lower)) folder = 'avatars';
      else if (/receipt|invoice|payment|bill/.test(lower)) folder = 'receipts';
      else if (/doc|contract|agreement|report|pdf/.test(lower)) folder = 'documents';
      return { folder, keywords };
    } catch {
      return { folder: 'attachments', keywords: [] };
    }
  }

  private uploadStream(
    buffer: Buffer,
    options: Record<string, unknown>,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        options,
        (error: Error | undefined, result: UploadApiResponse | undefined) => {
          if (error) return reject(error);
          resolve(result!);
        },
      );
      Readable.from(buffer).pipe(stream);
    });
  }

  private validateFile(file: Express.Multer.File, folder: string): void {
    const allowedTypes: Record<string, string[]> = {
      avatars: ['image/jpeg', 'image/png', 'image/webp'],
      documents: ['application/pdf', 'application/msword'],
      receipts: ['image/jpeg', 'image/png'],
      attachments: ['image/jpeg', 'image/png', 'video/mp4', 'application/pdf'],
    };

    const maxSizes: Record<string, number> = {
      avatars: 5 * 1024 * 1024,
      documents: 20 * 1024 * 1024,
      receipts: 10 * 1024 * 1024,
      attachments: 50 * 1024 * 1024,
    };

    const allowed = allowedTypes[folder] ?? [];
    if (allowed.length && !this.isAllowedType(file.mimetype, allowed)) {
      throw new BadRequestException(`File type ${file.mimetype} not allowed for ${folder}`);
    }

    const maxSize = maxSizes[folder] ?? 50 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(`File size exceeds ${maxSize / 1024 / 1024}MB limit`);
    }
  }

  private isAllowedType(mimeType: string, allowed: string[]): boolean {
    return allowed.some((type) => {
      if (type.endsWith('/*')) return mimeType.startsWith(type.slice(0, -2));
      return mimeType === type;
    });
  }
}
