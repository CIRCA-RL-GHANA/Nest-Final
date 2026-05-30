import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, ILike } from 'typeorm';
import { CreatePlaceDto } from './dto/create-place.dto';
import { UpdatePlaceDto } from './dto/update-place.dto';
import { Place, PlaceVisibility } from './entities/place.entity';
import { AISearchService } from '../ai/services/ai-search.service';
import { GoogleMapsService } from '../google-maps/google-maps.service';

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  constructor(
    @InjectRepository(Place)
    private readonly placeRepository: Repository<Place>,
    private readonly aiSearch: AISearchService,
    private readonly googleMaps: GoogleMapsService,
  ) {}

  /**
   * Create a new place
   */
  async createPlace(dto: CreatePlaceDto, ownerId: string): Promise<Place> {
    this.logger.log(`Creating place: ${dto.uniquePlaceId}`);

    const existing = await this.placeRepository.findOne({
      where: { uniquePlaceId: dto.uniquePlaceId },
    });

    if (existing) {
      throw new ConflictException('Place with this ID already exists');
    }

    // Auto-geocode if coordinates not provided but a location string is
    let coordinates = dto.coordinates ?? null;
    if (!coordinates && dto.location) {
      const geocoded = await this.googleMaps.geocodeAddress(dto.location);
      if (geocoded) {
        coordinates = { latitude: geocoded.lat, longitude: geocoded.lng };
      }
    }

    const place = this.placeRepository.create({
      ...dto,
      ownerId,
      coordinates,
      visibility: dto.visibility || PlaceVisibility.PRIVATE,
    });

    const saved = await this.placeRepository.save(place);
    this.logger.log(`Place created: ${saved.id}`);

    // AI: index the place so it's discoverable via semantic search
    try {
      const indexText = `${saved.name} ${(saved as any).description ?? ''} ${saved.category ?? ''} ${(saved as any).location ?? ''}`;
      this.aiSearch.indexEntity('place', saved.id, indexText);
    } catch (e) {
      this.logger.warn(`AI place indexing failed: ${e.message}`);
    }

    return saved;
  }

  /**
   * Get all places with filters
   */
  async getPlaces(filters: {
    ownerId?: string;
    visibility?: PlaceVisibility;
    category?: string;
    verified?: boolean;
    search?: string;
  }): Promise<Place[]> {
    const where: FindOptionsWhere<Place> = {};

    if (filters.ownerId) {
      where.ownerId = filters.ownerId;
    }

    if (filters.visibility) {
      where.visibility = filters.visibility;
    }

    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.verified !== undefined) {
      where.verified = filters.verified;
    }

    if (filters.search) {
      where.name = ILike(`%${filters.search}%`);
    }

    return await this.placeRepository.find({
      where,
      order: { rating: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * Get a single place
   */
  async getPlace(id: string): Promise<Place> {
    const place = await this.placeRepository.findOne({
      where: { id },
    });

    if (!place) {
      throw new NotFoundException('Place not found');
    }

    return place;
  }

  /**
   * Get place by unique identifier
   */
  async getPlaceByUniqueId(uniquePlaceId: string): Promise<Place> {
    const place = await this.placeRepository.findOne({
      where: { uniquePlaceId },
    });

    if (!place) {
      throw new NotFoundException('Place not found');
    }

    return place;
  }

  /**
   * Update a place
   */
  async updatePlace(id: string, dto: UpdatePlaceDto, userId: string): Promise<Place> {
    this.logger.log(`Updating place: ${id}`);

    const place = await this.placeRepository.findOne({
      where: { id },
    });

    if (!place) {
      throw new NotFoundException('Place not found');
    }

    // Authorization check
    if (place.ownerId !== userId) {
      throw new ForbiddenException('You can only update your own places');
    }

    Object.assign(place, dto);
    const updated = await this.placeRepository.save(place);

    this.logger.log(`Place updated: ${id}`);
    return updated;
  }

  /**
   * Delete a place
   */
  async deletePlace(id: string, userId: string): Promise<void> {
    this.logger.log(`Deleting place: ${id}`);

    const place = await this.placeRepository.findOne({
      where: { id },
    });

    if (!place) {
      throw new NotFoundException('Place not found');
    }

    // Authorization check
    if (place.ownerId !== userId) {
      throw new ForbiddenException('You can only delete your own places');
    }

    await this.placeRepository.softRemove(place);
    this.logger.log(`Place deleted: ${id}`);
  }

  /**
   * Verify a place (admin only)
   */
  async verifyPlace(id: string): Promise<Place> {
    this.logger.log(`Verifying place: ${id}`);

    const place = await this.placeRepository.findOne({
      where: { id },
    });

    if (!place) {
      throw new NotFoundException('Place not found');
    }

    place.verified = true;
    const updated = await this.placeRepository.save(place);

    this.logger.log(`Place verified: ${id}`);
    return updated;
  }

  /**
   * Update place rating
   */
  async updatePlaceRating(id: string, newRating: number): Promise<Place> {
    const place = await this.placeRepository.findOne({
      where: { id },
    });

    if (!place) {
      throw new NotFoundException('Place not found');
    }

    // Calculate new average rating
    const currentRating = place.rating || 0;
    const currentCount = place.reviewCount || 0;
    const totalRating = currentRating * currentCount + newRating;
    const newCount = currentCount + 1;
    const averageRating = totalRating / newCount;

    place.rating = Math.round(averageRating * 100) / 100; // Round to 2 decimals
    place.reviewCount = newCount;

    return await this.placeRepository.save(place);
  }

  /**
   * Get places by proximity (requires coordinates)
   */
  async getPlacesByProximity(
    latitude: number,
    longitude: number,
    radiusKm: number = 10,
  ): Promise<Place[]> {
    // This would require PostGIS extension for accurate distance calculation
    // For now, return all places with coordinates
    const places = await this.placeRepository
      .createQueryBuilder('place')
      .where('place.coordinates IS NOT NULL')
      .andWhere('place.visibility = :visibility', { visibility: PlaceVisibility.PUBLIC })
      .getMany();

    // Simple distance calculation (Haversine formula could be used for accuracy)
    return places.filter((place) => {
      if (!place.coordinates) return false;

      const distance = this.calculateDistance(
        latitude,
        longitude,
        place.coordinates.latitude,
        place.coordinates.longitude,
      );

      return distance <= radiusKm;
    });
  }

  /**
   * Get places by category
   */
  async getPlacesByCategory(category: string): Promise<Place[]> {
    return await this.placeRepository.find({
      where: { category, visibility: PlaceVisibility.PUBLIC },
      order: { rating: 'DESC' },
    });
  }

  /**
   * Address autocomplete suggestions via Google Maps Places API
   */
  async autocomplete(input: string): Promise<{ description: string; placeId: string }[]> {
    return this.googleMaps.autocomplete(input);
  }

  /**
   * Search places — SQL ILIKE first, then AI TF-IDF re-ranking for better relevance.
   */
  async searchPlaces(query: string): Promise<Place[]> {
    const candidates = await this.placeRepository
      .createQueryBuilder('place')
      .where('place.name ILIKE :query', { query: `%${query}%` })
      .orWhere('place.location ILIKE :query', { query: `%${query}%` })
      .orWhere('place.category ILIKE :query', { query: `%${query}%` })
      .andWhere('place.visibility = :visibility', { visibility: PlaceVisibility.PUBLIC })
      .orderBy('place.rating', 'DESC')
      .limit(50)
      .getMany();

    if (candidates.length <= 1) return candidates;

    // AI re-rank by cosine similarity to the query
    try {
      const docs = candidates.map((p) => ({
        id: p.id,
        text: `${p.name} ${(p as any).description ?? ''} ${p.category ?? ''} ${(p as any).location ?? ''}`,
      }));
      const ranked = this.aiSearch.rankCandidates(query, docs, candidates.length);
      const order = new Map(ranked.map((r, i) => [r.id, i]));
      return [...candidates].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    } catch (e) {
      this.logger.warn(`AI place re-ranking failed: ${e.message}`);
      return candidates;
    }
  }

  /**
   * Helper: Calculate distance between two coordinates (in km)
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
