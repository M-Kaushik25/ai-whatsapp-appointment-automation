import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import { NotificationsService } from './notifications.service';
import { UpdateReminderSettingsDto } from './dto/notification.dto';

@Controller('api/v1/reminder-settings')
@UseGuards(AuthGuard('jwt'), TenantGuard)
export class ReminderSettingsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getSettings(@Request() req: any) {
    const businessId = req.user.businessId;
    return this.notificationsService.getOrCreateReminderSettings(businessId);
  }

  @Patch()
  async updateSettings(
    @Request() req: any,
    @Body() dto: UpdateReminderSettingsDto,
  ) {
    const businessId = req.user.businessId;
    return this.notificationsService.updateReminderSettings(businessId, dto);
  }
}
