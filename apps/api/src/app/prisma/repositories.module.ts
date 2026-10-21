import { Global, Module } from "@nestjs/common";
import { AdminAuditLogRepository } from "../admin-auth/repository/admin-audit-log.repository";
import { AdminInvitationRepository } from "../admin-auth/repository/admin-invitation.repository";
import { AdminNotificationRepository } from "../admin-auth/repository/admin-notification.repository";
import { AdminPiiGrantRepository } from "../admin-auth/repository/admin-pii-grant.repository";
import { AdminRecoveryCodeRepository } from "../admin-auth/repository/admin-recovery-code.repository";
import { AdminRoleRepository } from "../admin-auth/repository/admin-role.repository";
import { AdminSessionRepository } from "../admin-auth/repository/admin-session.repository";
import { AdminUserRepository } from "../admin-auth/repository/admin-user.repository";
import { ProviderRepository } from "../admin-providers/repository/provider.repository";
import { ProviderKeyCryptoService } from "../admin-providers/service/provider-key-crypto.service";
import { AgentChannelRepository } from "../agent/repository/agent-channel.repository";
import { AgentIntegrationRepository } from "../agent/repository/agent-integration.repository";
import { AgentKnowledgeBaseRepository } from "../agent/repository/agent-knowledge-base.repository";
import { AgentToolRepository } from "../agent/repository/agent-tool.repository";
import { AgentRepository } from "../agent/repository/agent.repository";
import { AiModelRepository } from "../config/repository/ai-model.repository";
import { AppConfigRepository } from "../config/repository/app-config.repository";
import { UserRepository } from "../auth/repository/user.repository";
import { CreditAccountRepository } from "../billing/repository/credit-account.repository";
import { CreditLedgerEntryRepository } from "../billing/repository/credit-ledger-entry.repository";
import { CreditReservationRepository } from "../billing/repository/credit-reservation.repository";
import { SubscriptionPlanRepository } from "../billing/repository/subscription-plan.repository";
import { UserSubscriptionRepository } from "../billing/repository/user-subscription.repository";
import { ChannelAgentRepository } from "../channel/repository/channel-agent.repository";
import { ChannelChatRoomRepository } from "../channel/repository/channel-chat-room.repository";
import { ChannelMessageRepository } from "../channel/repository/channel-message.repository";
import { ChannelRepository } from "../channel/repository/channel.repository";
import { ConversationRepository } from "../chat/repository/conversation.repository";
import { MessageRepository } from "../chat/repository/message.repository";
import { PromptTemplateRepository } from "../chat/repository/prompt-template.repository";
import { SystemPromptRepository } from "../chat/repository/system-prompt.repository";
import { CodeRedemptionRepository } from "../codes/repository/code-redemption.repository";
import { InvitationCodeRepository } from "../codes/repository/invitation-code.repository";
import { ExchangeRateRepository } from "../exchange-rates/repository/exchange-rate.repository";
import { KnowledgeBaseRepository } from "../knowledge/repository/knowledge-base.repository";
import { KnowledgeChunkRepository } from "../knowledge/repository/knowledge-chunk.repository";
import { McpOAuthStateRepository } from "../mcp/repository/mcp-oauth-state.repository";
import { UserMemoryRepository } from "../memory/repository/user-memory.repository";
import { CatalogChangeRepository } from "../offers/repository/catalog-change.repository";
import { CompanyContractRepository } from "../offers/repository/company-contract.repository";
import { EnterpriseBundleRepository } from "../offers/repository/enterprise-bundle.repository";
import { PackageRepository } from "../offers/repository/package.repository";
import { PlatformSettingRepository } from "../offers/repository/platform-setting.repository";
import { PurchaseSnapshotRepository } from "../offers/repository/purchase-snapshot.repository";
import { TopUpPackRepository } from "../offers/repository/top-up-pack.repository";
import { TierRateRepository } from "../offers/repository/tier-rate.repository";
import { AnonymousUsageCounterRepository } from "../portal/repository/anonymous-usage-counter.repository";
import { PortalSessionRepository } from "../portal/repository/portal-session.repository";
import { ReminderRepository } from "../reminder/repository/reminder.repository";
import { WorkspaceMemberRepository } from "../workspace/repository/workspace-member.repository";
import { WorkspaceMemoryRepository } from "../workspace/repository/workspace-memory.repository";
import { WorkspaceRepository } from "../workspace/repository/workspace.repository";

const REPOSITORIES = [
  AdminAuditLogRepository,
  AdminInvitationRepository,
  AdminNotificationRepository,
  AdminPiiGrantRepository,
  AdminRecoveryCodeRepository,
  AdminRoleRepository,
  AdminSessionRepository,
  AdminUserRepository,
  ProviderRepository,
  AgentChannelRepository,
  AgentIntegrationRepository,
  AgentKnowledgeBaseRepository,
  AgentToolRepository,
  AgentRepository,
  AiModelRepository,
  AppConfigRepository,
  UserRepository,
  CreditAccountRepository,
  CreditLedgerEntryRepository,
  CreditReservationRepository,
  SubscriptionPlanRepository,
  UserSubscriptionRepository,
  ChannelAgentRepository,
  ChannelChatRoomRepository,
  ChannelMessageRepository,
  ChannelRepository,
  ConversationRepository,
  MessageRepository,
  PromptTemplateRepository,
  SystemPromptRepository,
  CodeRedemptionRepository,
  InvitationCodeRepository,
  ExchangeRateRepository,
  KnowledgeBaseRepository,
  KnowledgeChunkRepository,
  McpOAuthStateRepository,
  UserMemoryRepository,
  CatalogChangeRepository,
  CompanyContractRepository,
  EnterpriseBundleRepository,
  PackageRepository,
  PlatformSettingRepository,
  PurchaseSnapshotRepository,
  TopUpPackRepository,
  TierRateRepository,
  AnonymousUsageCounterRepository,
  PortalSessionRepository,
  ReminderRepository,
  WorkspaceMemberRepository,
  WorkspaceMemoryRepository,
  WorkspaceRepository,
];

/**
 * Every repository of the API, one per table (D100), provided and exported once (D103). A repository file
 * sits in the module that owns its table; a feature module never imports another module to get one.
 * A new repository is added here.
 */
@Global()
@Module({
  // RX-177: ProviderRepository seals and opens provider keys; the crypto service is provided for it only (not exported).
  providers: [...REPOSITORIES, ProviderKeyCryptoService],
  exports: REPOSITORIES,
})
export class RepositoriesModule {}
