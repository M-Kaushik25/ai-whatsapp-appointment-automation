import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import {
  StaffService,
  CreateStaffDto,
  UpdateStaffDto,
  WorkingHourItemDto,
  BreakDto,
  LeaveDto,
} from './staff.service';

@UseGuards(AuthGuard('jwt'), TenantGuard)
@Controller('api/v1/staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  // --- STAFF CRUD ---

  @Get()
  async findAll(@Request() req: any, @Query('active') active?: string) {
    const activeOnly = active === 'true' ? true : active === 'false' ? false : undefined;
    return this.staffService.findAll(req.tenantId, activeOnly);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.staffService.findOne(req.tenantId, id);
  }

  @Post()
  async create(@Request() req: any, @Body() dto: CreateStaffDto) {
    return this.staffService.create(req.tenantId, dto);
  }

  @Put(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.update(req.tenantId, id, dto);
  }

  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    return this.staffService.remove(req.tenantId, id);
  }

  // --- STAFF-SERVICES ASSIGNMENT ---

  @Get(':id/services')
  async getStaffServices(@Request() req: any, @Param('id') id: string) {
    return this.staffService.getStaffServices(req.tenantId, id);
  }

  @Put(':id/services')
  async setStaffServices(
    @Request() req: any,
    @Param('id') id: string,
    @Body('serviceIds') serviceIds: string[],
  ) {
    return this.staffService.setStaffServices(req.tenantId, id, serviceIds || []);
  }

  // --- WORKING HOURS ---

  @Get(':id/working-hours')
  async getWorkingHours(@Request() req: any, @Param('id') id: string) {
    return this.staffService.getWorkingHours(req.tenantId, id);
  }

  @Put(':id/working-hours')
  async setWorkingHours(
    @Request() req: any,
    @Param('id') id: string,
    @Body('schedule') schedule: WorkingHourItemDto[],
  ) {
    return this.staffService.setWorkingHours(req.tenantId, id, schedule || []);
  }

  // --- BREAKS ---

  @Get(':id/breaks')
  async getBreaks(@Request() req: any, @Param('id') id: string) {
    return this.staffService.getBreaks(req.tenantId, id);
  }

  @Post(':id/breaks')
  async addBreak(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: BreakDto,
  ) {
    return this.staffService.addBreak(req.tenantId, id, dto);
  }

  @Put(':id/breaks/:breakId')
  async updateBreak(
    @Request() req: any,
    @Param('id') id: string,
    @Param('breakId') breakId: string,
    @Body() dto: BreakDto,
  ) {
    return this.staffService.updateBreak(req.tenantId, id, breakId, dto);
  }

  @Delete(':id/breaks/:breakId')
  async deleteBreak(
    @Request() req: any,
    @Param('id') id: string,
    @Param('breakId') breakId: string,
  ) {
    return this.staffService.deleteBreak(req.tenantId, id, breakId);
  }

  // --- LEAVES ---

  @Get(':id/leaves')
  async getLeaves(@Request() req: any, @Param('id') id: string) {
    return this.staffService.getLeaves(req.tenantId, id);
  }

  @Post(':id/leaves')
  async addLeave(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: LeaveDto,
  ) {
    return this.staffService.addLeave(req.tenantId, id, dto);
  }

  @Put(':id/leaves/:leaveId')
  async updateLeave(
    @Request() req: any,
    @Param('id') id: string,
    @Param('leaveId') leaveId: string,
    @Body() dto: LeaveDto,
  ) {
    return this.staffService.updateLeave(req.tenantId, id, leaveId, dto);
  }

  @Delete(':id/leaves/:leaveId')
  async deleteLeave(
    @Request() req: any,
    @Param('id') id: string,
    @Param('leaveId') leaveId: string,
  ) {
    return this.staffService.deleteLeave(req.tenantId, id, leaveId);
  }
}
