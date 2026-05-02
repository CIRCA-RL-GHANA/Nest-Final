import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product, ProductStatus } from './entities/product.entity';
import { ProductMedia } from './entities/product-media.entity';
import { DiscountTier } from './entities/discount-tier.entity';
import { SOSAlert, SOSStatus } from './entities/sos-alert.entity';
import { DeliveryZone } from './entities/delivery-zone.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateProductMediaDto } from './dto/create-product-media.dto';
import { CreateDiscountTierDto } from './dto/create-discount-tier.dto';
import { UpdateDiscountTierDto } from './dto/update-discount-tier.dto';
import { CreateSOSAlertDto } from './dto/create-sos-alert.dto';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { AINlpService } from '../ai/services/ai-nlp.service';
import { AIPricingService } from '../ai/services/ai-pricing.service';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(ProductMedia)
    private productMediaRepository: Repository<ProductMedia>,
    @InjectRepository(DiscountTier)
    private discountTierRepository: Repository<DiscountTier>,
    @InjectRepository(SOSAlert)
    private sosAlertRepository: Repository<SOSAlert>,
    @InjectRepository(DeliveryZone)
    private deliveryZoneRepository: Repository<DeliveryZone>,
    private readonly aiNlp: AINlpService,
    private readonly aiPricing: AIPricingService,
  ) {}

  // Product Management
  async createProduct(createProductDto: CreateProductDto): Promise<Product> {
    const product = this.productRepository.create(createProductDto);
    return await this.productRepository.save(product);
  }

  async getProducts(
    branchId?: string,
    category?: string,
    status?: ProductStatus,
    isFeatured?: boolean,
  ): Promise<Product[]> {
    const query = this.productRepository.createQueryBuilder('product');

    if (branchId) {
      query.andWhere('product.branchId = :branchId', { branchId });
    }

    if (category) {
      query.andWhere('product.category = :category', { category });
    }

    if (status) {
      query.andWhere('product.status = :status', { status });
    }

    if (isFeatured !== undefined) {
      query.andWhere('product.isFeatured = :isFeatured', { isFeatured });
    }

    return await query.getMany();
  }

  async getProductById(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async updateProduct(id: string, updateProductDto: UpdateProductDto): Promise<Product> {
    const product = await this.getProductById(id);

    Object.assign(product, updateProductDto);
    return await this.productRepository.save(product);
  }

  async deleteProduct(id: string): Promise<void> {
    await this.getProductById(id);
    await this.productRepository.softDelete(id);
  }

  async searchProducts(query: string): Promise<Product[]> {
    // First get keyword-matched candidates from DB
    const candidates = await this.productRepository
      .createQueryBuilder('product')
      .where('product.name ILIKE :query', { query: `%${query}%` })
      .orWhere('product.description ILIKE :query', { query: `%${query}%` })
      .andWhere('product.status = :status', { status: ProductStatus.ACTIVE })
      .getMany();

    // Re-rank via NLP TF-IDF for semantic relevance
    if (candidates.length > 1) {
      this.aiNlp.resetIndex();
      candidates.forEach((p) =>
        this.aiNlp.indexDocument(p.id, `${p.name} ${p.description ?? ''} ${p.category ?? ''}`),
      );
      const scores = this.aiNlp.searchDocuments(query, candidates.length);
      const scoreMap = new Map(scores.map((s) => [s.id, s.score]));
      candidates.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
    }

    return candidates;
  }

  /** AI discount recommendation for a product */
  async getAIDiscountRecommendation(productId: string) {
    const product = await this.getProductById(productId);
    return this.aiPricing.recommendDiscount(
      Number(product.price),
      0, // daysSinceLastSale — caller should pass real value
      product.viewCount ?? 0,
      0.02, // default neutral conversion rate
      product.stockQuantity ?? 0,
    );
  }

  async updateStockQuantity(id: string, quantity: number, operation?: string): Promise<Product> {
    const product = await this.getProductById(id);

    if (operation === 'add') {
      product.stockQuantity += quantity;
    } else if (operation === 'subtract') {
      product.stockQuantity = Math.max(0, product.stockQuantity - quantity);
    } else {
      // Default: set absolute value (backward compatible)
      product.stockQuantity = quantity;
    }

    // Auto-update status based on stock
    if (product.stockQuantity === 0) {
      product.status = ProductStatus.OUT_OF_STOCK;
    } else if (product.status === ProductStatus.OUT_OF_STOCK) {
      product.status = ProductStatus.ACTIVE;
    }

    return await this.productRepository.save(product);
  }

  async incrementViewCount(id: string): Promise<void> {
    await this.productRepository.increment({ id }, 'viewCount', 1);
  }

  async updateRating(id: string, rating: number, reviewCount: number): Promise<Product> {
    const product = await this.getProductById(id);

    product.rating = rating;
    product.reviewCount = reviewCount;

    return await this.productRepository.save(product);
  }

  // Product Media Management
  async addProductMedia(createMediaDto: CreateProductMediaDto): Promise<ProductMedia> {
    // Check if product exists
    await this.getProductById(createMediaDto.productId);

    const media = this.productMediaRepository.create(createMediaDto);
    return await this.productMediaRepository.save(media);
  }

  async getProductMedia(productId: string): Promise<ProductMedia[]> {
    return await this.productMediaRepository.find({
      where: { productId },
      order: { displayOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async deleteProductMedia(id: string): Promise<void> {
    const media = await this.productMediaRepository.findOne({ where: { id } });

    if (!media) {
      throw new NotFoundException('Product media not found');
    }

    await this.productMediaRepository.softDelete(id);
  }

  // Discount Tier Management
  async createDiscountTier(createdBy: string, dto: CreateDiscountTierDto): Promise<DiscountTier> {
    const validFrom = new Date(dto.validFrom);
    const validTo = new Date(dto.validTo);

    if (validFrom >= validTo) {
      throw new BadRequestException('Valid from date must be before valid to date');
    }

    const discount = this.discountTierRepository.create({
      ...dto,
      createdBy,
      validFrom,
      validTo,
    });

    return await this.discountTierRepository.save(discount);
  }

  async getDiscountTiers(
    productId?: string,
    branchId?: string,
    isActive?: boolean,
  ): Promise<DiscountTier[]> {
    const query = this.discountTierRepository.createQueryBuilder('discount');

    if (productId) {
      query.andWhere('discount.productId = :productId', { productId });
    }

    if (branchId) {
      query.andWhere('discount.branchId = :branchId', { branchId });
    }

    if (isActive !== undefined) {
      query.andWhere('discount.isActive = :isActive', { isActive });
    }

    return await query.getMany();
  }

  async getActiveDiscountsForProduct(productId: string): Promise<DiscountTier[]> {
    const now = new Date();

    return await this.discountTierRepository
      .createQueryBuilder('discount')
      .where('discount.productId = :productId', { productId })
      .andWhere('discount.isActive = :isActive', { isActive: true })
      .andWhere('discount.validFrom <= :now', { now })
      .andWhere('discount.validTo >= :now', { now })
      .getMany();
  }

  async updateDiscountTier(id: string, dto: UpdateDiscountTierDto): Promise<DiscountTier> {
    const discount = await this.discountTierRepository.findOne({ where: { id } });

    if (!discount) {
      throw new NotFoundException('Discount tier not found');
    }

    if (dto.validFrom && dto.validTo) {
      const validFrom = new Date(dto.validFrom);
      const validTo = new Date(dto.validTo);

      if (validFrom >= validTo) {
        throw new BadRequestException('Valid from date must be before valid to date');
      }
    }

    Object.assign(discount, dto);
    return await this.discountTierRepository.save(discount);
  }

  async deleteDiscountTier(id: string): Promise<void> {
    const discount = await this.discountTierRepository.findOne({ where: { id } });

    if (!discount) {
      throw new NotFoundException('Discount tier not found');
    }

    await this.discountTierRepository.softDelete(id);
  }

  // SOS Alert Management
  async createSOSAlert(dto: CreateSOSAlertDto): Promise<SOSAlert> {
    const alert = this.sosAlertRepository.create(dto);
    return await this.sosAlertRepository.save(alert);
  }

  async getSOSAlerts(
    userId?: string,
    recipientId?: string,
    status?: SOSStatus,
  ): Promise<SOSAlert[]> {
    const query = this.sosAlertRepository.createQueryBuilder('alert');

    if (userId) {
      query.andWhere('alert.userId = :userId', { userId });
    }

    if (recipientId) {
      query.andWhere('alert.recipientId = :recipientId', { recipientId });
    }

    if (status) {
      query.andWhere('alert.status = :status', { status });
    }

    return await query.orderBy('alert.createdAt', 'DESC').getMany();
  }

  async resolveSOSAlert(id: string, resolutionNotes?: string): Promise<SOSAlert> {
    const alert = await this.sosAlertRepository.findOne({ where: { id } });

    if (!alert) {
      throw new NotFoundException('SOS alert not found');
    }

    alert.status = SOSStatus.RESOLVED;
    alert.resolvedAt = new Date();
    if (resolutionNotes) {
      alert.resolutionNotes = resolutionNotes;
    }

    return await this.sosAlertRepository.save(alert);
  }

  async cancelSOSAlert(id: string): Promise<SOSAlert> {
    const alert = await this.sosAlertRepository.findOne({ where: { id } });

    if (!alert) {
      throw new NotFoundException('SOS alert not found');
    }

    alert.status = SOSStatus.CANCELLED;
    return await this.sosAlertRepository.save(alert);
  }

  // Delivery Zone Management
  async createDeliveryZone(dto: CreateDeliveryZoneDto): Promise<DeliveryZone> {
    const zone = this.deliveryZoneRepository.create(dto);
    return await this.deliveryZoneRepository.save(zone);
  }

  async getDeliveryZones(branchId?: string, active?: boolean): Promise<DeliveryZone[]> {
    const query = this.deliveryZoneRepository.createQueryBuilder('zone');

    if (branchId) {
      query.andWhere('zone.branchId = :branchId', { branchId });
    }

    if (active !== undefined) {
      query.andWhere('zone.active = :active', { active });
    }

    return await query.getMany();
  }

  async getDeliveryZoneById(id: string): Promise<DeliveryZone> {
    const zone = await this.deliveryZoneRepository.findOne({ where: { id } });

    if (!zone) {
      throw new NotFoundException('Delivery zone not found');
    }

    return zone;
  }

  async findZoneByLocation(
    branchId: string,
    latitude: number,
    longitude: number,
  ): Promise<DeliveryZone | null> {
    const zones = await this.deliveryZoneRepository.find({
      where: { branchId, active: true },
    });

    // Calculate distance using Haversine formula
    const EARTH_RADIUS = 6371000; // meters

    for (const zone of zones) {
      const lat1 = (latitude * Math.PI) / 180;
      const lat2 = (zone.location.latitude * Math.PI) / 180;
      const deltaLat = ((zone.location.latitude - latitude) * Math.PI) / 180;
      const deltaLng = ((zone.location.longitude - longitude) * Math.PI) / 180;

      const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = EARTH_RADIUS * c;

      if (distance <= zone.radiusMeters) {
        return zone;
      }
    }

    return null;
  }

  async updateDeliveryZone(id: string, dto: UpdateDeliveryZoneDto): Promise<DeliveryZone> {
    const zone = await this.getDeliveryZoneById(id);

    Object.assign(zone, dto);
    return await this.deliveryZoneRepository.save(zone);
  }

  async deleteDeliveryZone(id: string): Promise<void> {
    await this.getDeliveryZoneById(id);
    await this.deliveryZoneRepository.softDelete(id);
  }

  // === Additional methods for frontend parity ===

  async getProductsByEntity(entityId: string): Promise<Product[]> {
    return await this.productRepository.find({
      where: { branchId: entityId },
    });
  }

  async getDiscountTierById(id: string): Promise<DiscountTier> {
    const tier = await this.discountTierRepository.findOne({ where: { id } });
    if (!tier) {
      throw new NotFoundException(`Discount tier ${id} not found`);
    }
    return tier;
  }

  async getDeliveryZonesByProduct(productId: string): Promise<DeliveryZone[]> {
    const product = await this.getProductById(productId);
    return await this.deliveryZoneRepository.find({
      where: { branchId: product.branchId },
    });
  }

  // ─── Bulk operations for enterprise catalog management ────────────────────

  /**
   * Bulk-create up to 200 products in a single request.
   * Returns an array of created products.
   * Rationale: large enterprise catalogs (retailers, logistics firms) need to
   * onboard hundreds of SKUs at once without making hundreds of HTTP calls.
   */
  async bulkCreateProducts(dtos: CreateProductDto[]): Promise<Product[]> {
    if (!dtos?.length) return [];
    if (dtos.length > 200) {
      throw new Error('Bulk create is limited to 200 products per request');
    }
    const entities = this.productRepository.create(dtos);
    return this.productRepository.save(entities);
  }

  /**
   * Bulk-update stock quantities for a list of product IDs.
   * Useful for large warehouse sync operations.
   * Returns the count of records updated.
   */
  async bulkUpdateStock(
    updates: { id: string; stockQuantity: number }[],
  ): Promise<{ updated: number }> {
    if (!updates?.length) return { updated: 0 };
    if (updates.length > 500) {
      throw new Error('Bulk stock update is limited to 500 items per request');
    }
    let count = 0;
    for (const u of updates) {
      await this.productRepository.update(u.id, { stockQuantity: u.stockQuantity });
      count++;
    }
    return { updated: count };
  }

  /**
   * Get all products for a branch (entity-scoped catalog view).
   * Supports optional status and category filtering for the enterprise portal.
   */
  async getProductsByBranch(
    branchId: string,
    filters?: { status?: string; category?: string },
  ): Promise<Product[]> {
    const qb = this.productRepository.createQueryBuilder('p')
      .where('p.branchId = :branchId', { branchId });
    if (filters?.status) {
      qb.andWhere('p.status = :status', { status: filters.status });
    }
    if (filters?.category) {
      qb.andWhere('p.category = :category', { category: filters.category });
    }
    return qb.orderBy('p.createdAt', 'DESC').getMany();
  }
}
