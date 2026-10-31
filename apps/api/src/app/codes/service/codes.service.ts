import {
  Injectable,
  Optional,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Decimal } from "@prisma/client/runtime/client";
import type { DbTransaction } from "../../prisma/db-transaction";
import { TransactionService } from "../../prisma/transaction.service";
import { CreateCodeDto } from "../dto/redeem-code.dto";
import { InvitationCodeRepository } from "../repository/invitation-code.repository";
import { CodeRedemptionRepository } from "../repository/code-redemption.repository";
import { CreditLedgerService } from "../../billing/service/credit-ledger.service";
import { PackageOwnershipService } from "../../billing/service/package-ownership.service";
import { PlatformSettingsService } from "../../offers/service/platform-settings.service";
import { PurchaseSnapshotService } from "../../offers/service/purchase-snapshot.service";
import { PackageRepository } from "../../offers/repository/package.repository";

const CODE_DEACTIVATED = "This code has been deactivated";
const CODE_EXPIRED = "This code has expired";
const NO_REDEMPTIONS_LEFT =
  "This code has reached its maximum number of redemptions";
const ALREADY_REDEEMED = "You have already redeemed this code";
const CREDITS_ONLY_NEEDS_PACKAGE = "A credits-only code can be redeemed only by an account with a package";

@Injectable()
export class CodesService {
  constructor(
    private readonly codes: InvitationCodeRepository,
    private readonly redemptions: CodeRedemptionRepository,
    private readonly packages: PackageRepository,
    private readonly purchaseSnapshots: PurchaseSnapshotService,
    private readonly creditLedger: CreditLedgerService,
    private readonly transactions: TransactionService,
    private readonly packageOwnership: PackageOwnershipService,
    @Optional() private readonly settings?: PlatformSettingsService,
  ) {}

  /**
   * Generate a unique invitation code in format PERF-XXXX-XXXX
   */
  private generateCode(): string {
    const segment = () => crypto.randomBytes(2).toString("hex").toUpperCase();
    return `PERF-${segment()}-${segment()}`;
  }

  /**
   * Redeem an invitation code for a user.
   * Grants credits and/or a package based on the code type (RNX-251: a package is a purchase snapshot, paymentId null).
   */
  async redeemCode(userId: string, codeString: string) {
    const code = await this.codes.findCodeWithPackage(codeString);

    if (!code) {
      throw new NotFoundException("Invalid invitation code");
    }

    if (!code.isActive) {
      throw new BadRequestException(CODE_DEACTIVATED);
    }

    if (new Date() > code.expiresAt) {
      throw new BadRequestException(CODE_EXPIRED);
    }

    if (code.timesRedeemed >= code.maxRedemptions) {
      throw new BadRequestException(NO_REDEMPTIONS_LEFT);
    }

    // Check if user already redeemed this code
    const existingRedemption = await this.redemptions.findRedemption(code.id, userId);

    if (existingRedemption) {
      throw new ConflictException(ALREADY_REDEEMED);
    }

    // D36 (RNX-35): no credits-only state; a free account cannot redeem a credits-only code.
    if (code.type === "topup" && !(await this.packageOwnership.hasPackage(userId))) {
      throw new ForbiddenException(CREDITS_ONLY_NEEDS_PACKAGE);
    }

    // Execute redemption in a transaction
    const result = await this.transactions.run(async (tx) => {
      // The checks above can race: claim a redemption first (this waits for any other redemption
      // of this code to finish, and checks again that the code is active, not expired and not used up),
      // then look again for this user's redemption.
      const now = new Date();
      if (!(await this.codes.claimRedemption(code.id, now, tx))) {
        // Read the code again to give the reason the claim refused it, in the order of the checks above.
        const current = await this.codes.findCodeById(code.id, tx);
        if (current && !current.isActive) {
          throw new BadRequestException(CODE_DEACTIVATED);
        }
        if (current && now > current.expiresAt) {
          throw new BadRequestException(CODE_EXPIRED);
        }
        throw new BadRequestException(NO_REDEMPTIONS_LEFT);
      }
      if (await this.redemptions.findRedemption(code.id, userId, tx)) {
        throw new ConflictException(ALREADY_REDEEMED);
      }

      let creditsGranted: Decimal | null = null;
      let planGranted: string | null = null;

      // Credits to grant, if applicable: written to the ledger below, once the redemption row exists (RX-22)
      if (
        (code.type === "topup" || code.type === "both") &&
        (code.creditAmount === null || code.creditAmount?.greaterThan(0))
      ) {
          const configuredGrant = await this.settings?.getSetting("invitationGrantCredits");
          if (configuredGrant == null) throw new Error('Platform setting "invitationGrantCredits" is not configured');
          creditsGranted = code.creditAmount ?? new Decimal(configuredGrant);
      }

      // RNX-251: a package code records a purchase snapshot of its version (paymentId null: a code grant, D37
      // permanent), not a user_subscriptions row.
      if ((code.type === "subscription" || code.type === "both") && code.packageVersionId) {
        await this.purchaseSnapshots.recordCodeGrant({ buyerUserId: userId, packageVersionId: code.packageVersionId }, tx);
        planGranted = code.packageVersion?.package.name ?? null;
      }

      // Create redemption record
      const redemption = await this.redemptions.createRedemption(
        code.id,
        userId,
        { creditsGranted, planGranted, daysGranted: null },
        tx,
      );

      // RX-22: the credits go to the user's paid wallet as one ledger entry (docs/credits.md section 2.1): a code
      // that also grants a package is a package code (plan_grant), a credits-only code is a bonus. Nothing writes
      // User.balance or a Transaction row any more (D190).
      if (creditsGranted) {
        await this.creditLedger.appendEntry(
          {
            owner: { userId },
            wallet: "paid",
            type: code.type === "both" ? "plan_grant" : "bonus",
            amount: creditsGranted,
            memberUserId: userId,
            reference: redemption.id,
            idempotencyKey: `code_redemption:${redemption.id}`,
          },
          tx,
        );
      }

      return { creditsGranted, planGranted };
    });

    return {
      success: true,
      creditsGranted: result.creditsGranted
        ? Number(result.creditsGranted)
        : null,
      planGranted: result.planGranted,
      // RNX-251: a package is permanent (D37), so a code grants no days.
      daysGranted: null,
    };
  }

