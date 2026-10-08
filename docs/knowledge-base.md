# Knowledge Base — RAG Module

## Purpose

The Knowledge Base module enables **Retrieval-Augmented Generation (RAG)** for Performa AI. It allows users to upload their own documents/text, which are automatically chunked, embedded into vectors, and stored in PostgreSQL using **pgvector**. When a user sends a chat query, the system can search these knowledge bases to retrieve relevant context and inject it into the LLM prompt — producing more accurate, grounded responses.

### Why RAG?

- LLMs have a knowledge cutoff and no access to private data
- RAG bridges this gap by retrieving relevant user-provided context at query time
- Users can build domain-specific AI assistants without fine-tuning

---

## Architecture

```
User uploads text chunks
        ↓
  Embedding Service (OpenRouter)
        ↓
  Vectors stored in PostgreSQL (pgvector)
        ↓
  User sends a search query
        ↓
  Query is embedded → cosine similarity search
        ↓
  Top-K relevant chunks returned
        ↓
  (Future) Injected into chat prompt as context
```

### Components

| File | Role |
|------|------|
| `knowledge.module.ts` | NestJS module registration |
| `knowledge.controller.ts` | REST API endpoints |
| `knowledge.service.ts` | Business logic (CRUD + vector search) |
| `embedding.service.ts` | Calls the OpenRouter embeddings API |
| `dto/knowledge.dto.ts` | Zod validation schemas |

### Database Models

- **KnowledgeBase** — A named collection of chunks owned by a user
- **KnowledgeChunk** — A text chunk with its vector embedding, metadata, and token count

---

## Workflow

### 1. Create a Knowledge Base

```
POST /v1/knowledge/bases
Authorization: Bearer sk_live_xxx

{
  "name": "Product Docs",
  "description": "Our product documentation"
}
```

This creates an empty container to hold your text chunks.

### 2. Add Chunks

```
POST /v1/knowledge/bases/:id/chunks
Authorization: Bearer sk_live_xxx

{
  "chunks": [
    {
      "content": "Performa AI supports LLaMA and Qwen models...",
      "metadata": { "source": "docs/models.md", "page": 1 }
    },
    {
      "content": "Billing is based on token usage with per-model pricing...",
      "metadata": { "source": "docs/billing.md", "page": 3 }
    }
  ]
}
```

**What happens internally:**

1. Validates that the knowledge base belongs to the authenticated user
2. Sends all chunk texts to the OpenRouter embeddings API in a single batch
3. Receives vector embeddings (one per chunk)
4. Inserts each chunk + embedding into `knowledge_chunks` table in a DB transaction

### 3. Search (Vector Similarity)

```
POST /v1/knowledge/search
Authorization: Bearer sk_live_xxx

{
  "query": "How does billing work?",
  "knowledgeBaseId": "optional-uuid-to-scope-search",
  "topK": 5
}
```

**What happens internally:**

1. The query string is embedded into a vector via OpenRouter
2. pgvector performs cosine similarity search (`<=>` operator)
3. Returns the top-K most similar chunks with similarity scores

**Response:**

```json
[
  {
    "id": "chunk-uuid",
    "content": "Billing is based on token usage with per-model pricing...",
    "metadata": { "source": "docs/billing.md", "page": 3 },
    "tokenCount": 42,
    "knowledgeBaseId": "kb-uuid",
    "similarity": 0.92
  }
]
```

### 4. Manage Knowledge Bases

| Action | Method | Endpoint |
|--------|--------|----------|
| List all bases | GET | `/v1/knowledge/bases` |
| Get one base | GET | `/v1/knowledge/bases/:id` |
| Update base | PUT | `/v1/knowledge/bases/:id` |
| Delete base | DELETE | `/v1/knowledge/bases/:id` |
| List chunks | GET | `/v1/knowledge/bases/:id/chunks` |
| Delete chunk | DELETE | `/v1/knowledge/bases/:id/chunks/:chunkId` |

---

## Security

- All endpoints require API key auth (`ApiKeyGuard`)
- Users can only access their own knowledge bases (ownership check on every operation)
- Chunk ingestion is rate-limited to **10 requests/minute** to prevent abuse
- All database queries use parameterized `Prisma.sql` tagged templates (no raw string interpolation)
- UUIDs are validated with `ParseUUIDPipe`
- Request bodies are validated with Zod schemas

---

## Database Requirements

### pgvector Extension

The PostgreSQL database must have the `vector` extension enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This is handled automatically by Prisma via the `extensions = [vector]` config in `schema.prisma`.

### Embedding Index

For production performance, add an HNSW index on the embedding column. Add this to your migration SQL:

```sql
CREATE INDEX knowledge_chunks_embedding_idx
ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```

---

## Configuration

| Env Variable | Required | Description |
|-------------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | API key for OpenRouter (chat models and embeddings) |
| `DATABASE_URL` | Yes | PostgreSQL connection string (must support pgvector) |

### Embedding Model

Currently uses `intfloat/multilingual-e5-large-instruct` (`apps/api/src/app/knowledge/embedding.service.ts`). The vector dimension in the schema is `vector(1024)`. If you change the embedding model, update the dimension in `prisma/schema.prisma` accordingly.

---

## Future Integration with Chat

The search endpoint is designed to be integrated into the chat completion flow:

```
User message → Search knowledge bases → Inject top chunks as context → Send to LLM
```

This will be wired into `ChatService` so that when a user has active knowledge bases, relevant context is automatically retrieved and prepended to the system prompt before calling the LLM provider.
