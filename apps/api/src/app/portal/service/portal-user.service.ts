import { Injectable } from "@nestjs/common";
import { UserRepository } from "../../auth/repository/user.repository";
import { CreditAccountRepository } from "../../billing/repository/credit-account.repository";

/** The chat portal's signed-in user, for PortalGuard (a guard uses services, never repositories). */
@Injectable()
export class PortalUserService {
  constructor(
    private readonly users: UserRepository,
    private readonly creditAccounts: CreditAccountRepository,
  ) {}

  /** The id and email of this user, if there is one. */
  findPortalUser(userId: string) {
    return this.users.findPortalUser(userId);
  }

  /**
   * The credits this user may spend from the ledger's paid wallet (RX-22, D202-2): balance - held, read from the
   * account row; 0 when the user has no account yet.
   */
  async findPaidAvailable(userId: string): Promise<number> {
    const account = await this.creditAccounts.findAccount({ userId }, "paid");
    return account ? account.balance.minus(account.held).toNumber() : 0;
  }
}
