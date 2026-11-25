import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { UserRepository } from "../../auth/repository/user.repository";
import { CodesService } from "../../codes/service/codes.service";
import { CodeRedemptionRepository } from "../../codes/repository/code-redemption.repository";
import { InvitationCodeRepository } from "../../codes/repository/invitation-code.repository";
import type { PackageVersionTermsDto } from "../../offers/dto/package-version-terms.dto";
import { PackageRepository } from "../../offers/repository/package.repository";
import { OfferCatalogService } from "../../offers/service/offer-catalog.service";
import type { SeedAccountInput } from "../types/seed-account-input";
import type { SeedAccountResult } from "../types/seed-account-result";
import { buildDevSeedCode } from "../utils/build-dev-seed-code";
import { loadDevAccountSeed } from "../utils/load-dev-account-seed";

const STARTER_PACKAGE_NAME = "Starter";

/**
 * Dev only (RNX-355, `bun run seed:dev-account`): gives one existing local account a package and a small paid
 * credit balance, through the same code path a real invitation code takes (a single-use "both" code, redeemed),
 * so the ledger and the purchase snapshot are written by their own services. Never creates a user. Refuses
 * NODE_ENV=production before any read or write. A second run for the same account writes nothing.
 */
@Injectable()
export class DevAccountSeedService {
  constructor(
    private readonly users: UserRepository,
    private readonly packages: PackageRepository,
    private readonly codeRows: InvitationCodeRepository,
    private readonly redemptions: CodeRedemptionRepository,
    private readonly catalog: OfferCatalogService,
    private readonly codes: CodesService,
  ) {}

  /** Grants the account its package and credits once; returns "already-seeded" when its dev seed code was redeemed. */
  async seedAccount(input: SeedAccountInput): Promise<SeedAccountResult> {
    if (process.env.NODE_ENV === "production") throw new ForbiddenException("The dev account seed refuses to run with NODE_ENV=production.");
    const seed = loadDevAccountSeed();
    const credits = input.credits ?? seed.defaultCredits;
    if (!(credits > 0)) throw new BadRequestException("credits must be a positive number.");
    const user = await this.users.findByEmail(input.email);
    if (!user) throw new NotFoundException(`No account with email ${input.email}; this seed never creates one.`);
    const code = buildDevSeedCode(user.id);
    const existing = await this.codeRows.findCodeWithPackage(code);
    if (existing && (await this.redemptions.findRedemption(existing.id, user.id))) return { outcome: "already-seeded", userId: user.id, code, credits };
    if (!existing) await this.codes.createCode({ code, type: "both", creditAmount: credits, packageVersionId: await this.resolvePackageVersionId(seed.terms, seed.reason), maxRedemptions: 1 });
    await this.codes.redeemCode(user.id, code);
    return { outcome: "granted", userId: user.id, code, credits };
  }

  /**
   * The version the account gets: the newest version of the "Starter" package if it has one, else the newest
   * version of the first package (display order) that has any; when there is none, version 1 of "Starter" from
   * the seed file's terms. Throws when no "Starter" package exists (run `bun run seed` first).
   */
  private async resolvePackageVersionId(terms: PackageVersionTermsDto, reason: string): Promise<string> {
    const starter = await this.packages.findByName(STARTER_PACKAGE_NAME);
    if (!starter) throw new NotFoundException(`The "${STARTER_PACKAGE_NAME}" package does not exist; run \`bun run seed\` first.`);
    const listed = await this.packages.findAllWithVersions();
    const starterVersion = listed.find((entry) => entry.id === starter.id)?.versions[0];
    const anyVersion = listed.find((entry) => entry.versions.length > 0)?.versions[0];
    const existing = starterVersion ?? anyVersion;
    if (existing) return existing.id;
    const created = await this.catalog.savePackageVersion({ ownerId: starter.id, terms, author: { changedBy: "seed:dev", reason } });
    return created.id;
  }
}
