import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const models = [
  // ═══════════════════════════════════════════════════
  // STANDARD TIER
  // ═══════════════════════════════════════════════════
  {
    slug: "deepseek-v4-flash",
    modelName: "DeepSeek V4 Flash",
    provider: "openrouter",
    providerId: "deepseek/deepseek-v4-flash",
    inputPrice: 0.0000000983,
    outputPrice: 0.0000001966,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "tencent-hy3",
    modelName: "Tencent Hy3",
    provider: "openrouter",
    providerId: "tencent/hy3-preview",
    inputPrice: 0.000000063,
    outputPrice: 0.00000021,
    maxTokens: 262144,
    maxOutputTokens: 32768,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "mimo-v2.6-flash",
    modelName: "Xiaomi MiMo V2.6 Flash",
    provider: "openrouter",
    providerId: "xiaomi/mimo-v2.6-flash",
    inputPrice: 0.00000014,
    outputPrice: 0.00000028,
    maxTokens: 1050000,
    maxOutputTokens: 32768,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "deepseek-v3.2",
    modelName: "DeepSeek V3.2",
    provider: "openrouter",
    providerId: "deepseek/deepseek-v3.2",
    inputPrice: 0.0000002288,
    outputPrice: 0.0000003432,
    maxTokens: 131072,
    maxOutputTokens: 32768,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "gemini-3.5-flash-lite",
    modelName: "Gemini 3.5 Flash Lite",
    provider: "openrouter",
    providerId: "google/gemini-3.5-flash-lite",
    inputPrice: 0.0000003,
    outputPrice: 0.0000025,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "standard",
    creditMultiplier: 1,
    planRequired: "free",
  },
  {
    slug: "qwen-3.7-max",
    modelName: "Qwen 3.7 Max",
    provider: "openrouter",
    providerId: "qwen/qwen3.7-max",
    inputPrice: 0.00000125,
    outputPrice: 0.00000375,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "standard",
    creditMultiplier: 2,
    planRequired: "free",
  },

  // ═══════════════════════════════════════════════════
  // PRO TIER
  // ═══════════════════════════════════════════════════
  {
    slug: "deepseek-v4-pro",
    modelName: "DeepSeek V4 Pro",
    provider: "openrouter",
    providerId: "deepseek/deepseek-v4-pro",
    inputPrice: 0.000000435,
    outputPrice: 0.00000087,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "pro",
    creditMultiplier: 3,
    planRequired: "starter",
  },
  {
    slug: "gemini-3.8-flash",
    modelName: "Gemini 3.8 Flash",
    provider: "openrouter",
    providerId: "google/gemini-3.8-flash",
    inputPrice: 0.00000075,
    outputPrice: 0.00000375,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "pro",
    creditMultiplier: 3,
    planRequired: "starter",
  },
  {
    slug: "gemini-3-flash",
    modelName: "Gemini 3 Flash Preview",
    provider: "openrouter",
    providerId: "google/gemini-3-flash-preview",
    inputPrice: 0.0000005,
    outputPrice: 0.000003,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "pro",
    creditMultiplier: 4,
    planRequired: "starter",
  },
  {
    slug: "gemini-3.5-flash",
    modelName: "Gemini 3.5 Flash",
    provider: "openrouter",
    providerId: "google/gemini-3.5-flash",
    inputPrice: 0.0000015,
    outputPrice: 0.000009,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "pro",
    creditMultiplier: 5,
    planRequired: "starter",
  },
  {
    slug: "grok-4.3",
    modelName: "xAI Grok 4.3",
    provider: "openrouter",
    providerId: "x-ai/grok-4.3",
    inputPrice: 0.00000125,
    outputPrice: 0.0000025,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "pro",
    creditMultiplier: 5,
    planRequired: "starter",
  },

  // ═══════════════════════════════════════════════════
  // PREMIUM TIER
  // ═══════════════════════════════════════════════════
  {
    slug: "claude-sonnet-4.6",
    modelName: "Claude Sonnet 4.6",
    provider: "openrouter",
    providerId: "anthropic/claude-sonnet-4.6",
    inputPrice: 0.000003,
    outputPrice: 0.000015,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "premium",
    creditMultiplier: 10,
    planRequired: "pro",
  },
  {
    slug: "gpt-chat-latest",
    modelName: "GPT Chat Latest",
    provider: "openrouter",
    providerId: "openai/gpt-chat-latest",
    inputPrice: 0.000005,
    outputPrice: 0.00003,
    maxTokens: 400000,
    maxOutputTokens: 32768,
    tier: "premium",
    creditMultiplier: 12,
    planRequired: "pro",
  },

  // ═══════════════════════════════════════════════════
  // ULTRA TIER
  // ═══════════════════════════════════════════════════
  {
    slug: "claude-opus-4.7",
    modelName: "Claude Opus 4.7",
    provider: "openrouter",
    providerId: "anthropic/claude-opus-4.7",
    inputPrice: 0.000005,
    outputPrice: 0.000025,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "ultra",
    creditMultiplier: 20,
    planRequired: "enterprise",
  },
  {
    slug: "claude-opus-4.8",
    modelName: "Claude Opus 4.8",
    provider: "openrouter",
    providerId: "anthropic/claude-opus-4.8",
    inputPrice: 0.000005,
    outputPrice: 0.000025,
    maxTokens: 1048576,
    maxOutputTokens: 32768,
    tier: "ultra",
    creditMultiplier: 20,
    planRequired: "enterprise",
  },
  {
    slug: "claude-opus-5.5",
    modelName: "Claude Opus 5.5",
    provider: "openrouter",
    providerId: "anthropic/claude-opus-5.5",
    inputPrice: 0.000004,
    outputPrice: 0.00002,
    maxTokens: 1000000,
    maxOutputTokens: 32768,
    tier: "ultra",
    creditMultiplier: 25,
    planRequired: "enterprise",
  },
];

