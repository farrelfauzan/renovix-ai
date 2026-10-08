# Chat Memory Sharing Strategy (Renovix AI)

## Objective

Build a memory-sharing layer on top of chat history so Renovix AI can remember user interests and preferences across sessions, while keeping users comfortable through clear control, transparency, and privacy safeguards.

Memory usage is automatic by design: the backend processes, retrieves, and injects relevant memory context across sessions without a per-chat frontend toggle.

## Success Criteria

1. Renovix AI remembers stable user interests (for example: domains, preferred response tone, recurring goals) across conversations.
2. Users can see, edit, and delete what the AI remembers.
3. Memory improves response relevance without causing privacy discomfort.
4. Memory behavior is deterministic, auditable, and safe by default.

## Problem Statement

Current chat history stores conversation messages, but memory is not shared as a structured profile between chats. This leads to repetitive user explanations and lower comfort.

## Strategy Overview

Create a two-layer memory system:

- Layer 1: Short-term memory
  - Source: active conversation messages.
  - Scope: current conversation continuity.
  - Lifetime: conversation-bound.

- Layer 2: Long-term shared memory
  - Source: extracted facts from historical conversations.
  - Scope: user-level profile across all conversations.
  - Lifetime: persistent with expiry and confidence decay.

At request time, Renovix AI uses:

1. Active conversation context.
2. Retrieved long-term user memory relevant to current query.
3. Existing system knowledge and (optionally) user KB chunks.

### History Window Policy

- Memory processing is capped to the latest 5 qualifying conversations per user.
- Older conversations are excluded from automatic memory extraction.
- Exception: pinned or explicitly user-confirmed memory can stay active beyond the 5-conversation window.

#### What counts as a qualifying conversation

- Must have at least 2 user messages (a single "Hi" does not count).
- Must belong to a paid user (free-tier sessions are excluded entirely).
- Deleted conversations are excluded from the window; the system backfills the next oldest qualifying conversation to maintain 5.
- If a user has fewer than 5 qualifying conversations, process all of them.

### Eligibility

- Memory is available only for users who have topped up at least once (`User.balance > 0` at any point in history).
- Free-tier users (no account or never topped up) have no memory extraction, storage, or retrieval.
- If a paid user's balance drops to zero, existing memories are retained and recalled but no new extraction occurs until the next top-up.

## Memory Model

### Memory Types

- Interest Memory
  - Examples: "User focuses on fintech", "Interested in product strategy".
- Preference Memory
  - Examples: "Prefers concise answers", "Wants implementation-first guidance".
- Identity/Context Memory (non-sensitive)
  - Examples: role, project type, preferred stack.
- Exclusion Memory
  - Examples: "Do not store personal health details".

### Memory Record Shape

Each memory item should contain:

- `id`
- `user_id`
- `type` (`interest | preference | context | exclusion`)
- `content` (normalized text)
- `confidence` (`0.0 - 1.0`)
- `source_message_id`
- `source_conversation_id`
- `last_confirmed_at`
- `expires_at` (nullable)
- `is_user_pinned`
- `status` (`active | archived | deleted`)

### Write Rules (Important)

- Only store high-signal information (explicit user statements or repeated behavior).
- Never auto-store secrets, credentials, financial identifiers, health data, or legal-sensitive data.
- Use deduplication and merge similar memories.
- Apply confidence decay if not reconfirmed over time.
- Require user confirmation for low-confidence or potentially sensitive memories.

## Retrieval and Prompt Injection

### Retrieval Pipeline

1. Build query embedding from latest user message.
2. Retrieve top relevant active memories for the same user.
3. Re-rank with recency + confidence.
4. Apply policy filter (exclude sensitive/blocked items).
5. Inject concise memory summary into prompt-tuning flow.

### Prompt Section Contract

Inject memory as a separate section to avoid contamination:

```text
[User Memory Context]
- Interests: ...
- Preferences: ...
- Ongoing goals: ...
- Do-not-assume notes: ...
```

This should be appended alongside existing system KB context in `PromptTuningService`.

### Token Budget and Priority Order

