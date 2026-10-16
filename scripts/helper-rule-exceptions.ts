// Exception list of the helper rule check (scripts/check-helper-rule.ts, RX-130, AGENTS.md "Helpers").
// Every class method in a service, controller, guard or scheduler of apps/api/src that uses nothing injected
// (no `this`) and still stays in its class is listed here with the reason:
//   "test 2: ..."  it talks to the outside (database, network, file) or uses the clock, randomness or the environment
//   "test 3: ..."  it is an entry point (route handler, guard, strategy, interceptor, lifecycle hook, scheduled job)
//   "RX-..."       it passes the rule and that ticket moves it (RX-131 moves the helpers no other ticket owns)
// Key: "<file> <Class>.<method>". The check also fails on an entry that matches no such method any more,
// so remove the entry in the change that moves or changes the method. Do not add a helper here to get the check green.
const SRC = "apps/api/src/app";

export const HELPER_RULE_EXCEPTIONS: Record<string, string> = {
  // Entry points (test 3)
  [`${SRC}/auth/controller/auth.controller.ts AuthController.logout`]: "test 3: route handler",
  [`${SRC}/auth/controller/better-auth.controller.ts BetterAuthController.handleAuth`]: "test 3: route handler (also test 2: await, process.env)",

  // Outside world, clock, randomness (test 2)
  ["apps/api/src/common/guards/combined-auth.guard.ts CombinedAuthGuard.trySession"]: "test 2: await, network (the Better Auth session lookup)",
  [`${SRC}/auth/service/auth.service.ts AuthService.generateApiKey`]: "test 2: randomness (crypto.randomBytes); RX-18 owns the API key helpers",
  [`${SRC}/codes/service/codes.service.ts CodesService.generateCode`]: "test 2: randomness (crypto.randomBytes)",
  [`${SRC}/knowledge/service/s3.service.ts S3Service.buildKey`]: "test 2: clock (Date.now)",
  [`${SRC}/mcp/service/mcp-user.service.ts McpUserService.exchangeGithubCode`]: "test 2: network (fetch)",
  [`${SRC}/mcp/service/mcp-user.service.ts McpUserService.exchangeSlackCode`]: "test 2: network (fetch)",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.validateBraveKey`]: "test 2: network (fetch)",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.usageKey`]: "test 2: clock (new Date)",

  // Owned by a named ticket
  [`${SRC}/agent/service/agent-tool.service.ts AgentToolService.safeMathEval`]: "RX-55",
  [`${SRC}/auth/service/auth.service.ts AuthService.maskApiKey`]: "RX-18",
  [`${SRC}/agent/service/agent-run.service.ts AgentRunService.getLastUserMessage`]: "RX-23..25 (sub-agent delegation)",
  [`${SRC}/agent/service/agent-run.service.ts AgentRunService.chooseSubAgentForDelegation`]: "RX-23..25 (sub-agent delegation)",
  [`${SRC}/agent/service/agent-run.service.ts AgentRunService.shouldForceDelegation`]: "RX-23..25 (sub-agent delegation)",
  [`${SRC}/agent/service/agent-run.service.ts AgentRunService.buildMessages`]: "RX-23..25",

  // Helpers that RX-131 moves
  [`${SRC}/agent/controller/agent-run.controller.ts AgentRunController.buildDocumentSummary`]: "RX-131",
  [`${SRC}/agent/service/agent-tool.service.ts AgentToolService.executeKnowledgeRetrieval`]: "RX-131 (async stub with no await)",
  [`${SRC}/agent/service/agent.service.ts AgentService.slugify`]: "RX-131",
  [`${SRC}/agent/service/agent.service.ts AgentService.getAvailableTools`]: "RX-131 (async with no await, returns a fixed list)",
  [`${SRC}/app.service.ts AppService.getData`]: "RX-131",
  [`${SRC}/channel/controller/channel.controller.ts ChannelController.buildDocumentSummary`]: "RX-131",
  [`${SRC}/channel/service/channel.service.ts ChannelService.extractDocumentFromMetadata`]: "RX-131",
  [`${SRC}/channel/service/gowa.service.ts GowaService.splitMessage`]: "RX-131",
  [`${SRC}/chat/service/chat.service.ts ChatService.buildDocumentResponseText`]: "RX-131",
  [`${SRC}/chat/service/conversation.service.ts ConversationService.buildFallbackTitle`]: "RX-131",
  [`${SRC}/chat/service/conversation.service.ts ConversationService.normalizeTitle`]: "RX-131",
  [`${SRC}/chat/service/prompt-template.service.ts PromptTemplateService.extractRecentUserMessages`]: "RX-131",
  [`${SRC}/chat/service/prompt-template.service.ts PromptTemplateService.scoreTemplateForText`]: "RX-131",
  [`${SRC}/chat/service/prompt-tuning.service.ts PromptTuningService.formatMemoryContext`]: "RX-131",
  [`${SRC}/document/service/document.service.ts DocumentService.stripKnownExtension`]: "RX-131",
  [`${SRC}/document/service/document.service.ts DocumentService.stripInlineMarkdown`]: "RX-131",
  [`${SRC}/document/service/document.service.ts DocumentService.sanitizeFilename`]: "RX-131",
  [`${SRC}/email/scheduler/email.scheduler.ts EmailScheduler.isRetryableError`]: "RX-131",
  [`${SRC}/email/service/email-template.service.ts EmailTemplateService.buildInviteEmail`]: "RX-131 (to decide there: the date text depends on the server time zone)",
  [`${SRC}/knowledge/service/s3.service.ts S3Service.normalizeDomain`]: "RX-131",
  [`${SRC}/mcp/service/mcp-client.service.ts McpClientService.mcpToolToOpenAI`]: "RX-131",
  [`${SRC}/mcp/service/mcp-registry.service.ts McpRegistryService.isGoogleProvider`]: "RX-131",
  [`${SRC}/mcp/service/mcp-user.service.ts McpUserService.getOAuthProvider`]: "RX-131",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.getSupportedProviders`]: "RX-131",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.getDefaultPolicy`]: "RX-131",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.buildProviderRoute`]: "RX-131",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.isProvider`]: "RX-131",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.clampNumber`]: "RX-131",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.cleanUrl`]: "RX-131",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.extractHostname`]: "RX-131",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.truncate`]: "RX-131",
  [`${SRC}/memory/service/memory-policy.service.ts MemoryPolicyService.validateMemoryCandidate`]: "RX-131 (uses no `this` since RX-130 moved the three checks it calls)",
  [`${SRC}/memory/service/user-memory.service.ts UserMemoryService.hasConflict`]: "RX-131",
  [`${SRC}/portal/controller/portal.controller.ts PortalController.resolveMaxTokens`]: "RX-131",
  [`${SRC}/portal/controller/portal.controller.ts PortalController.extractProviderError`]: "RX-131",
  [`${SRC}/reminder/scheduler/reminder.scheduler.ts ReminderScheduler.isMissingRemindersTableError`]: "RX-131",
  [`${SRC}/workspace/service/workspace-invite.service.ts WorkspaceInviteService.normalizeEmail`]: "RX-131",
  [`${SRC}/workspace/service/workspace.service.ts WorkspaceService.slugify`]: "RX-131",
};