async function main() {
  console.log("Clearing existing data...");
  await prisma.promptTemplate.deleteMany();
  await prisma.systemPrompt.deleteMany();
  await prisma.appConfig.deleteMany();
  await prisma.aiModel.deleteMany();
  console.log("  ✓ cleared");

  console.log("Seeding models...");
  await prisma.aiModel.createMany({ data: models });
  for (const model of models) {
    console.log(`  ✓ ${model.slug}`);
  }

  console.log("Seeding config...");
  await prisma.appConfig.create({
    data: { key: "markup_multiplier", value: "2" },
  });
  console.log("  ✓ markup_multiplier = 2");

  console.log("Seeding system prompts...");
  await prisma.systemPrompt.create({
    data: {
      name: "default",
      content: `You are Renovix AI, an intelligent AI assistant. Your name is Renovix AI and you were created by the Renovix AI team.

IMPORTANT IDENTITY RULES:
- You MUST always identify yourself as "Renovix AI" when asked who you are, what your name is, or what model you are.
- You are NOT Gemma, LLaMA, Qwen, GPT, or any other base model. You are Renovix AI.
- Never reveal or mention the underlying model, base model, or model architecture you run on.
- If asked about your creator, say you were built by the Renovix AI team.
- If asked about your capabilities, describe them as Renovix AI's capabilities.

BEHAVIOR GUIDELINES:
- Provide clear, concise, and accurate responses.
- Always be professional and helpful.
- If you are unsure about something, say so rather than guessing.`,
      active: true,
      priority: 0,
    },
  });
  console.log("  ✓ default system prompt");

  console.log("Seeding prompt templates...");

  const templates = [
    {
      slug: "identity",
      name: "Identity & Self-Awareness",
      description:
        "Handles questions about the AI's identity, name, creator, and capabilities",
      content: `You are Renovix AI. When answering identity-related questions, follow these rules strictly:
- Your name is Renovix AI. Always introduce yourself as Renovix AI.
- You were created by the Renovix AI team.
- You are an AI assistant designed to help users with a wide range of tasks.
- Do NOT say you are Gemma, LLaMA, Qwen, Mistral, GPT, Claude, or any other model name.
- Do NOT mention Google, Meta, OpenAI, Anthropic, Google DeepMind, or any other AI company as your creator.
- Do NOT describe yourself as "open-weights", "open-source", or reference any base model architecture.
- If asked what model you use or run on, say you are powered by Renovix AI's proprietary technology.
- If asked about your capabilities, describe what you can do (answer questions, write code, analyze data, creative writing, etc.) as Renovix AI's features.
- Keep your identity responses confident and consistent.`,
      keywords: [
        "who are you",
        "what are you",
        "your name",
        "what is your name",
        "introduce yourself",
        "tell me about yourself",
        "what model",
        "which model",
        "what ai",
        "which ai",
        "who made you",
        "who created you",
        "who built you",
        "what can you do",
        "your capabilities",
        "are you gpt",
        "are you chatgpt",
        "are you gemma",
        "are you llama",
        "are you claude",
        "are you gemini",
        "what llm",
        "who developed you",
        "about yourself",
        "siapa kamu",
        "nama kamu",
        "kamu siapa",
        "kamu ai apa",
      ],
      priority: 20,
    },
    {
      slug: "coding",
      name: "Coding Assistant",
      description:
        "Optimized for software development, debugging, and code generation tasks",
      content: `You are an expert software engineer. Follow these guidelines:
- Write clean, maintainable, and well-structured code.
- Follow best practices and established design patterns for the language/framework in use.
- When debugging, analyze the root cause before suggesting fixes.
- Include brief inline comments only where the logic is non-obvious.
- If the user provides code, preserve their style and conventions unless explicitly asked to refactor.
- When generating code, prefer modern syntax and idiomatic approaches.
- Always consider edge cases, error handling, and security implications.
- If multiple approaches exist, briefly explain trade-offs and recommend one.`,
      keywords: [
        "code",
        "coding",
        "programming",
        "debug",
        "debugging",
        "bug",
        "error",
        "function",
        "class",
        "api",
        "endpoint",
        "database",
        "sql",
        "javascript",
        "typescript",
        "python",
        "java",
        "rust",
        "golang",
        "react",
        "vue",
        "angular",
        "nextjs",
        "nest",
        "express",
        "django",
        "flask",
        "html",
        "css",
        "git",
        "deploy",
        "docker",
        "kubernetes",
        "algorithm",
        "data structure",
        "refactor",
        "test",
        "unit test",
        "integration",
        "ci/cd",
        "webpack",
        "vite",
        "npm",
        "yarn",
        "pip",
        "cargo",
        "compiler",
        "runtime",
        "syntax",
        "variable",
        "loop",
        "array",
        "object",
        "promise",
        "async",
        "await",
        "import",
        "export",
        "module",
        "package",
        "library",
        "framework",
        "backend",
        "frontend",
        "fullstack",
        "server",
        "client",
        "restful",
        "graphql",
        "microservice",
        "implement",
        "build",
        "create app",
        "scaffold",
      ],
      priority: 10,
    },
    {
      slug: "research",
      name: "Research Analyst",
      description:
        "Optimized for deep research, analysis, and information synthesis",
      content: `You are a thorough research analyst. Follow these guidelines:
- Provide well-structured, comprehensive answers with clear sections and headings.
- Distinguish between established facts, widely-accepted theories, and speculative claims.
- When presenting information, organize it logically: background → current state → analysis → conclusions.
- Cite specific concepts, frameworks, or methodologies where relevant.
- If the topic is debated, present multiple perspectives fairly before offering analysis.
- Use bullet points and numbered lists to improve readability for complex topics.
- Clearly state any limitations in your knowledge or areas of uncertainty.
- Provide actionable takeaways or recommendations when appropriate.`,
      keywords: [
        "research",
        "study",
        "analysis",
        "analyze",
        "investigate",
        "findings",
        "evidence",
        "data",
        "statistics",
        "survey",
        "paper",
        "journal",
        "academic",
        "scientific",
        "hypothesis",
        "theory",
        "methodology",
        "literature",
        "review",
        "compare",
        "comparison",
        "pros and cons",
        "advantages",
        "disadvantages",
        "impact",
        "effect",
        "cause",
        "trend",
        "market",
        "industry",
        "sector",
        "economics",
        "geopolitics",
        "history",
        "forecast",
        "prediction",
        "report",
        "deep dive",
        "explain in detail",
        "comprehensive",
        "thorough",
      ],
      priority: 10,
    },
    {
      slug: "creative-writing",
      name: "Creative Writer",
      description:
        "Optimized for creative content — stories, copywriting, marketing, brainstorming",
      content: `You are a talented creative writer and content strategist. Follow these guidelines:
- Adapt your tone and style to match the user's request (formal, casual, persuasive, narrative, etc.).
- For storytelling, focus on vivid descriptions, engaging dialogue, and compelling narrative arcs.
- For copywriting and marketing, prioritize clarity, persuasion, and call-to-action.
- When brainstorming, generate diverse and original ideas, then help refine the best ones.
- Maintain consistency in voice, tone, and style throughout a piece.
- Use literary devices (metaphor, rhythm, contrast) when they enhance the writing.
- For content creation, consider the target audience, platform, and purpose.
- Provide multiple variations or options when asked for creative output.`,
      keywords: [
        "write",
        "writing",
        "story",
        "creative",
        "poem",
        "poetry",
        "essay",
        "blog",
        "article",
        "copy",
        "copywriting",
        "marketing",
        "slogan",
        "tagline",
        "headline",
        "script",
        "dialogue",
        "narrative",
        "fiction",
        "novel",
        "character",
        "plot",
        "brainstorm",
        "idea",
        "content",
        "social media",
        "caption",
        "email campaign",
        "newsletter",
        "pitch",
        "proposal",
        "brand voice",
        "tone",
        "rewrite",
        "rephrase",
        "paraphrase",
        "edit my",
        "proofread",
        "grammar",
      ],
      priority: 10,
    },
    {
      slug: "math-logic",
      name: "Math & Logic Solver",
      description:
        "Optimized for mathematics, logic problems, and quantitative reasoning",
      content: `You are an expert mathematician and logical thinker. Follow these guidelines:
- Show your work step-by-step, clearly explaining each stage of the reasoning.
- Use proper mathematical notation and formatting.
- For complex problems, break them into smaller sub-problems first.
- Verify your answer by checking it against the original problem constraints.
- When multiple solution methods exist, choose the most elegant or efficient one.
- Explain the underlying concepts and intuition, not just the mechanical steps.
- For proofs, state assumptions clearly and maintain rigorous logical flow.
- If the problem is ambiguous, state your interpretation before solving.`,
      keywords: [
        "math",
        "mathematics",
        "calculate",
        "equation",
        "formula",
        "algebra",
        "calculus",
        "geometry",
        "statistics",
        "probability",
        "integral",
        "derivative",
        "matrix",
        "vector",
        "proof",
        "theorem",
        "logic",
        "logical",
        "reasoning",
        "solve",
        "solution",
        "compute",
        "number",
        "fraction",
        "percentage",
        "ratio",
        "graph",
        "function",
        "linear",
        "quadratic",
        "polynomial",
        "optimization",
        "combinatorics",
        "discrete",
        "set theory",
        "arithmetic",
      ],
      priority: 10,
    },
    {
      slug: "data-analysis",
      name: "Data Analyst",
      description:
        "Optimized for data analysis, visualization guidance, and insights extraction",
      content: `You are a senior data analyst. Follow these guidelines:
- Help users understand their data through clear explanations and structured analysis.
- Suggest appropriate statistical methods and visualization types for the data at hand.
- When writing queries or data processing code, optimize for readability and performance.
- Explain insights in plain language, not just technical terms.
- Consider data quality issues: missing values, outliers, biases, and sampling problems.
- Recommend appropriate tools and libraries for the task (pandas, SQL, R, Excel, etc.).
- When presenting findings, lead with the most impactful insights.
- Always consider the business context and actionability of the analysis.`,
      keywords: [
        "data",
        "dataset",
        "csv",
        "excel",
        "spreadsheet",
        "pandas",
        "dataframe",
        "visualization",
        "chart",
        "dashboard",
        "metrics",
        "kpi",
        "analytics",
        "insight",
        "sql query",
        "aggregate",
        "group by",
        "join",
        "etl",
        "pipeline",
        "warehouse",
        "bigquery",
        "tableau",
        "power bi",
        "matplotlib",
        "plotly",
        "correlation",
        "regression",
        "clustering",
        "classification",
        "machine learning",
        "ml",
        "model training",
        "feature",
        "prediction",
      ],
      priority: 10,
    },
    {
      slug: "professional-communication",
      name: "Professional Communication",
      description:
        "Optimized for business writing, emails, presentations, and professional documents",
      content: `You are a professional communication specialist. Follow these guidelines:
- Tailor the formality level to the context (C-suite email vs. team Slack message).
- For emails, structure with clear subject line, opening, body, and call-to-action.
- For presentations, focus on key messages, logical flow, and audience engagement.
- Keep language concise and jargon-free unless the audience expects technical terms.
- For documents, use proper structure with headings, executive summaries, and clear conclusions.
- Consider cultural sensitivity and inclusivity in all communications.
- Help with negotiation language, difficult conversations, and diplomatic phrasing.
- For resumes and cover letters, highlight achievements with quantifiable results.`,
      keywords: [
        "email",
        "letter",
        "resume",
        "cv",
        "cover letter",
        "presentation",
        "powerpoint",
        "slides",
        "meeting",
        "memo",
        "report",
        "business",
        "professional",
        "formal",
        "corporate",
        "negotiate",
        "proposal",
        "contract",
        "agreement",
        "linkedin",
        "networking",
        "interview",
        "job application",
        "thank you note",
        "follow up",
        "announcement",
        "press release",
        "stakeholder",
        "executive summary",
        "onboarding",
        "feedback",
        "performance review",
      ],
      priority: 10,
    },
    {
      slug: "education",
      name: "Learning Tutor",
      description:
        "Optimized for teaching, explaining concepts, and tutoring across subjects",
      content: `You are a patient and effective tutor. Follow these guidelines:
- Adjust the explanation complexity to the user's apparent level of understanding.
- Use analogies, examples, and real-world scenarios to make abstract concepts concrete.
- Break complex topics into digestible chunks with a logical learning progression.
- Ask clarifying questions when the user's level or specific needs are unclear.
- Encourage understanding over memorization — explain the "why" behind concepts.
- Use the Socratic method when appropriate: guide users to discover answers themselves.
- Provide practice exercises or thought experiments to reinforce learning.
- Summarize key takeaways at the end of complex explanations.`,
      keywords: [
        "explain",
        "teach",
        "learn",
        "understand",
        "tutorial",
        "lesson",
        "course",
        "study",
        "homework",
        "assignment",
        "exam",
        "quiz",
        "concept",
        "definition",
        "what is",
        "how does",
        "why does",
        "difference between",
        "beginner",
        "introduction",
        "basics",
        "fundamentals",
        "advanced",
        "eli5",
        "simple terms",
        "step by step",
        "guide",
        "practice",
        "exercise",
        "example",
      ],
      priority: 5,
    },
    {
      slug: "translation",
      name: "Language Translator",
      description:
        "Optimized for translation, localization, and multilingual tasks",
      content: `You are a professional translator and linguist. Follow these guidelines:
- Prioritize natural-sounding translations over literal word-for-word conversion.
- Preserve the tone, intent, and cultural nuances of the original text.
- For ambiguous phrases, provide the most contextually appropriate translation and note alternatives.
- When translating technical or domain-specific content, use established terminology.
- Consider localization aspects: date formats, units, idioms, and cultural references.
- If the source text has errors, translate the intended meaning and note the issue.
- For creative content, adapt rather than translate directly to maintain impact.
- Specify the dialect or regional variant when relevant (e.g., Brazilian Portuguese vs. European).`,
      keywords: [
        "translate",
        "translation",
        "language",
        "spanish",
        "french",
        "german",
        "chinese",
        "japanese",
        "korean",
        "arabic",
        "portuguese",
        "italian",
        "russian",
        "hindi",
        "indonesian",
        "malay",
        "thai",
        "vietnamese",
        "dutch",
        "swedish",
        "localize",
        "localization",
        "i18n",
        "multilingual",
        "bilingual",
        "interpret",
        "meaning of",
        "how to say",
        "in english",
        "in spanish",
      ],
      priority: 10,
    },
    {
      slug: "document-pdf",
      name: "Document Generation (PDF)",
      description: "Generates structured documents and converts to PDF",
      outputFormat: "pdf",
      content: `You are a professional document writer. The user wants a well-structured document that will be exported as a PDF file.

Rules:
- Write in clean, structured Markdown
- Use proper heading hierarchy (# for title, ## for sections, ### for subsections)
- Use bullet points and numbered lists where appropriate
- Use bold and italic for emphasis
- Include tables if the content has tabular data
- Write complete, professional-quality content — not placeholders
- Do NOT mention that this will be converted to PDF
- Do NOT wrap the output in code blocks`,
      keywords: [
        "pdf",
        "as pdf",
        "create a pdf",
        "generate a pdf",
        "make a pdf",
        "export as pdf",
        "download as pdf",
        "pdf file",
        "pdf document",
        "create me a pdf",
        "generate pdf",
        "buat pdf",
        "bikin pdf",
        "jadikan pdf",
      ],
      priority: 20,
    },
    {
      slug: "document-docx",
      name: "Document Generation (DOCX)",
      description: "Generates structured documents and converts to Word format",
      outputFormat: "docx",
      content: `You are a professional document writer. The user wants a well-structured document that will be exported as a Word (.docx) file.

Rules:
- Write in clean, structured Markdown
- Use proper heading hierarchy (# for title, ## for sections, ### for subsections)
- Use bullet points and numbered lists where appropriate
- Use bold and italic for emphasis
- Include tables if the content has tabular data
- Write complete, professional-quality content — not placeholders
- Do NOT mention that this will be converted to DOCX
- Do NOT wrap the output in code blocks`,
      keywords: [
        "docx",
        "word document",
        "word doc",
        "as word",
        "create a word",
        "generate a word",
        "make a word document",
        "export as word",
        "download as word",
        "word file",
        ".docx",
        "buat word",
        "bikin word",
        "jadikan word",
      ],
      priority: 20,
    },
    {
      slug: "document-xlsx",
      name: "Document Generation (XLSX)",
      description:
        "Generates structured tabular data and converts to Excel format",
      outputFormat: "xlsx",
      content: `You are a data analyst. The user wants structured tabular data that will be exported as an Excel (.xlsx) file.

Rules:
- Structure your response using Markdown tables
- Use clear column headers
- Keep data organized in rows and columns
- If multiple datasets are needed, use separate tables with headings
- Use numbers, dates, and text appropriately
- Do NOT include long paragraphs — focus on tabular data
- Do NOT mention that this will be converted to Excel
- Do NOT wrap the output in code blocks`,
      keywords: [
        "xlsx",
        "excel",
        "spreadsheet",
        "as excel",
        "create a spreadsheet",
        "generate an excel",
        "make a spreadsheet",
        "export as excel",
        "download as excel",
        "excel file",
        ".xlsx",
        "buat excel",
        "bikin excel",
        "jadikan excel",
      ],
      priority: 20,
    },
  ];

  await prisma.promptTemplate.createMany({ data: templates });
  for (const template of templates) {
    console.log(`  ✓ ${template.slug}`);
  }

  // ─── Seed Subscription Plans ───
  console.log("Seeding subscription plans...");

  const plans = [
    {
      slug: "starter",
      name: "Starter",
      description: "For individuals getting started with AI agents",
      maxAgents: 3,
      maxIntegrations: 1,
      maxWorkspaceUsers: 3,
      maxTokensPerMonth: BigInt(1_000_000),
      allowedChannels: ["web"],
      priceMonthly: 19,
      priceCurrency: "USD",
      displayOrder: 1,
    },
    {
      slug: "pro",
      name: "Pro",
      description: "For professionals and small teams",
      maxAgents: 10,
      maxIntegrations: 3,
      maxWorkspaceUsers: 10,
      maxTokensPerMonth: BigInt(10_000_000),
      allowedChannels: ["web", "api"],
      priceMonthly: 49,
      priceCurrency: "USD",
      displayOrder: 2,
    },
    {
      slug: "enterprise",
      name: "Enterprise",
      description: "For large teams with unlimited needs",
      maxAgents: 999,
      maxIntegrations: 999,
      maxWorkspaceUsers: 100,
      maxTokensPerMonth: BigInt(100_000_000),
      allowedChannels: ["web", "api", "whatsapp"],
      priceMonthly: 149,
      priceCurrency: "USD",
      displayOrder: 3,
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { slug: plan.slug },
      update: plan,
      create: plan,
    });
    console.log(`  ✓ ${plan.slug} plan`);
  }

  // ─── Invitation Codes ───
  console.log("Seeding invitation codes...");

  const starterPlan = await prisma.subscriptionPlan.findUnique({
    where: { slug: "starter" },
  });

  function generateCode(index: number): string {
    const hex = (index + 1).toString(16).toUpperCase().padStart(4, "0");
    const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `PERF-${hex}-${suffix}`;
  }

  const codes = Array.from({ length: 50 }, (_, i) => ({
    code: generateCode(i),
    type: "both",
    creditAmount: 5.0,
    planId: starterPlan?.id ?? null,
    durationDays: 30,
    maxRedemptions: 1,
    timesRedeemed: 0,
    isActive: true,
  }));

  for (const code of codes) {
    await prisma.invitationCode.upsert({
      where: { code: code.code },
      update: {},
      create: code,
    });
  }
  console.log(`  ✓ ${codes.length} invitation codes created`);
  console.log("  Codes:");
  for (const code of codes) {
    console.log(`    ${code.code}`);
  }

  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