The prompt has a finite context window. Memory must not crowd out existing context. Use a fixed priority and budget:

| Priority | Section                  | Max tokens | Notes                                  |
|----------|--------------------------|------------|----------------------------------------|
| 1        | Base system prompt       | 500        | Non-negotiable, always injected        |
| 2        | Template / mode prompt   | 300        | Only when intent-matched               |
| 3        | System knowledge (RAG)   | 1500       | Top chunks by similarity               |
| 4        | User knowledge base      | 1000       | Top chunks, similarity > 0.3           |
| 5        | User memory context      | 400        | Max 8 items, compressed summary format |

- Total injected context must not exceed 3700 tokens (leaves room for conversation messages within model context limit).
- If total exceeds budget, trim from lowest priority first (user memory → user KB → system KB).
- Memory items are formatted as compressed single-line bullets to minimize token usage.
- Token counts are estimated using chars / 4; exact counts are not required at injection time.

## Handling Irrelevant Chat as Memory

Not every chat message should become long-term memory. Use a strict candidate filter pipeline:

1. Candidate extraction
  - Extract only explicit candidate facts from user messages.
  - Ignore assistant-only statements as memory source unless user confirms them.
2. Relevance scoring
  - Score each candidate by weighted signals:
    - explicitness (did user clearly state a preference/interest)
    - repeat count (seen across turns or conversations)
    - stability (likely long-term vs one-time)
    - actionability (helps improve future responses)
3. Hard exclusions
  - Drop small talk, greetings, jokes, emotional filler, and one-off operational details.
  - Drop transient details with short utility window unless user pins them.
4. History window gate
  - Only evaluate candidate memory from the latest 5 conversations for automatic processing.
  - Keep pinned or explicitly confirmed memory even if the source conversation is older.
5. Safety and sensitivity gate
  - Apply redaction and policy checks before any write.
6. Confidence thresholding
  - `score < 0.55`: discard
  - `0.55 <= score < 0.75`: keep as pending candidate (not injected)
  - `score >= 0.75`: store as active memory
7. User correction loop
  - If user deletes/corrects memory, reduce similar-candidate score in future.

### Practical Examples

- Should be stored:
  - "I prefer concise answers with code first."
  - "I am building a fintech dashboard with Next.js and NestJS."
- Should not be stored:
  - "Hi"
  - "Tell me a joke"
  - "Today I am just testing this prompt"

## How Memory Is Called Back in a New Session

When a user starts a new chat session, memory recall should happen in a deterministic flow:

1. Session initialization
  - Resolve user identity from portal JWT.
  - Load pinned memories and recent active memories (lightweight cache) produced from latest 5-conversation window.
2. First user message arrives
  - Generate embedding for the message.
  - Retrieve top-K relevant memories for that user only.
3. Re-ranking and policy filter
  - Re-rank by semantic similarity + confidence + recency.
  - Remove expired, archived, low-confidence, or policy-blocked items.
4. Prompt composition
  - Inject selected memories into `[User Memory Context]` block.
  - Keep token budget capped so memory does not dominate the prompt.
5. Response generation
  - Model responds using current message + retrieved user memory + system context.
6. Post-response update
  - Queue lightweight extraction job (not blocking the SSE stream).
  - Update memory records and enforce latest 5-conversation processing window for future sessions.

### Latency Budget for First Message

Memory retrieval adds overhead on the first message of a new session. Manage it:

- Target: memory retrieval must add less than 150ms to first-message latency.
- Preload: on session init (JWT resolution), start loading pinned + recent active memories into an in-memory cache before the first message arrives.
- Skip embedding when possible: if user has fewer than 10 active memories, return all and filter in application code instead of doing a vector search.
- Timeout: if memory retrieval exceeds 300ms, proceed without memory context and inject it on the second message instead.
- Monitor: track p50 and p95 memory retrieval latency as a dashboard metric.

### New Session Retrieval Contract

- If no relevant memory is found, continue with normal chat behavior.
- If memory confidence is borderline, ask a short confirmation question instead of assuming.
- Memory retrieval is automatic in every new session after rollout policy is enabled.

