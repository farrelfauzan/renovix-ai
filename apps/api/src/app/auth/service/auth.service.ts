import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { RegisterDto, LoginDto, UpdateProfileDto } from "../dto/create-auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private generateApiKey(): string {
    return `sk_live_${crypto.randomBytes(24).toString("hex")}`;
  }

  private maskApiKey(key: string): string {
    return key.slice(0, 8) + "..." + key.slice(-4);
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException("Email already registered");
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const apiKey = this.generateApiKey();

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        apiKey,
        name: dto.name || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        apiKey: true,
        balance: true,
        createdAt: true,
      },
    });

    const token = this.signToken(user.id, user.email);

    return {
      user,
      token,
      apiKeyWarning:
        "Store this key securely. It will not be shown again in full.",
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (!user.password) {
      throw new UnauthorizedException(
        "This account uses social login. Please sign in with Google or GitHub.",
      );
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // Track last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = this.signToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        balance: user.balance,
        createdAt: user.createdAt,
      },
      token,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        name: true,
        firstName: true,
        lastName: true,
        avatar: true,
        phone: true,
        company: true,
        jobTitle: true,
        timezone: true,
        locale: true,
        status: true,
        balance: true,
        apiKey: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      ...user,
      apiKey: this.maskApiKey(user.apiKey),
    };
  }

  async regenerateApiKey(userId: string) {
    const apiKey = this.generateApiKey();
    await this.prisma.user.update({
      where: { id: userId },
      data: { apiKey },
    });
    return {
      apiKey,
      apiKeyWarning:
        "Store this key securely. It will not be shown again in full.",
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        name: true,
        firstName: true,
        lastName: true,
        phone: true,
        company: true,
        jobTitle: true,
        timezone: true,
        locale: true,
        updatedAt: true,
      },
    });
    return user;
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ userId, email });
  }
}
