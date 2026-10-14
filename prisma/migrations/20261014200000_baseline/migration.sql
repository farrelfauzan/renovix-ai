-- RX-90: baseline for the fresh start (D49, D82). Generated with
--   prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
-- and replaces the whole earlier history (no production database exists, D49).
-- No plans, offers, prices or limits are inserted here: they come only from the catalog seed (RX-86).
-- The one INSERT kept is RX-96's five built-in back-office roles (reference data for permissions,
-- not business data), unchanged; the test helper seedAdminRoles runs this same statement.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "password" TEXT,
    "name" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "avatar" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "job_title" TEXT,
    "timezone" TEXT DEFAULT 'UTC',
    "locale" TEXT DEFAULT 'en',
    "apiKey" TEXT NOT NULL,
    "last_login_at" TIMESTAMPTZ,
    "last_login_ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "balance" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cost" DECIMAL(12,6) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,6) NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openrouter',
    "provider_id" TEXT NOT NULL,
    "input_price" DECIMAL(18,12) NOT NULL,
    "output_price" DECIMAL(18,12) NOT NULL,
    "max_tokens" INTEGER NOT NULL,
    "max_output_tokens" INTEGER,
    "tier" TEXT NOT NULL DEFAULT 'standard',
    "credit_multiplier" DECIMAL(6,2) NOT NULL DEFAULT 1.0,
    "plan_required" TEXT NOT NULL DEFAULT 'free',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "app_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_prompts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "keywords" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "output_format" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "document_format" TEXT,
    "document_filename" TEXT,
    "document_key" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "workspace_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "embedding" vector(1024),
    "tokenCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userId" TEXT,
    "lastRequestAt" TIMESTAMPTZ,
    "lastResetAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anonymous_usage_counters" (
    "bucket" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "anonymous_usage_counters_pkey" PRIMARY KEY ("bucket","day")
);

