import { Global, Module } from "@nestjs/common";
import { AdminAuditLogRepository } from "../admin-auth/repository/admin-audit-log.repository";
import { AdminNotificationRepository } from "../admin-auth/repository/admin-notification.repository";
import { AdminPiiGrantRepository } from "../admin-auth/repository/admin-pii-grant.repository";
import { AdminRecoveryCodeRepository } from "../admin-auth/repository/admin-recovery-code.repository";
import { AdminRoleRepository } from "../admin-auth/repository/admin-role.repository";
import { AdminSessionRepository } from "../admin-auth/repository/admin-session.repository";
import { AdminUserRepository } from "../admin-auth/repository/admin-user.repository";
import { UserRepository } from "../auth/repository/user.repository";
import { SubscriptionPlanRepository } from "../billing/repository/subscription-plan.repository";
import { TransactionRepository } from "../billing/repository/transaction.repository";
import { UserSubscriptionRepository } from "../billing/repository/user-subscription.repository";
import { CodeRedemptionRepository } from "../codes/repository/code-redemption.repository";
import { InvitationCodeRepository } from "../codes/repository/invitation-code.repository";
import { McpOAuthStateRepository } from "../mcp/repository/mcp-oauth-state.repository";
import { CatalogChangeRepository } from "../offers/repository/catalog-change.repository";
import { CompanyContractRepository } from "../offers/repository/company-contract.repository";
import { EnterpriseBundleRepository } from "../offers/repository/enterprise-bundle.repository";
import { PackageRepository } from "../offers/repository/package.repository";
import { PlatformSettingRepository } from "../offers/repository/platform-setting.repository";
import { PurchaseSnapshotRepository } from "../offers/repository/purchase-snapshot.repository";
import { TopUpPackRepository } from "../offers/repository/top-up-pack.repository";
import { AnonymousUsageCounterRepository } from "../portal/repository/anonymous-usage-counter.repository";
import { PortalSessionRepository } from "../portal/repository/portal-session.repository";

const REPOSITORIES = [
  AdminAuditLogRepository,
  AdminNotificationRepository,
  AdminPiiGrantRepository,
  AdminRecoveryCodeRepository,
  AdminRoleRepository,
  AdminSessionRepository,
  AdminUserRepository,
  UserRepository,
  SubscriptionPlanRepository,
  TransactionRepository,
  UserSubscriptionRepository,
  CodeRedemptionRepository,
  InvitationCodeRepository,
  McpOAuthStateRepository,
  CatalogChangeRepository,
  CompanyContractRepository,
  EnterpriseBundleRepository,
  PackageRepository,
  PlatformSettingRepository,
  PurchaseSnapshotRepository,
  TopUpPackRepository,
  AnonymousUsageCounterRepository,
  PortalSessionRepository,
];

/**
 * Every repository of the API, one per table (D100), provided and exported once (D103). A repository file
 * sits in the module that owns its table; a feature module never imports another module to get one.
 * A new repository is added here.
 */
@Global()
@Module({
  providers: REPOSITORIES,
  exports: REPOSITORIES,
})
export class RepositoriesModule {}
