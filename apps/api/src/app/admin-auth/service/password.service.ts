import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { hash, hashSync, type Options, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { ADMIN_AUTH_CONFIG } from "../config/admin-auth-config.token";
import type { AdminAuthConfig } from "../types/admin-auth-config";
import { findPasswordProblem } from "../utils/find-password-problem";

/**
 * SecLists Pwdb_top-1000000 cut to 12+ characters (D61, R-6; source, commit and filter in
 * scripts/build-breached-password-list.ts). A JSON array, so the bundler, Jest and Bun load it the same way.
 */
const BREACHED_PASSWORDS: readonly string[] = require("../assets/breached-passwords-min12.json");

/**
 * Back-office passwords (RX-94): the rules for a new password and Argon2id hashing. The breached list is
 * loaded into a Set once, when the service is built. Plain class: `scripts/create-admin.ts` builds it too.
 */
@Injectable()
export class PasswordService {
  private readonly breached: ReadonlySet<string>;
  private readonly options: Options;
  /** Verified when the email is unknown, so an unknown account costs the same time as a known one. */
  private readonly dummyHash: string;

  constructor(@Inject(ADMIN_AUTH_CONFIG) private readonly config: AdminAuthConfig) {
    this.breached = new Set(BREACHED_PASSWORDS.map((entry) => entry.toLowerCase()));
    this.options = {
      memoryCost: config.argon2MemoryKib,
      timeCost: config.argon2TimeCost,
      parallelism: config.argon2Parallelism,
    };
    this.dummyHash = hashSync(randomBytes(32).toString("hex"), this.options);
  }

  /** Throws 400 with the reason when `password` may not be used by the admin with this email. */
  assertAcceptable(password: string, email: string): void {
    const problem = findPasswordProblem({ password, email, minLength: this.config.passwordMinLength, breached: this.breached });
    if (problem) throw new BadRequestException(problem);
  }

  /** Argon2id hash (PHC string) with the configured cost. */
  hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  /** True when `password` matches `passwordHash`; with no hash, does the same work on a dummy hash and returns false. */
  async verify(passwordHash: string | undefined, password: string): Promise<boolean> {
    const matches = await verify(passwordHash ?? this.dummyHash, password);
    return matches && passwordHash !== undefined;
  }
}
