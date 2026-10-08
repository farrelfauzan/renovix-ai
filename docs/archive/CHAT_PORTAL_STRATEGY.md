# Chat Portal Strategy

## Overview

Build a public-facing chat portal (`apps/chat`) — a ChatGPT/Claude-like interface where users interact with Performa AI models directly in the browser. **No login required.** Everyone gets 20 free requests on the cheapest model. Users who register and top up credits unlock all models and pay per request using the existing billing system.

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Landing     │────►│  Chat Portal │────►│  NestJS API  │
│  (apps/land) │     │  (apps/chat) │     │  (apps/api)  │
└─────────────┘     └──────────────┘     └──────────────┘
                           │                     │
                     localStorage            PostgreSQL
                    (session tracking)     (users, usage,
                                           convos, sessions)
```

---

## Tier System (2 Tiers)

| Tier  | Who                              | Request Limit    | Models                    | Billing          | Conversation History |
|-------|----------------------------------|------------------|---------------------------|------------------|----------------------|
| Free  | Everyone (no login needed)       | 20 per session   | 1 model (cheapest only)   | None (free)      | localStorage only    |
| Paid  | Registered user with credits > 0 | Unlimited*       | All active models         | Pay-per-request  | Saved server-side    |

\* Paid users are limited only by their credit balance (existing reserve → execute → adjust billing flow).

**How it works:**
- First visit → session created (UUID in localStorage + server-side `PortalSession` row)
- User can chat immediately, no sign-up wall
- After 20 requests → "Top up credits to continue" CTA
- Registering alone doesn't grant more requests — **credits unlock paid tier**
- `User.balance > 0` → paid tier (all models, pay-per-request)
- `User.balance <= 0` or no account → free tier (20 requests, 1 model)

---

## 1. Chat Portal — Next.js App (`apps/chat`)

### 1.1 Tech Stack

| Tool              | Version | Purpose                                    |
|-------------------|---------|--------------------------------------------|
| Next.js           | 15      | App Router, SSR, routing                   |
| Tailwind CSS      | v4.2    | Utility-first styling (CSS-first config)   |
| shadcn/ui         | latest  | All UI components (Button, Input, Dialog, Sheet, ScrollArea, Avatar, etc.) |
| TanStack Query    | v5      | Server state: API calls, caching, streaming |
| TanStack Form     | v1      | Login/Register forms with validation       |
| Zustand           | v5      | Client state: chat UI, session, sidebar    |

#### Installation (bun)

```bash
# Scaffold Next.js app via Nx, then:
cd apps/chat

# Tailwind v4 (CSS-first — no tailwind.config.js needed)
bun add tailwindcss @tailwindcss/postcss postcss

# shadcn/ui init (picks up Tailwind v4 automatically)
bunx shadcn@latest init

# shadcn components (add as needed)
bunx shadcn@latest add button input textarea dialog sheet scroll-area avatar dropdown-menu tooltip badge separator skeleton

# TanStack Query v5
bun add @tanstack/react-query

# TanStack Form v1
bun add @tanstack/react-form

# Zustand v5
bun add zustand
```

#### How Each Tool Is Used

**shadcn/ui — All UI components**

Every UI element uses shadcn components. No custom HTML buttons, inputs, or dialogs.

```
Component Mapping:
├── ChatInput        → shadcn Textarea + Button
├── MessageBubble    → shadcn Card + Avatar + Badge (model name)
├── Sidebar          → shadcn Sheet (mobile) + ScrollArea (desktop)
├── ModelSelector    → shadcn DropdownMenu or Select
├── UsageBanner      → shadcn Progress + Badge
├── TopUpCTA         → shadcn Dialog + Button
├── Login/Register   → shadcn Input + Button + Label
├── ConversationList → shadcn ScrollArea + Button (each item)
├── UserMenu         → shadcn DropdownMenu + Avatar
├── Loading states   → shadcn Skeleton
├── Errors/toasts    → shadcn Sonner (toast)
└── Tooltips         → shadcn Tooltip
```

**TanStack Query v5 — All API calls**

Every API interaction goes through TanStack Query. No raw `fetch` calls in components.

```typescript
// Query keys convention
const chatKeys = {
  usage: ['portal', 'usage'] as const,
  models: ['portal', 'models'] as const,
  conversations: ['portal', 'conversations'] as const,
  conversation: (id: string) => ['portal', 'conversation', id] as const,
};

