import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, TravelMode } from '@googlemaps/google-maps-services-js';

@Injectable()
export class GoogleMapsService {
  private readonly logger = new Logger(GoogleMapsService.name);
  private readonly client: Client;
  private readonly apiKey: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('googleMaps.apiKey') ?? '';
    this.enabled = !!this.apiKey;
    this.client = new Client({});

    if (this.enabled) {
      this.logger.log('Google Maps integration active');
    } else {
      this.logger.warn('Google Maps API key not set — falling back to Haversine');
    }
  }

  /**
   * Get real road-based distance and travel duration between two coordinates.
   * Falls back to straight-line Haversine if Maps is unavailable.
   */
  async getDistanceAndDuration(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ): Promise<{ distanceKm: number; durationMinutes: number }> {
    if (!this.enabled) {
      return this.haversineFallback(origin, destination);
    }

    try {
      const response = await this.client.distancematrix({
        params: {
          origins: [`${origin.lat},${origin.lng}`],
          destinations: [`${destination.lat},${destination.lng}`],
          mode: TravelMode.driving,
          key: this.apiKey,
        },
      });

      const element = response.data.rows[0]?.elements[0];
      if (!element || element.status !== 'OK') {
        this.logger.warn('Distance Matrix returned no OK element — falling back to Haversine');
        return this.haversineFallback(origin, destination);
      }

      return {
        distanceKm: element.distance.value / 1000,
        durationMinutes: Math.ceil(element.duration.value / 60),
      };
    } catch (err) {
      this.logger.warn(`Distance Matrix failed: ${err.message} — falling back to Haversine`);
      return this.haversineFallback(origin, destination);
    }
  }

  /**
   * Convert a text address into lat/lng coordinates.
   * Returns null if geocoding fails or Maps is not enabled.
   */
  async geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
    if (!this.enabled || !address?.trim()) return null;

    try {
      const response = await this.client.geocode({
        params: { address, key: this.apiKey },
      });

      const result = response.data.results[0];
      if (!result) return null;

      return {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
      };
    } catch (err) {
      this.logger.warn(`Geocoding failed for "${address}": ${err.message}`);
      return null;
    }
  }

  /**
   * Return address autocomplete suggestions for a partial input string.
   */
  async autocomplete(input: string): Promise<{ description: string; placeId: string }[]> {
    if (!this.enabled || !input?.trim()) return [];

    try {
      const response = await this.client.placeAutocomplete({
        params: { input, key: this.apiKey },
      });

      return response.data.predictions.map((p) => ({
        description: p.description,
        placeId: p.place_id,
      }));
    } catch (err) {
      this.logger.warn(`Autocomplete failed for "${input}": ${err.message}`);
      return [];
    }
  }

  // ── Haversine fallback ────────────────────────────────────────────────────

  private haversineFallback(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ): { distanceKm: number; durationMinutes: number } {
    const R = 6371;
    const dLat = this.toRad(destination.lat - origin.lat);
    const dLon = this.toRad(destination.lng - origin.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(origin.lat)) *
        Math.cos(this.toRad(destination.lat)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return {
      distanceKm,
      durationMinutes: Math.ceil(distanceKm * 2), // ~30 km/h average
    };
  }

  private toRad(value: number): number {
    return (value * Math.PI) / 180;
  }
}
