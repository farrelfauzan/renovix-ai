import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AdminRoleRepository } from "../../admin-auth/repository/admin-role.repository";
import { PiiRevealService } from "../../admin-auth/service/pii-reveal.service";
import type { AdminAuditChange } from "../../admin-auth/types/admin-audit-change";
import type { AdminIdentity } from "../../admin-auth/types/admin-identity";
import type { Audited } from "../../admin-usage/types/audited";
import { ApiKeyRepository } from "../../auth/repository/api-key.repository";
import { SessionRepository } from "../../auth/repository/session.repository";
import { UserRepository } from "../../auth/repository/user.repository";
import { CreditLedgerEntryRepository } from "../../billing/repository/credit-ledger-entry.repository";
import type { DbTransaction } from "../../prisma/db-transaction";
import { USER_LIST_PAGE_SIZE } from "../config/user-list-page-size";
import { USER_SESSION_LIST_LIMIT } from "../config/user-session-list-limit";
import type { ListUsersQueryDto } from "../dto/list-users-query.dto";
import type { AdminUserDetail } from "../types/admin-user-detail";
import type { AdminUserPage } from "../types/admin-user-page";
import type { AdminUserSessionList } from "../types/admin-user-session-list";
import type { LedgerEntryView } from "../types/ledger-entry-view";
import type { RevokedCount } from "../types/revoked-count";
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
const ACTIVE = "active";
const SUSPENDED = "suspended";

/**
 * The back-office view of end users (RNX-357): the list, the detail with the personal data masked, and the audited
 * reveal of one personal field. RNX-100: suspend and reinstate, the API key reset, and the user's sessions (list,
 * revoke one, revoke all); each write runs in the request's audit transaction and returns its audit change. Deleted
 * users are left out of the list and answer 404 on every other route.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly ledger: CreditLedgerEntryRepository,
    private readonly roles: AdminRoleRepository,
    private readonly pii: PiiRevealService,
    private readonly sessions: SessionRepository,
    private readonly keys: ApiKeyRepository,
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

  /**
   * RNX-100: suspends an active user and ends all their sessions. The status change is one conditional UPDATE, so of
   * two concurrent suspensions one passes and the other answers 409. 404 for an unknown or deleted user, 409 when the
   * user is already suspended; nothing changes then.
   */
  async suspend(userId: string, tx: DbTransaction): Promise<AdminAuditChange> {
    if ((await this.users.changeStatus(userId, ACTIVE, SUSPENDED, tx)) === 0) await this.refuseStatusChange(userId, "The user is already suspended", tx);
    const sessionsEnded = await this.sessions.deleteAllOfUser(userId, tx);
    return { before: { userId, status: ACTIVE }, after: { userId, status: SUSPENDED, sessionsEnded } };
  }

  /** RNX-100: lifts a suspension; ended sessions and revoked keys stay so. 404 for an unknown or deleted user, 409 when not suspended. */
  async reinstate(userId: string, tx: DbTransaction): Promise<AdminAuditChange> {
    if ((await this.users.changeStatus(userId, SUSPENDED, ACTIVE, tx)) === 0) await this.refuseStatusChange(userId, "The user is not suspended", tx);
    return { before: { userId, status: SUSPENDED }, after: { userId, status: ACTIVE } };
  }

  /** RNX-100: revokes every unrevoked API key of the user in one UPDATE and answers how many; 404 for an unknown or deleted user. */
  async resetApiKeys(userId: string, tx: DbTransaction): Promise<Audited<RevokedCount>> {
    await this.requireLiveUser(userId, tx);
    const revoked = await this.keys.revokeAllOfUser(userId, new Date(), tx);
    return { result: { revoked }, change: { before: { userId, unrevokedKeys: revoked }, after: { userId, unrevokedKeys: 0 } } };
  }

  /** RNX-100: the user's newest sessions (USER_SESSION_LIST_LIMIT, one query), never a token or IP; 404 for an unknown or deleted user. */
  async listSessions(userId: string): Promise<AdminUserSessionList> {
    await this.requireLiveUser(userId);
    return { sessions: await this.sessions.findLatestOfUser(userId, USER_SESSION_LIST_LIMIT) };
  }

  /** RNX-100: ends one session of the user; 404 for an unknown or deleted user, or a session that is not this user's. */
  async revokeSession(userId: string, sessionId: string, tx: DbTransaction): Promise<AdminAuditChange> {
    await this.requireLiveUser(userId, tx);
    if ((await this.sessions.deleteOfUser(userId, sessionId, tx)) === 0) throw new NotFoundException("Session not found");
    return { before: { userId, sessionId, revoked: false }, after: { userId, sessionId, revoked: true } };
  }

  /** RNX-100: ends every session of the user and answers how many (0 when there was none, audited all the same); 404 for an unknown or deleted user. */
  async revokeAllSessions(userId: string, tx: DbTransaction): Promise<Audited<RevokedCount>> {
    await this.requireLiveUser(userId, tx);
    const revoked = await this.sessions.deleteAllOfUser(userId, tx);
    return { result: { revoked }, change: { before: { userId, sessions: revoked }, after: { userId, sessions: 0 } } };
  }

  private async requireLiveUser(userId: string, tx?: DbTransaction): Promise<void> {
    if (!(await this.users.findLiveStatus(userId, tx))) throw new NotFoundException(USER_NOT_FOUND);
  }

  private async refuseStatusChange(userId: string, conflict: string, tx: DbTransaction): Promise<never> {
    await this.requireLiveUser(userId, tx);
    throw new ConflictException(conflict);
  }

  private async findVisibleLedger(admin: AdminIdentity, userId: string): Promise<LedgerEntryView[] | null> {
    const role = await this.roles.findByName(admin.role);
    if (role?.permissions.includes(CREDITS_READ) !== true) return null;
    return (await this.ledger.findLatestOfUser(userId, DETAIL_LEDGER_ENTRIES)).map(toLedgerEntryView);
  }
}
