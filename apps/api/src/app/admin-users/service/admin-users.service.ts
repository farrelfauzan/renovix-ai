import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AdminRoleRepository } from "../../admin-auth/repository/admin-role.repository";
import { PiiRevealService } from "../../admin-auth/service/pii-reveal.service";
import type { AdminIdentity } from "../../admin-auth/types/admin-identity";
import type { Audited } from "../../admin-usage/types/audited";
import { UserRepository } from "../../auth/repository/user.repository";
import { CreditLedgerEntryRepository } from "../../billing/repository/credit-ledger-entry.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import { USER_LIST_PAGE_SIZE } from "../config/user-list-page-size";
import type { ListUsersQueryDto } from "../dto/list-users-query.dto";
import type { AdminUserDetail } from "../types/admin-user-detail";
import type { AdminUserPage } from "../types/admin-user-page";
import type { LedgerEntryView } from "../types/ledger-entry-view";
import type { UserRevealInput } from "../types/user-reveal-input";
import type { UserRevealView } from "../types/user-reveal-view";
import { toAdminUserDetail } from "../utils/to-admin-user-detail";
import { toAdminUserListItem } from "../utils/to-admin-user-list-item";
import { toLedgerEntryView } from "../utils/to-ledger-entry-view";

/** The permission that shows a user's ledger entries in the detail. */
const CREDITS_READ = "credits:read";
/** Ledger entries the detail shows, newest first. */
const DETAIL_LEDGER_ENTRIES = 20;
const USER_NOT_FOUND = "User not found";

/**
 * The back-office view of end users (RNX-357): the list, the detail with the personal data masked, and the audited
 * reveal of one personal field. Deleted users are left out of the list and answer 404 on the detail and the reveal.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly ledger: CreditLedgerEntryRepository,
    private readonly roles: AdminRoleRepository,
    private readonly pii: PiiRevealService,
  ) {}

  /** One page of users (USER_LIST_PAGE_SIZE), newest sign-in first; a page past the end is empty. */
  async list({ page, ...filters }: ListUsersQueryDto): Promise<AdminUserPage> {
    const offset = (page - 1) * USER_LIST_PAGE_SIZE;
    const rows = await this.users.findAdminListRows({ ...filters, limit: USER_LIST_PAGE_SIZE + 1, offset });
    const items = rows.slice(0, USER_LIST_PAGE_SIZE).map(toAdminUserListItem);
    return { page, pageSize: USER_LIST_PAGE_SIZE, hasMore: rows.length > USER_LIST_PAGE_SIZE, items };
  }

  /** One user, personal data masked; the ledger only for an admin whose role holds `credits:read` (null otherwise). */
  async detail(admin: AdminIdentity, userId: string): Promise<AdminUserDetail> {
    const [row] = await this.users.findAdminListRows({ id: userId, limit: 1, offset: 0 });
    const profile = await this.users.findAdminProfile(userId);
    if (!row || !profile) throw new NotFoundException(USER_NOT_FOUND);
    return toAdminUserDetail({ row, profile, ledger: await this.findVisibleLedger(admin, userId) });
  }

  /**
   * One personal field, unmasked, with the audit change (the field and the reason) that the route's hook writes in the
   * request's transaction. 403 unless the admin's role holds `users:read_pii` or the admin is Support with an
   * unexpired grant for this user (`PiiRevealService.canRevealPii`); then 404 for an unknown or deleted user. A field
   * the user has not set is revealed as null.
   */
  async reveal({ admin, userId, body }: UserRevealInput, tx: DbTransaction): Promise<Audited<UserRevealView>> {
    if (!(await this.pii.canRevealPii(admin, userId))) throw new ForbiddenException();
    const user = await this.users.findPiiField(userId, body.field, tx);
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    const target = { userId, field: body.field };
    return {
      result: { field: body.field, value: user[body.field] ?? null },
      change: { before: { ...target, revealed: false }, after: { ...target, revealed: true }, reason: body.reason },
    };
  }

  private async findVisibleLedger(admin: AdminIdentity, userId: string): Promise<LedgerEntryView[] | null> {
    const role = await this.roles.findByName(admin.role);
    if (role?.permissions.includes(CREDITS_READ) !== true) return null;
    return (await this.ledger.findLatestOfUser(userId, DETAIL_LEDGER_ENTRIES)).map(toLedgerEntryView);
  }
}