// Example: Fetch usage stats
const { data: usage } = useQuery({
  queryKey: chatKeys.usage,
  queryFn: () => portalApi.getUsage(sessionId),
  refetchInterval: 30_000, // refresh every 30s
});

// Example: Send message (mutation)
const sendMessage = useMutation({
  mutationFn: (body: ChatCompletionRequest) => portalApi.sendMessage(body),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: chatKeys.usage });
    queryClient.invalidateQueries({ queryKey: chatKeys.conversations });
  },
});

// Streaming: TanStack Query v5 supports streamedQuery for SSE
// We use useMutation for send + manual streaming via ReadableStream
// The mutation initiates the request, then we consume the SSE stream
// and update Zustand store in real-time as tokens arrive
```

**TanStack Form v1 — Login & Register forms**

Used for auth forms with built-in validation. Pairs with shadcn `Input` components.

```typescript
// Example: Login form
const form = useForm({
  defaultValues: { email: '', password: '' },
  onSubmit: async ({ value }) => {
    await loginMutation.mutateAsync(value); // TanStack Query mutation
  },
});

// In JSX — shadcn Input inside TanStack Form Field:
<form.Field
  name="email"
  validators={{
    onChange: ({ value }) =>
      !value ? 'Email is required' :
      !/\S+@\S+\.\S+/.test(value) ? 'Invalid email' : undefined,
  }}
  children={(field) => (
    <div>
      <Label htmlFor={field.name}>Email</Label>
      <Input
        id={field.name}
        type="email"
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
      />
      {field.state.meta.errors && (
        <p className="text-sm text-destructive">{field.state.meta.errors}</p>
      )}
    </div>
  )}
/>
```

**Zustand v5 — Client-side state**

Three stores for different concerns:

```typescript
// 1. Session store (persisted to localStorage)
interface SessionStore {
  sessionId: string;          // portal session UUID
  token: string | null;       // JWT if logged in
  user: User | null;
  tier: 'free' | 'paid';
  setToken: (token: string, user: User) => void;
  logout: () => void;
}

const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      sessionId: crypto.randomUUID(),
      token: null,
      user: null,
      tier: 'free',
      setToken: (token, user) =>
        set({ token, user, tier: user.balance > 0 ? 'paid' : 'free' }),
      logout: () => set({ token: null, user: null, tier: 'free' }),
    }),
    { name: 'portal-session' },
  ),
);

// 2. Chat store (current conversation state)
interface ChatStore {
  messages: Message[];
  isStreaming: boolean;
  currentModel: string | null;
  appendToken: (token: string) => void;    // called per SSE chunk
  addMessage: (msg: Message) => void;
  setStreaming: (v: boolean) => void;
  setModel: (slug: string) => void;
  reset: () => void;
}

const useChatStore = create<ChatStore>()((set) => ({
  messages: [],
  isStreaming: false,
  currentModel: null,
  appendToken: (token) =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === 'assistant') {
        return {
          messages: [
            ...state.messages.slice(0, -1),
            { ...last, content: last.content + token },
          ],
        };
      }
      return state;
    }),
  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setModel: (currentModel) => set({ currentModel }),
  reset: () => set({ messages: [], isStreaming: false }),
}));

// 3. Sidebar store
interface SidebarStore {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}
```

**Tailwind CSS v4.2 — CSS-first configuration**

Tailwind v4 uses CSS-based config instead of `tailwind.config.js`. shadcn/ui v4 integration is native.

```css
/* apps/chat/src/app/globals.css */
@import "tailwindcss";

