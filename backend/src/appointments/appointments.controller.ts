import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import {
  AppointmentsService,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
} from './appointments.service';

@UseGuards(AuthGuard('jwt'), TenantGuard)
@Controller('api/v1/appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  async create(@Request() req: any, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.createAppointment(req.tenantId, dto);
  }

  @Get('stats/daily')
  async getDailyStats(
    @Request() req: any,
    @Query('date') date?: string,
  ) {
    return this.appointmentsService.getDailyStats(req.tenantId, date);
  }

  @Get('upcoming')
  async getUpcoming(
    @Request() req: any,
    @Query('limit') limit?: string,
  ) {
    return this.appointmentsService.getUpcoming(
      req.tenantId,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Get()
  async findAll(
    @Request() req: any,
    @Query('staffId') staffId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.appointmentsService.findAll(req.tenantId, {
      staffId,
      serviceId,
      customerId,
      status,
      date,
      startDate,
      endDate,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.appointmentsService.findOne(req.tenantId, id);
  }

  @Post(':id/confirm')
  async confirm(@Request() req: any, @Param('id') id: string) {
    return this.appointmentsService.confirm(req.tenantId, id);
  }

  @Post(':id/complete')
  async complete(@Request() req: any, @Param('id') id: string) {
    return this.appointmentsService.complete(req.tenantId, id);
  }

  @Post(':id/no-show')
  async markNoShow(@Request() req: any, @Param('id') id: string) {
    return this.appointmentsService.markNoShow(req.tenantId, id);
  }

  @Post(':id/reschedule')
  async reschedule(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.reschedule(req.tenantId, id, dto);
  }

  @Post(':id/cancel')
  async cancel(@Request() req: any, @Param('id') id: string) {
    return this.appointmentsService.cancel(req.tenantId, id);
  }
}
