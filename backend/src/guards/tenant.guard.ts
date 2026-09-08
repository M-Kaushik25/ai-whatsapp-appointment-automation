import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // populated by JwtAuthGuard

    if (!user || !user.businessId) {
      throw new ForbiddenException('User is not associated with a business');
    }

    // Attach tenantId to request for easy access in controllers/services
    request.tenantId = user.businessId;

    return true; // We just ensure they have a tenant ID. Actual data filtering happens in service layers.
  }
}
