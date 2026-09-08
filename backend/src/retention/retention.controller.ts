import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import { RetentionService } from './retention.service';
import {
  UpdateRetentionSettingsDto,
  RetentionFiltersDto,
} from './dto/retention.dto';

@Controller('api/v1/retention')
@UseGuards(AuthGuard('jwt'), TenantGuard)
export class RetentionController {
  constructor(private readonly retentionService: RetentionService) {}

  @Get('settings')
  async getSettings(@Request() req: any) {
    const businessId = req.user.businessId;
    return this.retentionService.getOrCreateSettings(businessId);
  }

  @Patch('settings')
  async updateSettings(
    @Request() req: any,
    @Body() dto: UpdateRetentionSettingsDto
  ) {
    const businessId = req.user.businessId;
    return this.retentionService.updateSettings(businessId, dto);
  }

  @Get('stats')
  async getStats(@Request() req: any) {
    const businessId = req.user.businessId;
    return this.retentionService.getStats(businessId);
  }

  @Get('follow-ups')
  async findAll(@Request() req: any, @Query() query: RetentionFiltersDto) {
    const businessId = req.user.businessId;
    return this.retentionService.findAll(businessId, query);
  }

  @Get('follow-ups/:id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    const businessId = req.user.businessId;
    return this.retentionService.findOne(businessId, id);
  }

  @Post('sync-historical')
  async syncHistorical(@Request() req: any) {
    const businessId = req.user.businessId;
    return this.retentionService.syncHistoricalCompletedAppointments(businessId);
  }
}
