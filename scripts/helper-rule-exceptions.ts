// Exception list of the helper rule check (scripts/check-helper-rule.ts, RX-130, RX-131, AGENTS.md "Helpers").
// Every class method in a service, controller, guard or scheduler of apps/api/src that uses nothing injected
// (no `this`), and every function written outside a class in those files, that still stays where it is is
// listed here with the reason:
//   "test 2: ..."  it talks to the outside (database, network, file) or uses the clock, randomness or the environment
//   "test 3: ..."  it is an entry point (route handler, guard, strategy, interceptor, lifecycle hook, scheduled job)
//   "RX-..."       it passes the rule and that ticket moves or rewrites it
//   "stays: ..."   it passes the rule, but moving it would be a change outside RX-131 (the reason says which)
// Key: "<file> <Class>.<method>" for a method, "<file> <function>" for a function outside a class.
// The check also fails on an entry that matches nothing any more, so remove the entry in the change that
// moves or changes the function. Do not add a helper here to get the check green.
const SRC = "apps/api/src/app";

export const HELPER_RULE_EXCEPTIONS: Record<string, string> = {
  // Entry points (test 3)
  [`${SRC}/auth/controller/better-auth.controller.ts BetterAuthController.handleAuth`]: "test 3: route handler (also test 2: await, process.env)",
  [`${SRC}/agent/controller/agent.controller.ts AgentController.getAvailableTools`]: "test 3: route handler",

  // Outside world, clock, randomness (test 2)
  ["apps/api/src/common/guards/combined-auth.guard.ts CombinedAuthGuard.trySession"]: "test 2: await, network (the Better Auth session lookup)",
  [`${SRC}/codes/service/codes.service.ts CodesService.generateCode`]: "test 2: randomness (crypto.randomBytes)",
  [`${SRC}/knowledge/service/s3.service.ts S3Service.buildKey`]: "test 2: clock (Date.now)",
  [`${SRC}/document/service/document.service.ts DocumentService.resolveBaseName`]: "test 2: clock (Date.now in the fallback name)",
  [`${SRC}/mcp/service/mcp-user.service.ts McpUserService.exchangeGithubCode`]: "test 2: network (fetch)",
  [`${SRC}/mcp/service/mcp-user.service.ts McpUserService.exchangeSlackCode`]: "test 2: network (fetch)",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.validateBraveKey`]: "test 2: network (fetch)",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.searchDuckDuckGo`]: "test 2: network (fetch)",
  [`${SRC}/mcp/service/web-search.service.ts WebSearchService.usageKey`]: "test 2: clock (new Date)",
  [`${SRC}/email/service/email-template.service.ts EmailTemplateService.buildInviteEmail`]: "test 2: environment (toLocaleDateString formats the date in the server's time zone)",

  // Owned by a named ticket
  [`${SRC}/agent/service/agent-run.service.ts AgentRunService.buildMessages`]: "RX-23..25",

  // Functions outside a class
  [`${SRC}/admin-auth/service/admin-session.service.ts newRefreshToken`]: "test 2: randomness (crypto.randomBytes)",
  [`${SRC}/portal/service/portal-tier.service.ts jakartaDay`]: "test 2: clock (`now` defaults to new Date())",
  [`${SRC}/portal/service/portal-tier.service.ts startOfJakartaDay`]: "test 2: clock (`now` defaults to new Date())",
  [`${SRC}/prisma/prisma.service.ts hideByDefault`]: "test 2: database (builds the Prisma client extension that runs inside every read and calls the query)",

  // Pass the rule; moving them needs a decision first (RX-131)
  [`${SRC}/reminder/scheduler/reminder.scheduler.ts ReminderScheduler.isMissingRemindersTableError`]: "stays: it checks a Prisma error class (instanceof Prisma.PrismaClientKnownRequestError), a value import a utils file may not have (AGENTS.md Repositories); RX-139 moves the scheduler's Prisma error handling into its repository (D101)",
  [`${SRC}/app.service.ts AppService.getData`]: "stays: AppService's only method; moving it would empty a class AppController injects, a module change outside RX-131's scope",
  [`${SRC}/memory/service/memory-policy.service.ts MemoryPolicyService.validateMemoryCandidate`]: "stays: MemoryPolicyService's only method; moving it would empty a class MemoryExtractionService injects, a module change outside RX-131's scope",
};
