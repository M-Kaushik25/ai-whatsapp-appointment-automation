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
import { ServicesService, CreateServiceDto, UpdateServiceDto } from './services.service';

@UseGuards(AuthGuard('jwt'), TenantGuard)
@Controller('api/v1/services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  async findAll(@Request() req: any, @Query('active') active?: string) {
    const activeOnly = active === 'true' ? true : active === 'false' ? false : undefined;
    return this.servicesService.findAll(req.tenantId, activeOnly);
  }

  @Get(':id')
  async findOne(@Request() req: any, @Param('id') id: string) {
    return this.servicesService.findOne(req.tenantId, id);
  }

  @Post()
  async create(@Request() req: any, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(req.tenantId, dto);
  }

  @Put(':id')
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.update(req.tenantId, id, dto);
  }

  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    return this.servicesService.remove(req.tenantId, id);
  }
}
