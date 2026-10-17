// Exception list of the Prisma import check (scripts/check-prisma-imports.ts, RX-132, AGENTS.md "Repositories").
// The files of apps/api/src outside a repository and the Prisma module that still import PrismaService or the
// generated Prisma client (an `import type` does not count). A file leaves the list in the change that moves its
// database calls into a repository. The list may only shrink: the check fails on an entry that no longer has
// such an import and on an entry the base branch's list does not have. Never add a file here.
export const PRISMA_IMPORT_EXCEPTIONS: string[] = [
  // RX-134 moved its agent and sub-agent lookups to AgentRepository; the run, message and metering calls stay for RX-23 and RX-25.
  "apps/api/src/app/agent/service/agent-run.service.ts",
  "apps/api/src/app/billing/controller/billing.controller.ts",
  "apps/api/src/app/billing/service/billing.service.ts",
  // The channel chat run path; RX-136 left its 3 calls (sub-agents, history, delegation) for RX-24, which rewrites it.
  "apps/api/src/app/channel/service/channel-chat.service.ts",
  "apps/api/src/app/config/model-registry.service.ts",
  "apps/api/src/app/email/service/email-job.service.ts",
  "apps/api/src/app/guardrail/service/violation-tracker.service.ts",
  "apps/api/src/app/health/controller/health.controller.ts",
  "apps/api/src/app/mcp/service/mcp-user.service.ts",
  "apps/api/src/app/mcp/service/mcp.service.ts",
  "apps/api/src/app/mcp/service/web-search.service.ts",
  "apps/api/src/app/reminder/controller/reminder.controller.ts",
  "apps/api/src/app/reminder/scheduler/reminder.scheduler.ts",
  "apps/api/src/app/reminder/service/reminder.service.ts",
  "apps/api/src/app/usage/service/usage.service.ts",
  "apps/api/src/app/webhooks/controller/webhook.controller.ts",
  "apps/api/src/app/workspace/controller/workspace-channel.controller.ts",
  "apps/api/src/app/workspace/service/workspace-invite.service.ts",
  "apps/api/src/app/workspace/service/workspace-knowledge.service.ts",
  "apps/api/src/app/workspace/service/workspace-member.service.ts",
  "apps/api/src/app/workspace/service/workspace-quota.service.ts",
  "apps/api/src/app/workspace/service/workspace.service.ts",
  "apps/api/src/common/guards/api-key.guard.ts",
  "apps/api/src/lib/auth.ts",
];
