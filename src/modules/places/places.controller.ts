import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { PlacesService } from './places.service';
import { CreatePlaceDto } from './dto/create-place.dto';
import { UpdatePlaceDto } from './dto/update-place.dto';
import { Place, PlaceVisibility } from './entities/place.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('Places')
@ApiBearerAuth()
@Controller('places')
export class PlacesController {
  constructor(private readonly placesService: PlacesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new place' })
  @ApiResponse({ status: 201, description: 'Place created', type: Place })
  @ApiResponse({ status: 409, description: 'Place with this ID already exists' })
  async createPlace(
    @Body() createDto: CreatePlaceDto,
    @CurrentUser('id') ownerId: string,
  ): Promise<Place> {
    return this.placesService.createPlace(createDto, ownerId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all places with optional filters' })
  @ApiQuery({ name: 'ownerId', required: false })
  @ApiQuery({ name: 'visibility', enum: PlaceVisibility, required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'verified', type: 'boolean', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({ status: 200, description: 'Places retrieved', type: [Place] })
  async getPlaces(
    @Query('ownerId') ownerId?: string,
    @Query('visibility') visibility?: PlaceVisibility,
    @Query('category') category?: string,
    @Query('verified') verified?: boolean,
    @Query('search') search?: string,
  ): Promise<Place[]> {
    return this.placesService.getPlaces({ ownerId, visibility, category, verified, search });
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Address autocomplete suggestions (Google Maps)' })
  @ApiQuery({ name: 'input', required: true })
  @ApiResponse({ status: 200, description: 'Autocomplete suggestions' })
  async autocomplete(@Query('input') input: string) {
    return this.placesService.autocomplete(input);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search places by name, location, or category' })
  @ApiQuery({ name: 'q', required: true })
  @ApiResponse({ status: 200, description: 'Search results', type: [Place] })
  async searchPlaces(@Query('q') query: string): Promise<Place[]> {
    return this.placesService.searchPlaces(query);
  }

  @Get('category/:category')
  @ApiOperation({ summary: 'Get places by category' })
  @ApiResponse({ status: 200, description: 'Places retrieved', type: [Place] })
  async getPlacesByCategory(@Param('category') category: string): Promise<Place[]> {
    return this.placesService.getPlacesByCategory(category);
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Get places by proximity' })
  @ApiQuery({ name: 'latitude', required: true, type: 'number' })
  @ApiQuery({ name: 'longitude', required: true, type: 'number' })
  @ApiQuery({ name: 'radius', required: false, type: 'number', description: 'Radius in km (default 10)' })
  @ApiResponse({ status: 200, description: 'Nearby places', type: [Place] })
  async getPlacesByProximity(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('radius') radius?: string,
  ): Promise<Place[]> {
    return this.placesService.getPlacesByProximity(
      parseFloat(latitude),
      parseFloat(longitude),
      radius ? parseFloat(radius) : 10,
    );
  }

  @Get('entity/:entityId')
  @ApiOperation({ summary: 'Get places by entity/owner ID' })
  @ApiResponse({ status: 200, description: 'Places retrieved', type: [Place] })
  async getPlacesByEntity(@Param('entityId') entityId: string): Promise<Place[]> {
    return this.placesService.getPlaces({ ownerId: entityId });
  }

  @Get('unique/:uniquePlaceId')
  @ApiOperation({ summary: 'Get place by unique identifier' })
  @ApiResponse({ status: 200, description: 'Place retrieved', type: Place })
  @ApiResponse({ status: 404, description: 'Place not found' })
  async getPlaceByUniqueId(@Param('uniquePlaceId') uniquePlaceId: string): Promise<Place> {
    return this.placesService.getPlaceByUniqueId(uniquePlaceId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single place' })
  @ApiResponse({ status: 200, description: 'Place retrieved', type: Place })
  @ApiResponse({ status: 404, description: 'Place not found' })
  async getPlace(@Param('id') id: string): Promise<Place> {
    return this.placesService.getPlace(id);
  }

  @Get(':id/ratings')
  @ApiOperation({ summary: 'Get ratings for a place' })
  @ApiResponse({ status: 200, description: 'Place rating info' })
  async getPlaceRatings(@Param('id') id: string): Promise<{ rating: number; reviewCount: number }> {
    const place = await this.placesService.getPlace(id);
    return { rating: (place as any).rating ?? 0, reviewCount: (place as any).reviewCount ?? 0 };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a place' })
  @ApiResponse({ status: 200, description: 'Place updated', type: Place })
  @ApiResponse({ status: 403, description: 'Forbidden - not the owner' })
  @ApiResponse({ status: 404, description: 'Place not found' })
  async updatePlace(
    @Param('id') id: string,
    @Body() updateDto: UpdatePlaceDto,
    @CurrentUser('id') userId: string,
  ): Promise<Place> {
    return this.placesService.updatePlace(id, updateDto, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a place' })
  @ApiResponse({ status: 200, description: 'Place deleted' })
  @ApiResponse({ status: 403, description: 'Forbidden - not the owner' })
  @ApiResponse({ status: 404, description: 'Place not found' })
  async deletePlace(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ message: string }> {
    await this.placesService.deletePlace(id, userId);
    return { message: 'Place deleted successfully' };
  }

  // Single canonical verify endpoint — PATCH (partial update semantics).
  // The duplicate @Put(':id/verify') has been removed; a PUT on :id is the
  // full-update handler above, and there is no need to expose two paths for
  // the same verify action.
  @Patch(':id/verify')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Verify a place (admin only)' })
  @ApiResponse({ status: 200, description: 'Place verified', type: Place })
  @ApiResponse({ status: 404, description: 'Place not found' })
  async verifyPlace(@Param('id') id: string): Promise<Place> {
    return this.placesService.verifyPlace(id);
  }

  @Post(':id/rate')
  @ApiOperation({ summary: 'Add a rating to a place' })
  @ApiResponse({ status: 200, description: 'Rating added', type: Place })
  @ApiResponse({ status: 404, description: 'Place not found' })
  async ratePlace(
    @Param('id') id: string,
    @Body('rating') rating: number,
  ): Promise<Place> {
    return this.placesService.updatePlaceRating(id, rating);
  }
}
