import { Injectable } from "@nestjs/common";
import { UserRepository } from "../repository/user.repository";
import { TransactionService } from "../../prisma/transaction.service";
import { EntitlementService } from "../../offers/service/entitlement.service";
import { UpdateProfileDto } from "../dto/create-auth.dto";
import { CompleteProfileDto } from "../dto/complete-profile.dto";
import type { CurrentUserProfile } from "../types/current-user-profile";

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly transactions: TransactionService,
    private readonly entitlements: EntitlementService,
  ) {}

  /** This user's profile; `profileCompleted` tells whether the profile step has been saved (RNX-33). */
  async getProfile(userId: string): Promise<CurrentUserProfile> {
    const profile = await this.users.findProfileOrThrow(userId);
    return { ...profile, profileCompleted: profile.profileCompletedAt !== null };
  }

  /**
   * PATCH /auth/me: stores the given fields and answers with the profile, as GET /auth/me. RNX-77a: a default model tier
   * the account's packages do not allow is refused (400 PACKAGE_LIMIT_REACHED) before anything is written.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<CurrentUserProfile> {
    if (dto.defaultModelTier) await this.entitlements.requireModelTier(userId, dto.defaultModelTier);
    await this.users.updateProfile(userId, dto);
    return this.getProfile(userId);
  }

  /**
   * RNX-33: stores the profile step's answers on this user and marks the profile complete. The completion time is
   * set by the first save only. Answers with the updated profile, as GET /auth/me.
   */
  async completeProfile(userId: string, dto: CompleteProfileDto): Promise<CurrentUserProfile> {
    const data = { name: dto.name, role: dto.role, country: dto.country, timezone: dto.timezone, locale: dto.language, signupGoal: dto.goal };
    await this.transactions.run(async (tx) => {
      await this.users.saveProfileStep(userId, data, tx);
      await this.users.markProfileCompleted(userId, new Date(), tx);
    });
    return this.getProfile(userId);
  }
}