/* shadcn/ui theme variables are auto-generated by `shadcn init` */
/* Tailwind v4: no config file needed — uses @theme directive */
@theme {
  /* Custom tokens if needed, but shadcn handles most via CSS variables */
}
```

### 1.2 Pages & Routes

```
apps/chat/
├── src/app/
│   ├── layout.tsx              # Shell: sidebar + main area
│   ├── page.tsx                # Redirect to /chat/new
│   ├── chat/
│   │   ├── new/page.tsx        # New conversation
│   │   └── [id]/page.tsx       # Existing conversation (paid users only)
│   ├── login/page.tsx          # Login page (optional, for paid users)
│   ├── register/page.tsx       # Register page (optional, for paid users)
│   └── api/                    # BFF proxy routes (optional)
```

### 1.3 UI Components

All components built with **shadcn/ui**. No custom HTML form elements.

```
components/
├── sidebar/
│   ├── Sidebar.tsx             # Sheet (mobile) + fixed panel (desktop), ScrollArea for list
│   ├── ConversationItem.tsx    # Button variant="ghost" per conversation
│   └── UserMenu.tsx            # DropdownMenu + Avatar (or Badge "Guest")
├── chat/
│   ├── ChatArea.tsx            # ScrollArea for messages + ChatInput at bottom
│   ├── MessageBubble.tsx       # Card + Avatar + markdown content
│   ├── ChatInput.tsx           # Textarea + Button (send icon)
│   ├── ModelSelector.tsx       # Select component (paid users only, hidden for free)
│   └── StreamingIndicator.tsx  # Skeleton lines while streaming
├── auth/
│   ├── LoginForm.tsx           # TanStack Form + shadcn Input/Button/Label
│   └── RegisterForm.tsx        # TanStack Form + shadcn Input/Button/Label
├── common/
│   ├── UsageBanner.tsx         # Progress + Badge ("5 of 20 free requests")
│   ├── TopUpCTA.tsx            # Dialog with Button CTA
│   └── MarkdownRenderer.tsx    # react-markdown + rehype-sanitize
├── providers/
│   └── Providers.tsx           # QueryClientProvider + Zustand hydration
```

### 1.4 Provider Setup

```typescript
// apps/chat/src/components/providers/Providers.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,       // 30s before refetch
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

### 1.5 API Layer (TanStack Query)

```typescript
// apps/chat/src/lib/api.ts — thin fetch wrapper
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const portalApi = {
  getUsage: (sessionId: string) =>
    fetch(`${API_BASE}/chat/portal/usage`, {
      headers: buildHeaders(sessionId),
    }).then(handleResponse),

  getModels: (sessionId: string) =>
    fetch(`${API_BASE}/chat/portal/models`, {
      headers: buildHeaders(sessionId),
    }).then(handleResponse),

  sendMessage: (sessionId: string, body: ChatCompletionRequest) =>
    fetch(`${API_BASE}/chat/portal/completions`, {
      method: 'POST',
      headers: { ...buildHeaders(sessionId), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    // Returns raw Response for SSE streaming — consumed by useStreaming hook

  getConversations: (sessionId: string) =>
    fetch(`${API_BASE}/conversations`, {
      headers: buildHeaders(sessionId),
    }).then(handleResponse),
};

// apps/chat/src/lib/hooks/usePortalUsage.ts
export function usePortalUsage() {
  const sessionId = useSessionStore((s) => s.sessionId);
  return useQuery({
    queryKey: chatKeys.usage,
    queryFn: () => portalApi.getUsage(sessionId),
    refetchInterval: 30_000,
  });
}

// apps/chat/src/lib/hooks/usePortalModels.ts
export function usePortalModels() {
  const sessionId = useSessionStore((s) => s.sessionId);
  return useQuery({
    queryKey: chatKeys.models,
    queryFn: () => portalApi.getModels(sessionId),
  });
}

// apps/chat/src/lib/hooks/useSendMessage.ts
export function useSendMessage() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const { appendToken, addMessage, setStreaming } = useChatStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ChatCompletionRequest) =>
      portalApi.sendMessage(sessionId, body),
    onMutate: () => {
      setStreaming(true);
      addMessage({ role: 'assistant', content: '' });
    },
    onSuccess: async (response) => {
      // Consume SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // Parse SSE lines: "data: {...}\n\n"
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            const json = JSON.parse(line.slice(6));
            const token = json.choices?.[0]?.delta?.content || '';
            if (token) appendToken(token);
          }
        }
      }
      setStreaming(false);
      queryClient.invalidateQueries({ queryKey: chatKeys.usage });
    },
    onError: () => setStreaming(false),
  });
}
```

### 1.6 Core UX Flow

1. **Landing on chat portal** → Session UUID created in localStorage (Zustand persist), registered server-side
2. **User sends message** → `useSendMessage()` mutation via TanStack Query, with `X-Portal-Session` header (+ optional JWT)
3. **Streaming response** → SSE chunks parsed and pushed to `useChatStore.appendToken()` in real-time
4. **Free tier:** Single model (cheapest), no `Select` shown, `Progress` usage counter visible
5. **Limit reached (20 requests)** → `ChatInput` disabled, `Dialog` CTA: "Register & add credits to continue"
6. **After top-up** → All models unlocked, `Select` model selector appears, conversations saved server-side

