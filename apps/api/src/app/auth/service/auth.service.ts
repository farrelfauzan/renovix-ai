import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { UserRepository } from "../repository/user.repository";
import { WorkspaceRepository } from "../../workspace/repository/workspace.repository";
import { TransactionService } from "../../prisma/transaction.service";
import { RegisterDto, LoginDto, UpdateProfileDto } from "../dto/create-auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly jwtService: JwtService,
    private readonly workspaces: WorkspaceRepository,
    private readonly transactions: TransactionService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.users.findUserByEmail(dto.email);
    if (existing) {
      throw new ConflictException("Email already registered");
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // The user and its default workspace (RNX-117) are written together or not at all. No API key (RNX-18):
    // keys are created on request only (POST /auth/keys).
    const user = await this.transactions.run(async (tx) => {
      const created = await this.users.createUser(
        {
          email: dto.email,
          password: hashedPassword,
          name: dto.name || null,
        },
        tx,
      );
      await this.workspaces.ensureDefaultWorkspace(created.id, tx);
      return created;
    });

    const token = this.signToken(user.id, user.email);

    return { user, token };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findUserByEmail(dto.email);
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
    await this.users.updateLastLogin(user.id);

    const token = this.signToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      token,
    };
  }

  getProfile(userId: string) {
    return this.users.findProfileOrThrow(userId);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.users.updateProfile(userId, dto);
    return user;
  }

  private signToken(userId: string, email: string): string {
    return this.jwtService.sign({ userId, email });
  }
}
