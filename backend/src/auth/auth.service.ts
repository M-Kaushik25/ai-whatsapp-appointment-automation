import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  async registerOwner(data: any) {
    const { email, password, businessName, businessSlug } = data;

    if (!email || !password || !businessName) {
      throw new ConflictException('Email, password, and business name are required');
    }

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Generate clean unique slug
    let baseSlug = (businessSlug || businessName)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    
    if (!baseSlug) {
      baseSlug = 'biz-' + Math.random().toString(36).substring(7);
    }

    let slug = baseSlug;
    let counter = 1;
    while (await this.prisma.business.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}-${Math.random().toString(36).substring(7)}`;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create Business and User in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the business
      const business = await tx.business.create({
        data: {
          name: businessName.trim(),
          slug,
          settings: JSON.stringify({
            theme: 'light',
            timezone: 'Asia/Kolkata',
            bufferMinutes: 0,
            minimumBookingNoticeMinutes: 60,
            maximumAdvanceBookingDays: 30,
          })
        }
      });

      // Create the owner user
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase().trim(),
          password: hashedPassword,
          role: 'OWNER',
          businessId: business.id
        }
      });

      return { user, business };
    });

    // Generate JWT
    const payload = { 
      sub: result.user.id, 
      email: result.user.email,
      role: result.user.role,
      businessId: result.business.id
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        businessId: result.business.id
      }
    };
  }

  async login(data: any) {
    const { email, password } = data;
    if (!email || !password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { 
      sub: user.id, 
      email: user.email,
      role: user.role,
      businessId: user.businessId
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        businessId: user.businessId
      }
    };
  }
}
