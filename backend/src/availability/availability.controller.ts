import {
  Controller,
  Get,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import { AvailabilityService } from './availability.service';

@UseGuards(AuthGuard('jwt'), TenantGuard)
@Controller('api/v1/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  async getAvailability(
    @Request() req: any,
    @Query('serviceId') serviceId: string,
    @Query('staffId') staffId?: string,
    @Query('date') date?: string,
  ) {
    return this.availabilityService.getAvailableSlots(req.tenantId, {
      serviceId,
      staffId: staffId || 'ANY',
      date: date || new Date().toISOString().slice(0, 10),
    });
  }
}
