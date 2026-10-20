# 📄 Product Requirements Document (PRD)

## 🏷️ Product Name (Working)

**"Renovix AI"**

---

## 1. 🎯 Product Overview

### Problem

Developers want to use AI models but face:

- Multiple APIs (OpenAI, Anthropic, etc.)
- Complex billing
- Expensive pricing
- No easy way to switch models

### Solution

A unified API + dashboard where users:

- Access multiple models (LLaMA, Qwen, etc.)
- Pay per request (credits system)
- Don't worry about infrastructure

### Core Value Proposition

> "One API for all AI models, cheaper, with pay-as-you-go pricing."

---

## 2. 👥 Target Users

**Primary**

- Indie developers
- Startup founders
- SaaS builders

**Secondary**

- Agencies
- AI hobbyists

---

## 3. 🔑 Core Features (MVP Scope)

### 3.1 Unified API

**Endpoint**

```
POST /v1/chat/completions
```

**Request**

```json
{
  "model": "llama-3",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

**Supported Models (MVP)**

- LLaMA (via Together AI)
- Qwen (via Together / other provider)

---

### 3.2 Model Routing Layer

System maps model → provider:

```json
{
  "llama-3": "together",
  "qwen-2.5": "together"
}
```

---

### 3.3 Pay-Per-Request Billing (Credits)

**User flow:**

1. User adds balance ($5, $10, etc.)
2. Each request deducts cost

**Pricing logic (MVP)**

Simple version:

> $0.001 per request

OR better:

> $ per token (input + output)

---

### 3.4 API Key System

Each user gets:

```
sk_live_xxxxx
```

Used in headers:

```
Authorization: Bearer sk_live_xxx
```

---

### 3.5 Usage Tracking

Store:

- Tokens used
- Cost per request
- Model used
- Timestamp

---

### 3.6 Dashboard (Simple)

User can:

- View balance
- View usage
- Copy API key

---

### 3.7 Payments

Integrate:

- Stripe (global)
- or Xendit (Indonesia 🇮🇩)

**Flow:**

> User pays → credits added → usable via API

---

## 4. 🚫 Out of Scope (MVP)

Do **NOT** build yet:

- Fine-tuning
- RAG
- Decentralized inference (like Jatevo)
- SDKs (just basic docs first)
- Multi-region infra

---

## 5. 🧠 User Flow

### Developer Flow

```
1. Sign up
2. Get API key
3. Add credits
4. Call API
5. Get response
6. Balance decreases
```

### Internal Request Flow

```
API Request
   ↓
Auth Middleware (API key)
   ↓
Check balance
   ↓
Route to model provider
   ↓
Get response
   ↓
Calculate cost
   ↓
Deduct balance
   ↓
Return response
```

---

## 6. 🏗️ System Architecture

```
Frontend (Dashboard)
        ↓
Backend API (Node.js / FastAPI)
        ↓
┌──────────────────────────────┐
│ Auth Service                 │
│ Billing Service              │
│ Model Router                 │
└──────────────────────────────┘
        ↓
Model Providers:
  - Together AI
  - (later) self-hosted models
```

---

## 7. 🗄️ Database Schema (MVP)

### Users

```json
{
  "id": "uuid",
  "email": "user@email.com",
  "balance": 10.00,
  "api_key": "sk_xxx"
}
```

### Usage Logs

```json
{
  "user_id": "uuid",
  "model": "llama-3",
  "tokens": 1200,
  "cost": 0.002,
  "created_at": "timestamp"
}
```

### Transactions

```json
{
  "user_id": "uuid",
  "amount": 10.00,
  "type": "topup",
  "status": "success"
}
```

---

## 8. 🔌 API Design

```
POST /v1/chat/completions
```

**Headers**

```
Authorization: Bearer sk_xxx
```

**Response**

```json
{
  "id": "chatcmpl_xxx",
  "model": "llama-3",
  "output": "Hello! How can I help?",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 20
  }
}
```

---

## 9. 💰 Monetization

### Pricing Strategy (MVP)

**Option 1 (simple)**

- Flat per request

**Option 2 (better)**

- Markup on provider cost

**Example:**

- Your cost: $0.001
- You charge: $0.002

### Revenue Streams

- API usage
- (future) Premium models
- (future) Enterprise plans

---

## 10. ⚠️ Risks & Mitigation

| Risk | Solution |
|------|----------|
| High infra cost | Start with external providers |
| Abuse (spam API) | Rate limiting |
| Negative balance | Pre-check credits |
| Slow response | Choose fast providers |

---

## 11. 🚀 MVP Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | Node.js (Fastify) OR Python (FastAPI) |
| **Database** | PostgreSQL |
| **Auth** | JWT + API key |
| **Payments** | Stripe / Xendit |
| **AI Providers** | Together AI, Groq (optional) |

---

## 12. 📅 MVP Timeline (Realistic)

| Week | Tasks |
|------|-------|
| **Week 1** | API + routing, basic model integration |
| **Week 2** | Billing system, database + usage logs |
| **Week 3** | Dashboard UI, payments |

👉 **Launch MVP**

---

## 13. 📈 Success Metrics

- Number of API calls per day
- Revenue per user
- Cost vs revenue margin
- Active developers

---

## 14. 🔥 Future Features (Post-MVP)

- RAG (huge value)
- Fine-tuning
- SDK (JS, Python)
- Smart routing (auto model selection)
- Self-hosted models (increase margin)

---

## ✅ Final Summary

You are building:

> **A unified AI API platform with pay-per-use billing**

MVP = only 3 things matter:

1. API works
2. Billing works
3. Models respond

Everything else can wait.