## User Experience and Comfort Controls

### Transparency

- Add a "What Renovix remembers" panel in chat UI.
- Show memory entries with source and last-updated date.

### Control

- Per-memory actions: keep, edit, delete, pin.
- Global actions: clear all memories and export memory.
- No per-chat toggle in frontend; memory is processed automatically in backend.

### Consent

- Default mode recommendation: opt-in on first rollout.
- Explain in plain language what is stored and why.

## Backend Design (High-Level)

### New Services

- `UserMemoryService`
  - create/update/delete/list/retrieve/re-rank memories.
- `MemoryExtractionService`
  - converts chat messages into candidate memory facts.
- `MemoryPolicyService`
  - sensitivity checks, allow/deny logic, confidence thresholding.

### Integration Points

- After assistant response is saved in conversation flow:
  - run extraction job for newly completed user-assistant turn.
- During `PromptTuningService.applyTuning(...)`:
  - retrieve relevant user memory and inject structured summary.

### Suggested API Endpoints (Portal)

- `GET /api/v1/chat/portal/memory`
- `PATCH /api/v1/chat/portal/memory/:id`
- `DELETE /api/v1/chat/portal/memory/:id`
- `POST /api/v1/chat/portal/memory/clear`

## Data and Security Policy

- Encrypt sensitive columns at rest when possible.
- Strict user ownership checks on every memory operation.
- Soft-delete by default with configurable retention window.
- Audit logs for memory create/update/delete and prompt injection events.
- Redaction layer before memory write (emails, phone numbers, keys, account IDs).

## Rollout Plan

### Phase 1: Foundation (Safe Read-Only)

- Add schema and service layer.
- Build extraction pipeline but do not inject into prompts yet.
- Expose memory list UI as read-only preview for internal testing.

### Phase 2: Controlled Injection

- Enable prompt injection for internal users only.
- Limit to `interest` and `preference` memory types.
- Add confidence threshold and safety filters.

### Phase 3: User Controls + Opt-In

- Launch memory panel with review/edit/delete/pin controls.
- Roll out to a small percentage of users with explicit opt-in.

### Phase 4: General Availability

- Expand rollout.
- Add analytics-driven tuning for precision and comfort.

## Metrics

- Relevance lift: lower rate of repeated user clarification.
- Comfort score: memory-related thumbs up/down and feedback.
- Safety score: blocked sensitive-memory write attempts.
- Retention proxy: repeat chat sessions per user.
- Precision: percentage of memory entries users keep vs delete.

## Risks and Mitigations

- Over-personalization risk
  - Mitigation: conservative thresholds, capped memory token budget, and confidence checks.
- Wrong memory inference
  - Mitigation: confidence, source traceability, easy edit/delete.
- Privacy concern
  - Mitigation: consent-first UX, transparent panel, redaction and policy guard.

## Risk Handling Strategy (Operational)

Use a consistent four-stage control loop for every memory risk:

1. Prevent
2. Detect
3. Respond
4. Recover

### 1) Over-Personalization and Behavioral Drift

- Prevent
  - Cap memory influence in prompt composition (fixed token budget and capped number of memory items).
  - Prefer explicit user-stated preferences over inferred patterns.
  - Require confidence threshold and recency checks before injection.
- Detect
  - Track "felt repetitive" and "too assumptive" feedback signals.
  - Monitor rising rates of user prompt corrections (for example: "I did not ask that").
- Respond
  - Automatically reduce memory weight for affected sessions/users.
  - Fall back to conversation-only context when confidence is low.
- Recover
  - Rebuild user memory summary from pinned and recently confirmed items only.
  - Prompt user with a one-click memory reset recommendation.

### 2) Wrong or Outdated Memory Inference

- Prevent
  - Store source references for every memory item.
  - Apply confidence decay and time-based expiry for inferred memory.
  - Keep low-confidence candidates in pending state (not injected).
- Detect
  - Measure conflict rate (new user statement contradicts existing memory).
  - Measure delete/edit ratio per memory type.
