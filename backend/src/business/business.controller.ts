import { Controller, Get, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { BusinessService } from './business.service';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';

@UseGuards(AuthGuard('jwt'), TenantGuard)
@Controller('api/v1/business')
export class BusinessController {
  constructor(private businessService: BusinessService) {}

  @Get('profile')
  getProfile(@Request() req: any) {
    // req.tenantId is populated by TenantGuard
    return this.businessService.getProfile(req.tenantId);
  }

  @Patch('settings')
  updateSettings(@Request() req: any, @Body() body: any) {
    return this.businessService.updateSettings(req.tenantId, body);
  }
}