### 1.7 Free Experience (Default for Everyone)

- **No login required**, starts chatting immediately
- 1 model only — the cheapest active model (e.g., cheapest LLaMA/Qwen variant)
- No model `Select` shown in UI
- Conversations stored in **localStorage only** (not on server)
- `Progress` bar visible: "X of 20 free requests remaining"
- When 20 requests hit → input disabled, `Dialog` modal prompting sign-up + top-up
- Sidebar shows localStorage conversations only

### 1.8 Paid Experience (Registered + Credits > 0)

- Full model `Select` dropdown with all active models
- Conversations persisted server-side (existing `Conversation` + `Message` models)
- Credit balance shown in sidebar `Badge`: "$4.50 remaining"
- Pay-per-request: existing billing flow (reserve → call → adjust → log)
- Conversation sidebar with history, search, delete, rename
- When balance hits 0 → reverts to free tier behavior (but keeps server-side history viewable)

---

## 2. NestJS API Changes (`apps/api`)

### 2.1 New Database Model

```prisma
model PortalSession {
  id            String    @id @default(uuid())
  sessionToken  String    @unique
  requestCount  Int       @default(0)
  userId        String?                      // linked after login (optional)
  lastRequestAt DateTime? @db.Timestamptz
  createdAt     DateTime  @default(now()) @db.Timestamptz
  expiresAt     DateTime  @db.Timestamptz    // 24h from creation

  user          User?     @relation(fields: [userId], references: [id])

  @@map("portal_sessions")
}
```

No changes to the `User` model. Tier is derived from `balance`:
- `balance > 0` → paid
- `balance <= 0` or no user → free (20 requests tracked via `PortalSession`)

### 2.2 New/Modified Endpoints

#### `POST /chat/portal/completions` (New)

Separate from the existing API-key-based `/chat/completions`. Supports unauthenticated and JWT-authenticated users.

```
Headers:
  X-Portal-Session: <uuid>              # always required (session tracking)
  Authorization: Bearer <jwt_token>      # optional (if logged in)

Body: Same ChatCompletionRequestSchema but:
  - model: ignored for free tier (forced to cheapest), selectable for paid
  - store: auto-set to true for paid users, false for free
```

**Request flow:**

```
1. Extract session token (X-Portal-Session) — required
2. Extract JWT (Authorization) — optional
3. Determine tier:
   a. JWT present + user.balance > 0 → PAID
   b. Everything else → FREE
4. If FREE:
   a. Lookup/create PortalSession by sessionToken
   b. If requestCount >= 20 → 429 "Free limit reached"
   c. Force model to cheapest
   d. Skip billing (no credits deducted)
   e. Call provider
   f. Increment requestCount atomically
   g. Return response
5. If PAID:
   a. Use existing billing pipeline (reserve → execute → adjust → log)
   b. Use requested model (validated against registry)
   c. Save conversation server-side
   d. Return response
```

#### `GET /chat/portal/usage` (New)

Returns current usage info for the UI banner.

```json
// Free tier (no login, or logged in with balance <= 0)
{ "tier": "free", "used": 12, "limit": 20, "remaining": 8 }

// Paid tier (logged in with balance > 0)
{ "tier": "paid", "balance": "4.50", "unlimited": true }
```

#### `GET /chat/portal/models` (New)

Returns models based on tier.

```json
// Free tier → 1 model
{ "models": [{ "slug": "llama-3-8b", "name": "LLaMA 3 8B" }] }

// Paid tier → all active models
{ "models": [
  { "slug": "llama-3-8b", "name": "LLaMA 3 8B", "inputPrice": "0.0016", "outputPrice": "0.0016" },
  { "slug": "qwen-72b", "name": "Qwen 72B", "inputPrice": "0.0080", "outputPrice": "0.0080" }
]}
```

### 2.3 New Guard: `PortalGuard`

```typescript
@Injectable()
class PortalGuard implements CanActivate {
  // 1. Read X-Portal-Session header → required (reject if missing)
  // 2. Read Authorization Bearer header → optional
  // 3. If JWT present, validate and load user
  // 4. Determine tier: user?.balance > 0 ? 'paid' : 'free'
  // 5. Attach to request:
  //    { sessionId, tier: 'free' | 'paid', user?: { id, email, balance } }
}
```

### 2.4 New Service: `PortalTierService`