- Respond
  - Auto-demote conflicting memory items from `active` to `archived`.
  - Ask concise confirmation questions before reuse when confidence drops.
- Recover
  - Re-rank memory set with latest confirmations.
  - Recompute canonical memory summary after significant user edits.

### 3) Privacy and Sensitive Data Leakage

- Prevent
  - Run redaction and policy filters before memory write.
  - Block storage of direct identifiers and sensitive categories by default.
  - Enforce opt-in for memory collection during early rollout.
- Detect
  - Alert on blocked-write spikes and policy-violation attempts.
  - Add periodic audit sampling of stored memory records.
- Respond
  - Immediate quarantine of suspicious records.
  - Disable memory extraction via feature flag if threshold breaches occur.
- Recover
  - Purge quarantined records and regenerate safe summary.
  - Publish user-visible incident note when required by policy.

### 4) Security and Unauthorized Access

- Prevent
  - Strict ownership enforcement on every read/write endpoint.
  - Least-privilege service roles and encrypted transport/storage.
  - Audit trail for memory access and mutation events.
- Detect
  - Alert on anomalous access patterns (cross-user attempts, burst reads).
  - Log integrity checks for audit pipeline.
- Respond
  - Revoke affected tokens/sessions and isolate impacted routes.
  - Initiate incident workflow with security owner on-call.
- Recover
  - Restore from validated state and rotate secrets if needed.
  - Add regression tests for the specific exploit path.

### 5) Quality Regression and User Trust Drop

- Prevent
  - Shadow evaluation before each rollout phase.
  - Keep a hard off-switch for memory injection per environment.
- Detect
  - Track relevance lift, comfort score, and memory delete rate daily.
  - Define rollback thresholds before release (go/no-go criteria).
- Respond
  - Automatic rollback when thresholds are breached.
  - Switch to read-only memory mode while investigation runs.
- Recover
  - Patch extraction/retrieval logic and relaunch with canary cohort.
  - Compare pre/post metrics to validate fix.

## Risk Governance and Cadence

- Maintain a lightweight risk register with: risk, owner, severity, trigger, mitigation status.
- Weekly review during rollout phases; bi-weekly after GA.
- Every incident must produce:
  - timeline
  - root cause
  - corrective action
  - preventive action
- No phase promotion unless all high-severity risks are in controlled state.

## Extraction Cost Model

Memory extraction requires an LLM call to classify and extract facts from each conversation turn. This is a platform cost.

### Cost ownership

- Extraction cost is absorbed by the platform, not charged to the user.
- This is justified because memory improves retention, reduces repetitive queries, and increases lifetime value of paid users.

### Cost control measures

- Use the cheapest available model for extraction (small/fast model, not the user's selected chat model).
- Batch extraction: process the full conversation once at conversation end (when user starts a new chat or after 10 minutes of inactivity), not after every single turn.
- Cap extraction to one LLM call per conversation (summarize the full conversation in one pass, extract all candidate facts at once).
- Set a hard monthly cost ceiling per user for extraction calls; skip extraction if ceiling is reached until next billing cycle.
- Estimated cost per extraction call: ~$0.001–$0.003 (small model, ~500 input tokens + ~200 output tokens).
- At 5 conversations/user/day for 1000 users: ~$5–$15/month platform cost.

### Infrastructure

- No dedicated job queue required initially.
- Use a fire-and-forget async call within the NestJS process after the SSE stream closes.
- If extraction volume grows beyond a single process, migrate to a lightweight BullMQ queue backed by Redis.

## Approval Gates

Implementation should only proceed after explicit approval on:

1. Memory categories and what is allowed to be stored.
2. Consent model (`opt-in` recommended).
3. Default retrieval/injection policy and confidence threshold.
4. Initial UI scope (read-only vs full edit controls in first release).

## Proposed First Implementation Scope (After Approval)

1. Backend memory schema + extraction service.
2. Read-only memory listing endpoint.
3. Prompt injection for high-confidence `interest` and `preference` only.
4. Minimal UI memory panel with review and delete controls (no memory toggle).

No implementation is executed from this document until approval is given.