-- CreateTable
CREATE TABLE "user_memories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "source_message_id" TEXT,
    "source_conversation_id" TEXT,
    "lastConfirmedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ,
    "is_user_pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parent_agent_id" TEXT,
    "workspace_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "avatar" TEXT,
    "avatar_color" TEXT DEFAULT '#6366f1',
    "system_prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "max_tokens" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "agent_type" TEXT NOT NULL DEFAULT 'standalone',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_integrations" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'connected',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agent_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tools" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tool_type" TEXT NOT NULL,
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_knowledge_bases" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "knowledge_base_id" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_channels" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "config" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agent_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "external_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "tool_result" JSONB,
    "tokens" INTEGER,
    "cost" DECIMAL(12,6),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "max_agents" INTEGER NOT NULL,
    "max_integrations" INTEGER NOT NULL,
    "max_workspace_users" INTEGER NOT NULL,
    "max_tokens_per_month" BIGINT NOT NULL,
    "allowed_channels" TEXT[],
    "price_monthly" DECIMAL(10,2),
    "price_currency" TEXT NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_period_start" TIMESTAMPTZ NOT NULL,
    "current_period_end" TIMESTAMPTZ NOT NULL,
    "messages_used" INTEGER NOT NULL DEFAULT 0,
    "tokens_used" BIGINT NOT NULL DEFAULT 0,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "credit_amount" DECIMAL(12,6),
    "plan_id" TEXT,
    "duration_days" INTEGER,
    "max_redemptions" INTEGER NOT NULL DEFAULT 1,
    "times_redeemed" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + '2 mons'::interval),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invitation_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_redemptions" (
    "id" TEXT NOT NULL,
    "code_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credits_granted" DECIMAL(12,6),
    "plan_granted" TEXT,
    "days_granted" INTEGER,
    "redeemed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ,
    "scope" TEXT,
    "id_token" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT DEFAULT '#6366f1',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_agents" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_chat_rooms" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'general',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "channel_chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_messages" (
    "id" TEXT NOT NULL,
    "chat_room_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokens" INTEGER,
    "cost" DECIMAL(12,6),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "avatar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "accepted_by_id" TEXT,
    "accepted_at" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_memories" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "source_run_id" TEXT,
    "created_by_id" TEXT,
    "last_confirmed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "workspace_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ,
    "next_attempt_at" TIMESTAMPTZ,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mcp_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "env_encrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "connected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_mcp_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardrail_violations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "input" TEXT,
    "output" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardrail_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardrail_configs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT,
    "enable_input_filter" BOOLEAN NOT NULL DEFAULT true,
    "enable_output_filter" BOOLEAN NOT NULL DEFAULT true,
    "enable_pii_masking" BOOLEAN NOT NULL DEFAULT false,
    "enable_injection_check" BOOLEAN NOT NULL DEFAULT true,
    "toxicity_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "max_response_length" INTEGER NOT NULL DEFAULT 16000,
    "blocked_topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "guardrail_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "chat_room_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "description" TEXT,
    "cron_expression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "next_run_at" TIMESTAMPTZ NOT NULL,
    "last_run_at" TIMESTAMPTZ,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "totp_secret_encrypted" TEXT,
    "totp_enrolled_at" TIMESTAMPTZ,
    "last_accepted_time_step" INTEGER,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_pii_grants" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "subject_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_by_admin_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_pii_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_recovery_codes" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "used_refresh_token_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ NOT NULL,
    "last_reauth_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" TEXT NOT NULL,
    "recipient_role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject_admin_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_apiKey_key" ON "users"("apiKey");

-- CreateIndex
CREATE INDEX "usage_logs_userId_idx" ON "usage_logs"("userId");

-- CreateIndex
CREATE INDEX "usage_logs_createdAt_idx" ON "usage_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE INDEX "transactions_userId_idx" ON "transactions"("userId");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_slug_key" ON "ai_models"("slug");

-- CreateIndex
CREATE INDEX "ai_models_tier_idx" ON "ai_models"("tier");

-- CreateIndex
CREATE INDEX "ai_models_active_tier_idx" ON "ai_models"("active", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "app_configs_key_key" ON "app_configs"("key");

-- CreateIndex
CREATE UNIQUE INDEX "system_prompts_name_key" ON "system_prompts"("name");

-- CreateIndex
CREATE INDEX "system_prompts_active_idx" ON "system_prompts"("active");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_slug_key" ON "prompt_templates"("slug");

-- CreateIndex
CREATE INDEX "prompt_templates_active_idx" ON "prompt_templates"("active");

-- CreateIndex
CREATE INDEX "conversations_userId_idx" ON "conversations"("userId");

-- CreateIndex
CREATE INDEX "conversations_updatedAt_idx" ON "conversations"("updatedAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_idx" ON "messages"("conversationId");

-- CreateIndex
CREATE INDEX "knowledge_bases_userId_idx" ON "knowledge_bases"("userId");

-- CreateIndex
CREATE INDEX "knowledge_bases_workspace_id_idx" ON "knowledge_bases"("workspace_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_knowledgeBaseId_idx" ON "knowledge_chunks"("knowledgeBaseId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_sessionToken_key" ON "portal_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "portal_sessions_userId_idx" ON "portal_sessions"("userId");

-- CreateIndex
CREATE INDEX "portal_sessions_lastResetAt_idx" ON "portal_sessions"("lastResetAt");

-- CreateIndex
CREATE INDEX "portal_sessions_ipAddress_idx" ON "portal_sessions"("ipAddress");

-- CreateIndex
CREATE INDEX "user_memories_userId_status_idx" ON "user_memories"("userId", "status");

-- CreateIndex
CREATE INDEX "user_memories_userId_type_idx" ON "user_memories"("userId", "type");

-- CreateIndex
CREATE INDEX "agents_userId_status_idx" ON "agents"("userId", "status");

-- CreateIndex
CREATE INDEX "agents_parent_agent_id_idx" ON "agents"("parent_agent_id");

-- CreateIndex
CREATE INDEX "agents_is_public_idx" ON "agents"("is_public");

-- CreateIndex
CREATE INDEX "agents_workspace_id_status_idx" ON "agents"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agents_userId_slug_key" ON "agents"("userId", "slug");

-- CreateIndex
CREATE INDEX "agent_integrations_agentId_idx" ON "agent_integrations"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_integrations_agentId_provider_key" ON "agent_integrations"("agentId", "provider");

-- CreateIndex
CREATE INDEX "agent_tools_agentId_idx" ON "agent_tools"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_knowledge_bases_agentId_knowledge_base_id_key" ON "agent_knowledge_bases"("agentId", "knowledge_base_id");

-- CreateIndex
CREATE INDEX "agent_channels_channel_type_status_idx" ON "agent_channels"("channel_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_channels_agentId_channel_type_key" ON "agent_channels"("agentId", "channel_type");

-- CreateIndex
CREATE INDEX "agent_runs_agentId_idx" ON "agent_runs"("agentId");

-- CreateIndex
CREATE INDEX "agent_runs_session_id_idx" ON "agent_runs"("session_id");

-- CreateIndex
CREATE INDEX "agent_runs_external_user_id_idx" ON "agent_runs"("external_user_id");

-- CreateIndex
CREATE INDEX "agent_messages_run_id_idx" ON "agent_messages"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_slug_key" ON "subscription_plans"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "user_subscriptions_user_id_key" ON "user_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "user_subscriptions_user_id_status_idx" ON "user_subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "user_subscriptions_plan_id_idx" ON "user_subscriptions"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_codes_code_key" ON "invitation_codes"("code");

-- CreateIndex
CREATE INDEX "invitation_codes_code_idx" ON "invitation_codes"("code");

-- CreateIndex
CREATE INDEX "invitation_codes_is_active_expires_at_idx" ON "invitation_codes"("is_active", "expires_at");

-- CreateIndex
CREATE INDEX "code_redemptions_user_id_idx" ON "code_redemptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "code_redemptions_code_id_user_id_key" ON "code_redemptions"("code_id", "user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "channels_userId_idx" ON "channels"("userId");

-- CreateIndex
CREATE INDEX "channel_agents_channel_id_idx" ON "channel_agents"("channel_id");

-- CreateIndex
CREATE INDEX "channel_agents_agent_id_idx" ON "channel_agents"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_agents_channel_id_agent_id_key" ON "channel_agents"("channel_id", "agent_id");

-- CreateIndex
CREATE INDEX "channel_chat_rooms_channel_id_idx" ON "channel_chat_rooms"("channel_id");

-- CreateIndex
CREATE INDEX "channel_messages_chat_room_id_idx" ON "channel_messages"("chat_room_id");

-- CreateIndex
CREATE INDEX "channel_messages_agent_id_idx" ON "channel_messages"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_channel_id_key" ON "workspaces"("channel_id");

-- CreateIndex
CREATE INDEX "workspaces_owner_id_status_idx" ON "workspaces"("owner_id", "status");

-- CreateIndex
CREATE INDEX "workspaces_channel_id_idx" ON "workspaces"("channel_id");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_status_idx" ON "workspace_members"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_status_idx" ON "workspace_members"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_token_hash_key" ON "workspace_invites"("token_hash");

-- CreateIndex
CREATE INDEX "workspace_invites_workspace_id_status_idx" ON "workspace_invites"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "workspace_invites_email_normalized_status_idx" ON "workspace_invites"("email_normalized", "status");

-- CreateIndex
CREATE INDEX "workspace_memories_workspace_id_status_idx" ON "workspace_memories"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "workspace_memories_workspace_id_type_idx" ON "workspace_memories"("workspace_id", "type");

-- CreateIndex
CREATE INDEX "email_jobs_status_next_attempt_at_idx" ON "email_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "user_mcp_credentials_user_id_workspace_id_idx" ON "user_mcp_credentials"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "user_mcp_credentials_workspace_id_provider_idx" ON "user_mcp_credentials"("workspace_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "user_mcp_credentials_user_id_workspace_id_provider_key" ON "user_mcp_credentials"("user_id", "workspace_id", "provider");

-- CreateIndex
CREATE INDEX "guardrail_violations_user_id_createdAt_idx" ON "guardrail_violations"("user_id", "createdAt");

-- CreateIndex
CREATE INDEX "guardrail_violations_type_createdAt_idx" ON "guardrail_violations"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "guardrail_configs_agent_id_key" ON "guardrail_configs"("agent_id");

-- CreateIndex
CREATE INDEX "reminders_status_next_run_at_idx" ON "reminders"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "reminders_user_id_idx" ON "reminders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_role_idx" ON "admin_users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "admin_roles_name_key" ON "admin_roles"("name");

-- CreateIndex
CREATE INDEX "admin_pii_grants_admin_id_subject_user_id_expires_at_idx" ON "admin_pii_grants"("admin_id", "subject_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "admin_pii_grants_granted_by_admin_id_idx" ON "admin_pii_grants"("granted_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_recovery_codes_admin_id_code_hash_key" ON "admin_recovery_codes"("admin_id", "code_hash");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "admin_notifications_subject_admin_id_idx" ON "admin_notifications"("subject_admin_id");

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_agent_id_fkey" FOREIGN KEY ("parent_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_integrations" ADD CONSTRAINT "agent_integrations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_channels" ADD CONSTRAINT "agent_channels_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_codes" ADD CONSTRAINT "invitation_codes_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "invitation_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_agents" ADD CONSTRAINT "channel_agents_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_agents" ADD CONSTRAINT "channel_agents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_chat_rooms" ADD CONSTRAINT "channel_chat_rooms_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "channel_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_memories" ADD CONSTRAINT "workspace_memories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mcp_credentials" ADD CONSTRAINT "user_mcp_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mcp_credentials" ADD CONSTRAINT "user_mcp_credentials_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_violations" ADD CONSTRAINT "guardrail_violations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_violations" ADD CONSTRAINT "guardrail_violations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_configs" ADD CONSTRAINT "guardrail_configs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_chat_room_id_fkey" FOREIGN KEY ("chat_room_id") REFERENCES "channel_chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_fkey" FOREIGN KEY ("role") REFERENCES "admin_roles"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_pii_grants" ADD CONSTRAINT "admin_pii_grants_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_pii_grants" ADD CONSTRAINT "admin_pii_grants_granted_by_admin_id_fkey" FOREIGN KEY ("granted_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notifications" ADD CONSTRAINT "admin_notifications_subject_admin_id_fkey" FOREIGN KEY ("subject_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kept from the earlier history (20260530000000_auth_subscription_overhaul): Prisma ignores
-- nullability on list columns, so the generated script above leaves this one nullable.
ALTER TABLE "subscription_plans" ALTER COLUMN "allowed_channels" SET NOT NULL;

-- Seed the built-in roles (PRD 09 F5). ON CONFLICT: the test factory runs this same statement again.
INSERT INTO "admin_roles" ("id", "name", "built_in", "permissions", "updated_at") VALUES
  (gen_random_uuid()::text, 'owner', true, ARRAY[
    'users:read', 'users:read_pii', 'users:write',
    'companies:read', 'companies:write',
    'enterprise_requests:read', 'enterprise_requests:write',
    'guardrails:read', 'guardrails:read_content', 'guardrails:write',
    'models:read', 'models:write',
    'providers:read', 'providers:write',
    'packages:read', 'packages:write',
    'credits:read', 'credits:adjust',
    'usage:read', 'exports:create', 'support_notes:write',
    'admins:read', 'admins:write',
    'roles:read', 'roles:write',
    'settings:read', 'settings:write'
  ]::text[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'operations', true, ARRAY[
    'users:read', 'users:read_pii', 'users:write',
    'companies:read', 'companies:write',
    'enterprise_requests:read', 'enterprise_requests:write',
    'guardrails:read', 'guardrails:write',
    'models:read', 'models:write'
  ]::text[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'finance', true, ARRAY[
    'packages:read', 'packages:write',
    'credits:read', 'credits:adjust',
    'usage:read', 'exports:create',
    'users:read', 'companies:read', 'enterprise_requests:read', 'guardrails:read',
    'models:read', 'providers:read', 'admins:read', 'roles:read', 'settings:read'
  ]::text[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'support', true, ARRAY[
    'users:read', 'companies:read', 'support_notes:write'
  ]::text[], CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'viewer', true, ARRAY[
    'users:read', 'companies:read', 'enterprise_requests:read', 'guardrails:read',
    'models:read', 'providers:read', 'packages:read', 'credits:read', 'usage:read',
    'admins:read', 'roles:read', 'settings:read'
  ]::text[], CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
