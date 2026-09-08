import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import { NotificationsService } from './notifications.service';
import { NotificationFiltersDto } from './dto/notification.dto';

@Controller('api/v1/notifications')
@UseGuards(AuthGuard('jwt'), TenantGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async findAll(@Request() req: any, @Query() filters: NotificationFiltersDto) {
    const businessId = req.user.businessId;
    return this.notificationsService.findAll(businessId, filters);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    const businessId = req.user.businessId;
    return this.notificationsService.findOne(businessId, id);
  }
}
