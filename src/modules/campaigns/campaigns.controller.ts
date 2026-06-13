import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@ApiTags('campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'List campaigns for an entity' })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'status', required: false })
  list(@Query('entityId') entityId: string, @Query('status') status?: string) {
    return this.campaignsService.list(entityId, status);
  }

  @Post()
  @ApiOperation({ summary: 'Create a campaign' })
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignsService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campaign by ID' })
  findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update campaign' })
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaignsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete campaign' })
  remove(@Param('id') id: string) {
    return this.campaignsService.remove(id);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Activate campaign' })
  activate(@Param('id') id: string) {
    return this.campaignsService.setStatus(id, 'active');
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause campaign' })
  pause(@Param('id') id: string) {
    return this.campaignsService.setStatus(id, 'paused');
  }

  @Patch(':id/end')
  @ApiOperation({ summary: 'End campaign' })
  end(@Param('id') id: string) {
    return this.campaignsService.setStatus(id, 'ended');
  }

  @Get(':id/analytics')
  @ApiOperation({ summary: 'Get campaign analytics' })
  analytics(@Param('id') id: string) {
    return this.campaignsService.getAnalytics(id);
  }
}
