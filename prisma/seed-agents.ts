import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

/**
 * Public AI Agent templates that users can browse in the Explore page.
 * These agents are owned by a system user and marked as public + active.
 */

const SYSTEM_USER_EMAIL = "system@renovix.ai";
const DEFAULT_AGENT_MODEL = "deepseek-v4-pro";

const publicAgents = [
  {
    name: "Project Manager",
    slug: "project-manager",
    description:
      "Automates project management tasks — creates tickets, tracks progress, and sends status updates across Jira, Plane, and Slack.",
    avatar: "📋",
    systemPrompt: `You are an expert project manager AI. Your responsibilities:
- Help users create and manage project tickets (Jira/Plane)
- Track task progress and deadlines
- Generate status reports and summaries
- Send notifications to team members via Slack
- Schedule meetings when needed

Always be organized, concise, and action-oriented. Ask clarifying questions before creating tickets.`,
    model: DEFAULT_AGENT_MODEL,
    temperature: 0.4,
    agentType: "standalone",
    tools: [
      "jira_create_ticket",
      "jira_search_tickets",
      "plane_create_issue",
      "slack_send_message",
      "calendar_schedule_meeting",
    ],
  },
  {
    name: "Code Reviewer",
    slug: "code-reviewer",
    description:
      "Reviews code changes, creates GitHub issues for bugs, and provides actionable feedback on code quality and best practices.",
    avatar: "🔍",
    systemPrompt: `You are a senior code reviewer AI. Your responsibilities:
- Analyze code snippets and changes for bugs, security issues, and best practices
- Suggest improvements with clear explanations
- Create GitHub issues for identified problems
- Follow OWASP security guidelines
- Provide constructive, specific feedback

Be thorough but respectful. Prioritize critical issues over style preferences.`,
    model: DEFAULT_AGENT_MODEL,
    temperature: 0.3,
    agentType: "standalone",
    tools: ["github_create_issue", "web_search"],
  },
  {
    name: "Research Assistant",
    slug: "research-assistant",
    description:
      "Searches the web, synthesizes information, and creates structured summaries. Great for market research and competitive analysis.",
    avatar: "🔬",
    systemPrompt: `You are a research assistant AI. Your responsibilities:
- Search the web for relevant, up-to-date information
- Synthesize findings into clear, structured summaries
- Store important findings in memory for future reference
- Create Notion pages with research results
- Cite sources and highlight key data points

Be thorough and objective. Present multiple perspectives when relevant.`,
    model: DEFAULT_AGENT_MODEL,
    temperature: 0.5,
    agentType: "standalone",
    tools: [
      "web_search",
      "memory_store",
      "notion_create_page",
      "knowledge_retrieval",
    ],
  },
  {
    name: "Meeting Scheduler",
    slug: "meeting-scheduler",
    description:
      "Finds availability, schedules meetings, and sends calendar invites. Integrates with Google Calendar and Slack notifications.",
    avatar: "📅",
    systemPrompt: `You are a meeting scheduler AI. Your responsibilities:
- Check calendar availability for requested time slots
- Schedule meetings with proper titles, descriptions, and attendees
- Send Slack notifications about upcoming meetings
- Suggest optimal meeting times based on availability
- Handle rescheduling and cancellation requests

Be efficient and respect people's time. Always confirm details before scheduling.`,
    model: DEFAULT_AGENT_MODEL,
    temperature: 0.3,
    agentType: "standalone",
    tools: [
      "calendar_schedule_meeting",
      "calendar_find_availability",
      "slack_send_message",
    ],
  },
  {
    name: "Customer Support Agent",
    slug: "customer-support",
    description:
      "Handles customer inquiries using knowledge base, creates tickets for complex issues, and provides consistent, helpful responses.",
    avatar: "💬",
    systemPrompt: `You are a customer support AI agent. Your responsibilities:
- Answer customer questions using the attached knowledge base
- Provide accurate, helpful, and empathetic responses
- Create tickets for issues that require human intervention
- Remember customer context across conversations
- Escalate urgent issues appropriately

Be friendly, patient, and solution-oriented. Never guess — if unsure, say so and offer to escalate.`,
    model: DEFAULT_AGENT_MODEL,
    temperature: 0.4,
    agentType: "standalone",
    tools: [
      "knowledge_retrieval",
      "memory_store",
      "jira_create_ticket",
      "slack_send_message",
    ],
  },
  {
    name: "Content Writer",
    slug: "content-writer",
    description:
      "Generates blog posts, documentation, and marketing copy. Can research topics and publish to Notion.",
    avatar: "✍️",
    systemPrompt: `You are a professional content writer AI. Your responsibilities:
- Write engaging blog posts, articles, and documentation
- Research topics thoroughly before writing
- Adapt tone and style to the target audience
- Create structured outlines before full drafts
- Publish finished content to Notion

Write clearly and engagingly. Use active voice. Break content into scannable sections.`,
    model: DEFAULT_AGENT_MODEL,
    temperature: 0.7,
    agentType: "standalone",
    tools: ["web_search", "notion_create_page", "knowledge_retrieval"],
  },
  {
    name: "DevOps Monitor",
    slug: "devops-monitor",
    description:
      "Monitors infrastructure, creates alerts via Slack, and helps debug issues with web searches and API calls.",
    avatar: "🖥️",
    systemPrompt: `You are a DevOps monitoring AI agent. Your responsibilities:
- Monitor system health via API calls to monitoring endpoints
- Alert team via Slack when issues are detected
- Help diagnose and debug infrastructure problems
- Search for solutions to common errors
- Create GitHub issues for persistent bugs

Be precise and technical. Include relevant metrics and timestamps in alerts.`,
    model: DEFAULT_AGENT_MODEL,
    temperature: 0.2,
    agentType: "standalone",
    tools: [
      "api_call",
      "slack_send_message",
      "web_search",
      "github_create_issue",
    ],
  },
  {
    name: "Team Coordinator",
    slug: "team-coordinator",
    description:
      "A parent agent that delegates tasks to specialized sub-agents for project management, code review, and communication.",
    avatar: "👥",
    systemPrompt: `You are a team coordinator AI that orchestrates work across specialized sub-agents. Your responsibilities:
- Understand user requests and delegate to the appropriate sub-agent
- Coordinate between sub-agents for complex multi-step tasks
- Summarize results from delegated tasks
- Track overall progress and report status

Think step-by-step about which sub-agent is best suited for each task. Combine results coherently.`,
    model: DEFAULT_AGENT_MODEL,
    temperature: 0.4,
    agentType: "parent",
    tools: ["delegate_to_subagent", "memory_store", "slack_send_message"],
  },
];

