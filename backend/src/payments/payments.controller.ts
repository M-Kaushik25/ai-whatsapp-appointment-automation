import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Headers,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TenantGuard } from '../guards/tenant.guard';
import { PaymentsService } from './payments.service';
import {
  UpdatePaymentSettingsDto,
  CreatePaymentDto,
  PaymentFiltersDto,
  RefundPaymentDto,
} from './dto/payment.dto';

@Controller('api/v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * PUBLIC Webhook Endpoint for Payment Providers (HMAC Verified, NO JWT Required)
   */
  @Post('webhook')
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-razorpay-signature') razorpaySignature?: string,
    @Headers('x-mock-signature') mockSignature?: string,
    @Headers() headers?: Record<string, any>
  ) {
    const signature = razorpaySignature || mockSignature || headers?.['x-signature'];
    if (!signature) {
      throw new BadRequestException('Missing webhook signature header');
    }

    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return this.paymentsService.handleWebhook(rawBody, signature, headers);
  }

  /**
   * Get Business Payment Settings (Tenant-Isolated)
   */
  @Get('settings')
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  async getSettings(@Request() req: any) {
    const businessId = req.user.businessId;
    const settings = await this.paymentsService.getOrCreateSettings(businessId);
    return this.paymentsService.maskSettings(settings);
  }

  /**
   * Update Business Payment Settings (Tenant-Isolated)
   */
  @Patch('settings')
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  async updateSettings(@Request() req: any, @Body() dto: UpdatePaymentSettingsDto) {
    const businessId = req.user.businessId;
    return this.paymentsService.updateSettings(businessId, dto);
  }

  /**
   * Get Payments KPI Stats (Tenant-Isolated)
   */
  @Get('stats')
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  async getStats(@Request() req: any) {
    const businessId = req.user.businessId;
    return this.paymentsService.getStats(businessId);
  }

  /**
   * List all payments with pagination & filtering (Tenant-Isolated)
   */
  @Get()
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  async findAll(@Request() req: any, @Query() filters: PaymentFiltersDto) {
    const businessId = req.user.businessId;
    return this.paymentsService.findAll(businessId, filters);
  }

  /**
   * Get payment details by ID (Tenant-Isolated)
   */
  @Get(':id')
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  async findOne(@Request() req: any, @Param('id') id: string) {
    const businessId = req.user.businessId;
    return this.paymentsService.findOne(businessId, id);
  }

  /**
   * Create or retrieve payment link for an appointment (Tenant-Isolated)
   */
  @Post('create-link')
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  async createPaymentLink(@Request() req: any, @Body() dto: CreatePaymentDto) {
    const businessId = req.user.businessId;
    if (!dto.appointmentId) {
      throw new BadRequestException('appointmentId is required');
    }
    return this.paymentsService.createPaymentForAppointment(businessId, dto.appointmentId, dto.type);
  }

  /**
   * Refund a paid payment (Tenant-Isolated)
   */
  @Post(':id/refund')
  @UseGuards(AuthGuard('jwt'), TenantGuard)
  async refundPayment(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto
  ) {
    const businessId = req.user.businessId;
    return this.paymentsService.refundPayment(businessId, id, dto);
  }
}