  /**
   * Get redemption history for a user
   */
  async getHistory(userId: string) {
    const redemptions = await this.redemptions.findRedemptionsByUser(userId);

    return { redemptions };
  }

  /**
   * Admin: Create an invitation code. `tx` (RNX-226): the admin route's audit transaction, so the code and its
   * audit row commit together.
   */
  async createCode(dto: CreateCodeDto, createdById?: string, tx?: DbTransaction) {
    const code = dto.code || this.generateCode();

    // Validate type-specific fields
    if ((dto.type === "topup" || dto.type === "both") && !dto.creditAmount) {
      throw new BadRequestException(
        "creditAmount is required for topup or both type codes",
      );
    }

    if (
      (dto.type === "subscription" || dto.type === "both") &&
      !dto.packageVersionId
    ) {
      throw new BadRequestException(
        "packageVersionId is required for subscription or both type codes",
      );
    }

    // RNX-251: verify the package version exists if specified
    if (dto.packageVersionId && !(await this.packages.findVersionById(dto.packageVersionId, tx))) {
      throw new NotFoundException("Package version not found");
    }

    const created = await this.codes.createCode({
      code,
      type: dto.type,
      creditAmount: dto.creditAmount ?? null,
      packageVersionId: dto.packageVersionId ?? null,
      planId: null,
      durationDays: null,
      maxRedemptions: dto.maxRedemptions,
      createdById: createdById ?? null,
    }, tx);

    return { code: created };
  }

  /**
   * Admin: List all codes with usage stats
   */
  async listCodes(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [codes, total] = await Promise.all([
      this.codes.listCodes(skip, limit),
      this.codes.countCodes(),
    ]);

    return { codes, total, page, limit };
  }

  /**
   * Admin: Update a code (deactivate, change max redemptions). `tx` (RNX-226): the admin route's audit transaction.
   */
  async updateCode(
    id: string,
    data: { isActive?: boolean; maxRedemptions?: number },
    tx?: DbTransaction,
  ) {
    const code = await this.codes.findCodeById(id, tx);
    if (!code) {
      throw new NotFoundException("Code not found");
    }

    const updated = await this.codes.updateCode(id, data, tx);

    return { code: updated };
  }
}