```typescript
@Injectable()
class PortalTierService {
  // Get or create a portal session
  async getOrCreateSession(sessionToken: string): Promise<PortalSession>

  // Check if free-tier session can make a request
  async canMakeRequest(sessionToken: string): Promise<{ allowed: boolean; remaining: number }>

  // Increment free-tier request count (atomic)
  async trackFreeRequest(sessionToken: string): Promise<void>

  // Get usage stats for UI banner
  async getUsage(sessionToken: string, user?: { balance: Decimal }): Promise<TierUsage>

  // Cleanup expired sessions (cron)
  async cleanupExpiredSessions(): Promise<number>
}
```

**Free tier limit logic (simple):**

```typescript
async canMakeRequest(sessionToken: string) {
  const session = await this.getOrCreateSession(sessionToken);
  const allowed = session.requestCount < 20;
  return { allowed, remaining: Math.max(0, 20 - session.requestCount) };
}

async trackFreeRequest(sessionToken: string) {
  await prisma.portalSession.update({
    where: { sessionToken },
    data: {
      requestCount: { increment: 1 },
      lastRequestAt: new Date(),
    },
  });
}
```

### 2.5 Cheapest Model Resolution

```typescript
// In ModelRegistryService, add:
getCheapestModel(): ModelConfig {
  // Sort all active models by (inputPrice + outputPrice) ascending
  // Return first one — this is the only model free-tier users get
}
```

Configured via existing `AiModel` table. No hardcoding — the cheapest active model is always auto-selected.

### 2.6 Cron Job

```typescript
@Cron('0 * * * *')  // Every hour
async cleanupExpiredSessions() {
  await prisma.portalSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
```

---

## 3. Landing Page Changes (`apps/landing`)

### 3.1 Navbar

Add "Chat" link to the navigation bar (desktop + mobile):

```tsx
// In navbar.tsx, add to navLinks array:
{ name: 'Chat', href: 'https://chat.performa.ai' }
```

### 3.2 Hero Section

Add CTA button alongside existing ones:

```tsx
<Link href="https://chat.performa.ai">
  Try AI Chat Free →
</Link>
```

---

## 4. Nx Workspace Configuration

```
apps/
├── chat/                    # NEW
│   ├── project.json
│   ├── next.config.js
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── package.json
│   └── src/
```

- Port: `4300` (landing=4200, dashboard=4100, api=3000)
- Build target: same as dashboard (Next.js)
- Proxy API calls to `http://localhost:3000` in dev

---

## 5. Implementation Phases

### Phase 1: API Tier System (Backend)
1. Add `PortalSession` model to Prisma schema
2. Run migration
3. Add `getCheapestModel()` to `ModelRegistryService`
4. Create `PortalTierService` (session management + free limit logic)
5. Create `PortalGuard` (hybrid session + optional JWT)
6. Create `POST /chat/portal/completions` endpoint
7. Create `GET /chat/portal/usage` endpoint
8. Create `GET /chat/portal/models` endpoint
9. Add session cleanup cron job

### Phase 2: Chat Portal App (Frontend)
1. Scaffold `apps/chat` Next.js app in Nx workspace
2. Build layout shell (sidebar + chat area)
3. Implement session tracking (localStorage UUID)
4. Implement message sending + streaming response display
5. Build usage banner (X of 20 free requests)
6. Build top-up CTA when limit reached
7. Markdown rendering for assistant responses

### Phase 3: Auth + Paid Tier Integration
1. Login/Register pages in chat portal
2. JWT cookie handling
3. Model selector (appears only for paid users)
4. Server-side conversation persistence for paid users
5. Conversation sidebar with history
6. Balance display in sidebar

### Phase 4: Landing Page + Polish
1. Add "Chat" link to landing navbar
2. Add "Try AI Chat Free" CTA in hero section
3. Responsive polish, dark mode
4. Error handling, loading states, edge cases

---

## 6. Environment & Deployment

| App          | Dev Port | Prod URL (suggested)        |
|--------------|----------|-----------------------------|
| Landing      | 4200     | performa.ai                 |
| Chat Portal  | 4300     | chat.performa.ai            |
| Dashboard    | 4100     | dashboard.performa.ai       |
| API          | 3000     | api.performa.ai             |

---

## 7. Security Considerations

