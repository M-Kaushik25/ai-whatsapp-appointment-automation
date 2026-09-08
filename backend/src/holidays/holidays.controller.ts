import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import { HolidaysService, CreateHolidayDto, UpdateHolidayDto } from './holidays.service';

@UseGuards(AuthGuard('jwt'), TenantGuard)
@Controller('api/v1/holidays')
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Get()
  async findAll(@Request() req: any) {
    return this.holidaysService.findAll(req.tenantId);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.holidaysService.findOne(req.tenantId, id);
  }

  @Post()
  async create(@Request() req: any, @Body() dto: CreateHolidayDto) {
    return this.holidaysService.create(req.tenantId, dto);
  }

  @Put(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.holidaysService.update(req.tenantId, id, dto);
  }

  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    return this.holidaysService.remove(req.tenantId, id);
  }
}