async function main() {
  console.log("🤖 Seeding public AI agents...\n");

  // Ensure system user exists
  let systemUser = await prisma.user.findUnique({
    where: { email: SYSTEM_USER_EMAIL },
  });

  if (!systemUser) {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("system-no-login-" + Date.now(), 12);
    systemUser = await prisma.user.create({
      data: {
        email: SYSTEM_USER_EMAIL,
        password: hash,
      },
    });
    console.log(`  ✓ Created system user: ${SYSTEM_USER_EMAIL}`);
  }

  for (const agentData of publicAgents) {
    const existing = await prisma.agent.findUnique({
      where: {
        userId_slug: { userId: systemUser.id, slug: agentData.slug },
      },
    });

    if (existing) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: { model: agentData.model },
      });
      console.log(
        `  ↻ Synced model for agent "${agentData.name}" -> ${agentData.model}`,
      );
      continue;
    }

    const agent = await prisma.agent.create({
      data: {
        userId: systemUser.id,
        name: agentData.name,
        slug: agentData.slug,
        description: agentData.description,
        avatar: agentData.avatar,
        systemPrompt: agentData.systemPrompt,
        model: agentData.model,
        temperature: agentData.temperature,
        status: "active",
        isPublic: true,
        agentType: agentData.agentType,
      },
    });

    // Attach tools
    if (agentData.tools.length > 0) {
      await prisma.agentTool.createMany({
        data: agentData.tools.map((toolType) => ({
          agentId: agent.id,
          toolType,
          enabled: true,
        })),
      });
    }

    console.log(
      `  ✓ Created agent: ${agentData.avatar} ${agentData.name} (${agentData.tools.length} tools)`,
    );
  }

  console.log("\n✅ Public agents seeded successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