- **Free tier abuse:** 24h session expiry; sessions are server-side so localStorage spoofing just creates a new session (another 20 requests). Mitigate with IP-based rate limiting via Throttler (e.g., max 3 new sessions per IP per 24h)
- **CORS:** Chat portal origin added to API CORS whitelist
- **XSS:** Sanitize markdown rendering (use `rehype-sanitize`)
- **Cost protection:** Free requests use only the cheapest model; bounded cost per request. At worst, abuse costs = 20 requests × cheapest model cost per session per 24h per IP

---

## 8. Decisions

### 8.1 Streaming (SSE)

**Decision:** Yes — streaming responses via Server-Sent Events (SSE).

**How it works:**

```
Client                        API                         Provider (Together AI)
  │                            │                               │
  │── POST /portal/completions │                               │
  │   Accept: text/event-stream│                               │
  │                            │── POST /v1/chat/completions   │
  │                            │   stream: true                │
  │                            │                               │
  │                            │◄── data: {"choices":[...]}    │
  │◄── data: {"choices":[...]} │◄── data: {"choices":[...]}    │
  │◄── data: {"choices":[...]} │◄── data: {"choices":[...]}    │
  │◄── data: [DONE]           │◄── data: [DONE]               │
```

**Backend complexity:**
- The existing `together.adapter.ts` needs a `stream: true` mode that returns a `ReadableStream` instead of a parsed JSON response
- The portal controller returns a `StreamableFile` (NestJS) with `Content-Type: text/event-stream`
- Token counting happens **after** stream completes — we accumulate chunks, then count total tokens from the final `usage` object (Together AI sends it in the last chunk)
- For **paid tier**: credit reservation happens **before** streaming starts (same as current flow), actual cost adjustment happens **after** stream ends
- For **free tier**: just increment request count after stream ends
- Error mid-stream: send an SSE error event, close the stream, refund reservation if paid

**Frontend complexity:**
- Use `fetch()` + `ReadableStream` + `TextDecoder` to read SSE chunks
- Parse each `data:` line, extract `choices[0].delta.content`, append to message in real-time
- Handle `[DONE]` signal to finalize the message
- Handle mid-stream errors gracefully (show partial response + error notice)

**New files needed:**
- `apps/api/src/app/chat/streaming.service.ts` — handles SSE stream relay from provider to client
- `apps/chat/src/lib/useStreaming.ts` — React hook for consuming SSE responses

### 8.2 Session Abuse Prevention (IP-based)

**Decision:** Yes — IP-based rate limiting on session creation to prevent free-tier abuse.

**Implementation:**

```typescript
// In PortalTierService, on session creation:
// 1. Count PortalSessions created from this IP in the last 24h
// 2. If count >= 3 → reject with 429 "Too many sessions"
// 3. Otherwise, create session and store IP

// Add to PortalSession model:
//   ipAddress String?
```

```prisma
model PortalSession {
  id            String    @id @default(uuid())
  sessionToken  String    @unique
  requestCount  Int       @default(0)
  ipAddress     String?                      // for abuse prevention
  userId        String?
  lastRequestAt DateTime? @db.Timestamptz
  createdAt     DateTime  @default(now()) @db.Timestamptz
  expiresAt     DateTime  @db.Timestamptz

  user          User?     @relation(fields: [userId], references: [id])

  @@map("portal_sessions")
}
```

**Rules:**
- Max **3 new sessions per IP per 24h** (= 60 free requests max per IP per day)
- IP extracted from `X-Forwarded-For` header (behind reverse proxy) or `request.ip`
- Existing sessions from the same IP are fine — the limit is on **new session creation** only
- This is a soft limit; determined users can still use VPNs, but it stops casual abuse

### 8.3 Deployment — Subdomain (Local Dev Only for Now)

**Decision:** Subdomain-based routing. Domain TBD, local dev only for now.

**Local dev setup:**

| App          | Dev Port | Local URL                     |
|--------------|----------|-------------------------------|
| Landing      | 4200     | `http://localhost:4200`       |
| Chat Portal  | 4300     | `http://localhost:4300`       |
| Dashboard    | 4100     | `http://localhost:4100`       |
| API          | 3000     | `http://localhost:3000`       |

- CORS whitelist in API: `localhost:4300` added alongside existing origins
- Chat portal proxies `/api` calls to `http://localhost:3000` via `next.config.js` rewrites in dev
- No subdomain config needed locally — just different ports
- Production subdomain setup deferred until domain is decided

---

**Awaiting your approval before implementation.**
