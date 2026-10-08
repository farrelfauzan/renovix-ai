# Prompt Tuning Feature

## Overview

Before returning a response to the end-user, Performa AI injects a **system-level prompt** that tunes the model's behavior to align with our product goals. This ensures every response passes through our own prompt layer, giving us control over tone, safety, formatting, and domain-specific behavior—regardless of which upstream model the customer selects.

## How It Works

```
User Request
     │
     ▼
┌─────────────────────┐
│  ChatService        │
│  (validate, bill)   │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  PromptTuningService│  ◄── Injects system prompt from AppConfig
│  (prepend system    │
│   message)          │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  ProviderRouter     │
│  (OpenRouter)       │
└────────┬────────────┘
         │
         ▼
   Model Response
```

### Step-by-step

1. User sends a chat completion request with their messages.
2. `ChatService` validates the model, checks balance, and reserves credits.
3. **`PromptTuningService.applyTuning(messages)`** is called:
   - Fetches the active system prompt from the `AppConfig` table (key: `system_prompt`).
   - If the user already provided a `system` message, it **prepends** our system prompt to theirs (separated by a newline).
   - If no `system` message exists, it **inserts** one at position 0.
   - Returns the augmented messages array.
4. The augmented messages are sent to the provider (OpenRouter).
5. The response is returned to the user as normal.

## Configuration

The system prompt is stored in the `app_configs` table:

| Key             | Value (example)                                                                 |
|-----------------|---------------------------------------------------------------------------------|
| `system_prompt` | `You are a helpful AI assistant powered by Performa AI. Be concise, accurate...`|

This can be updated at any time via a database update or future admin endpoint—no redeployment needed.

## New Files

| File | Purpose |
|------|---------|
| `apps/api/src/app/chat/prompt-tuning.service.ts` | Service that reads the system prompt from `AppConfig` and augments user messages |

## Modified Files

| File | Change |
|------|--------|
| `apps/api/src/app/chat/chat.service.ts` | Call `PromptTuningService.applyTuning()` before sending messages to the provider |
| `apps/api/src/app/chat/chat.module.ts` | Import `PrismaModule`, register `PromptTuningService` as a provider |
| `prisma/seed.ts` | Seed a default `system_prompt` row in `app_configs` |

## Example

### Before tuning (raw user messages)

```json
[
  { "role": "user", "content": "What is machine learning?" }
]
```

### After tuning (messages sent to provider)

```json
[
  {
    "role": "system",
    "content": "You are a helpful AI assistant powered by Performa AI. Provide clear, concise, and accurate responses. Always be professional and helpful."
  },
  { "role": "user", "content": "What is machine learning?" }
]
```

### If user provides their own system prompt

```json
// Input
[
  { "role": "system", "content": "You are a coding tutor." },
  { "role": "user", "content": "Explain recursion." }
]

// After tuning
[
  {
    "role": "system",
    "content": "You are a helpful AI assistant powered by Performa AI. Provide clear, concise, and accurate responses. Always be professional and helpful.\n\nYou are a coding tutor."
  },
  { "role": "user", "content": "Explain recursion." }
]
```

## Cache Strategy

The system prompt is cached in-memory with a **60-second TTL** to avoid hitting the database on every request while still allowing near-realtime updates.

## Future Enhancements

- Per-user or per-API-key prompt overrides
- Admin API endpoint to update the system prompt
- A/B testing different system prompts
- Per-model prompt tuning (different prompts for different models)
