# Agent Notification & Reminder Strategy

## Overview

Enable AI agents to proactively send messages to users based on user-configured reminders. Currently, users always initiate conversations with agents. This feature reverses the flow — agents can initiate messages on a schedule defined by the user.

**Example:** "Give me a summary of my expenses every day at 8:00 AM" → The agent will generate and deliver a fresh expense summary to the user every morning at 8:00 AM.

---

## Architecture

### Core Concept

```
User sets reminder → Stored in DB → Cron evaluates due reminders →
  Agent generates response → Message delivered to user's channel
```

### Data Model (Prisma)

```prisma
model Reminder {
  id            String          @id @default(cuid())
  userId        String
  user          User            @relation(fields: [userId], references: [id])
  agentId       String
  agent         Agent           @relation(fields: [agentId], references: [id])
  channelId     String
  channel       Channel         @relation(fields: [channelId], references: [id])
  chatRoomId    String
  chatRoom      ChannelChatRoom @relation(fields: [chatRoomId], references: [id])

  // Reminder content
  prompt        String          // The instruction/question the agent should execute
  description   String?         // Human-readable label (e.g., "Daily expense summary")

  // Schedule (cron expression)
  cronExpression String         // e.g., "0 8 * * *" for every day at 8 AM
  timezone       String         @default("UTC") // User's timezone (e.g., "Asia/Jakarta")

  // Execution tracking
  nextRunAt     DateTime        // Pre-computed next execution time (indexed for efficient query)
  lastRunAt     DateTime?
  status        ReminderStatus  @default(ACTIVE)

  // Metadata
  createdAt     DateTime        @default(now()) @db.Timestamptz
  updatedAt     DateTime        @updatedAt @db.Timestamptz
  deletedAt     DateTime?       @db.Timestamptz // Soft delete

  @@index([status, nextRunAt])
  @@index([userId])
}

enum ReminderStatus {
  ACTIVE
  PAUSED
  COMPLETED  // For one-time reminders
  FAILED     // Max retries exceeded
}
```

### Why Cron Expression + `nextRunAt`?

- **Cron expression** gives full scheduling flexibility (daily, weekly, weekdays-only, specific hours, etc.)
- **`nextRunAt`** is pre-computed after each execution, enabling a simple indexed query: `WHERE status = 'ACTIVE' AND nextRunAt <= NOW()`
- No need to evaluate every reminder's cron expression on every tick

---

## Module Structure

```
apps/api/src/app/reminder/
├── reminder.module.ts
├── reminder.controller.ts      // CRUD endpoints
├── reminder.service.ts         // Business logic
├── reminder.scheduler.ts       // Cron job to process due reminders
├── reminder.dto.ts             // Validation DTOs
└── reminder-parser.service.ts  // Natural language → cron expression parser
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/reminders` | Create a reminder |
| GET | `/reminders` | List user's reminders |
| GET | `/reminders/:id` | Get reminder details |
| PATCH | `/reminders/:id` | Update reminder (edit prompt, schedule, pause/resume) |
| DELETE | `/reminders/:id` | Soft-delete a reminder |

### Create Reminder DTO

```typescript
class CreateReminderDto {
  agentId: string;
  channelId: string;
  chatRoomId: string;
  prompt: string;              // "Give me a summary of my expenses"
  description?: string;        // "Daily expense summary"
  cronExpression?: string;     // "0 8 * * *" (optional if natural language is provided)
  naturalSchedule?: string;    // "every day at 8:00 AM" (parsed to cron)
  timezone: string;            // "Asia/Jakarta"
}
```

---

## Scheduler Implementation

### Reminder Scheduler (runs every 60 seconds)

```typescript
@Injectable()
export class ReminderScheduler {
  private processing = false;

  @Cron(CronExpression.EVERY_MINUTE)
  async processReminders() {
    if (this.processing) return;
    this.processing = true;

    try {
      // 1. Fetch reminders where nextRunAt <= now AND status = ACTIVE
      const dueReminders = await this.reminderService.getDueReminders();

      // 2. Process each reminder (with concurrency limit)
      for (const reminder of dueReminders) {
        await this.executeReminder(reminder);
      }
    } finally {
      this.processing = false;
    }
  }

  private async executeReminder(reminder: Reminder) {
    // 1. Call the channel chat service as if the agent is responding
    //    to the user's prompt (uses existing chat pipeline)
    // 2. Save the agent's response as a ChannelMessage in the reminder's chatRoom
    // 3. Mark message metadata: { source: 'reminder', reminderId: reminder.id }
    // 4. Compute nextRunAt from cronExpression + timezone
    // 5. Update reminder.lastRunAt and reminder.nextRunAt
  }
}
```

### Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│ Cron (every 60s)                                        │
│   SELECT * FROM reminders                               │
│   WHERE status = 'ACTIVE' AND nextRunAt <= NOW()        │
│   ORDER BY nextRunAt ASC LIMIT 20                       │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│ For each due reminder:                                  │
│   1. Load agent + channel context                       │
│   2. Build system prompt (same as regular chat)         │
│   3. Send reminder.prompt to LLM via ProviderRouter     │
│   4. Execute tool calls if any (full tool loop)         │
│   5. Save response as ChannelMessage                    │
│   6. Compute next run, update DB                        │
│   7. (Optional) Send push notification / email          │
└─────────────────────────────────────────────────────────┘
```

---

## Natural Language Parsing

Users shouldn't need to write cron expressions. The system parses natural language schedules:

| User Input | Cron Expression |
|-----------|----------------|
| "every day at 8:00 AM" | `0 8 * * *` |
| "every Monday at 9:00 AM" | `0 9 * * 1` |
| "every weekday at 6:00 PM" | `0 18 * * 1-5` |
| "every hour" | `0 * * * *` |
| "every 1st of the month at 10 AM" | `0 10 1 * *` |
| "once tomorrow at 7 AM" | One-time (computed absolute time) |

**Implementation options:**
1. Use LLM to parse natural language → cron (leverage existing provider infrastructure)
2. Use a lightweight library like `cronstrue` for validation and `later.js` / custom parser for NL→cron

**Recommended:** Use the AI agent itself to parse the schedule during reminder creation. The agent already understands the user's intent and can extract both the `prompt` and `cronExpression` from a single user message like "remind me to check expenses every day at 8 AM."

---

## Agent-Side Integration (Chat Flow)

When a user says something like "remind me every day at 8 AM about my expenses," the agent should:

1. Detect reminder intent (via a **`create_reminder`** tool)
2. Extract: prompt, schedule, timezone
3. Call the tool to persist the reminder

### New Agent Tool: `create_reminder`

```typescript
{
  name: "create_reminder",
  description: "Create a scheduled reminder that will automatically execute a prompt and send the response to the user at the specified time.",
  parameters: {
    prompt: "The instruction to execute on schedule",
    schedule: "Natural language schedule (e.g., 'every day at 8 AM')",
    description: "Short label for the reminder"
  }
}
```

This means users can create reminders **conversationally** without navigating to a separate UI.

---

## Message Delivery

Since the project uses REST + polling (no WebSocket), agent-initiated messages are delivered by:

1. **In-app (primary):** Message saved to `ChannelMessage` table → user sees it next time they open the chat room (or via polling/refresh)
2. **Push notification (optional future):** Badge/notification that a new message arrived
3. **Email digest (optional future):** Configurable email for important reminders

### Message Metadata

```typescript
// ChannelMessage.metadata (JSONB)
{
  source: "reminder",
  reminderId: "clx...",
  scheduledAt: "2026-05-25T08:00:00Z"
}
```

This allows the frontend to render reminder-triggered messages differently (e.g., with a clock icon or "Scheduled message" badge).

---

## Frontend Changes (Chat App)

1. **Reminder indicator on messages** — Show a "scheduled" badge on agent messages triggered by reminders
2. **Reminder management UI** — List, pause, resume, edit, delete reminders
3. **Polling enhancement** — When user opens a chat room, fetch new messages since last visit (already supported by timestamp-based queries)
4. **Unread count** — Track last-read message per room; show unread badge for agent-initiated messages

---

## Subscription & Rate Limiting

Reminders consume agent message credits like regular messages:

- Each reminder execution counts as 1 message toward `AgentSubscription.messagesUsed`
- If quota exhausted → reminder marked as `PAUSED` with reason, user notified
- Rate limit: Max reminders per user based on subscription tier

| Tier | Max Active Reminders | Min Interval |
|------|---------------------|--------------|
| Free | 3 | 1 hour |
| Pro | 20 | 5 minutes |
| Enterprise | Unlimited | 1 minute |

---

## Error Handling & Reliability

1. **Retry logic:** If LLM call fails, retry up to 3 times with exponential backoff (recompute `nextRunAt` only after success or max retries)
2. **Dead letter:** After 3 consecutive failures, mark reminder as `FAILED` and notify user
3. **Concurrency protection:** `processing` flag prevents overlapping scheduler runs
4. **Batch size limit:** Process max 20 reminders per tick to avoid overwhelming the LLM provider
5. **Idempotency:** Track `lastRunAt` to prevent duplicate executions

---

## Migration Plan

### Phase 1: Core (MVP)
- [ ] Prisma migration: `Reminder` model
- [ ] `reminder` module (CRUD + scheduler)
- [ ] `create_reminder` agent tool
- [ ] Natural language schedule parsing (via LLM)
- [ ] Scheduler executes due reminders and saves messages
- [ ] Frontend: render reminder messages, basic reminder list

### Phase 2: Polish
- [ ] Pause/resume reminders
- [ ] Edit reminder schedule and prompt
- [ ] Unread message count / badge
- [ ] Subscription tier enforcement
- [ ] Timezone-aware UI for schedule display

### Phase 3: Advanced (Future)
- [ ] Email/push notification delivery
- [ ] Reminder templates (pre-built common reminders)
- [ ] Conditional reminders (only send if condition met, e.g., "notify me if expenses exceed $1000")
- [ ] Reminder history / execution log

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `cron-parser` | Parse and compute next execution from cron expressions |
| `cronstrue` | Human-readable cron description for UI display |
| `@nestjs/schedule` | Already installed — cron job infrastructure |

---

## Security Considerations

- Reminders can only be created for agents the user has access to (channel membership check)
- Reminder prompts are sanitized and stored as-is (no code execution)
- Rate limiting prevents abuse (min interval per tier)
- Soft-delete ensures audit trail
- Timezone validation against IANA timezone database

---

## Summary

This feature transforms agents from passive responders into proactive assistants. By reusing the existing chat pipeline (ChannelChatService, ProviderRouter, tool execution), the implementation stays lean — the scheduler simply triggers the same flow that a user message would, but on a schedule.
