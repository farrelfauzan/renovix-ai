# Document Generation Strategy

## Overview

Add a **document generation** feature to Performa AI. When a user prompts the AI to create a document (e.g. *"Create me a PDF for my product PRD"*, *"Generate a DOCX report on market analysis"*), the system:

1. Sends the prompt to Together AI as usual
2. Receives the AI's Markdown response
3. **Detects** that the user requested a file format (PDF, DOCX, XLSX)
4. Converts the Markdown response → the requested file format
5. Returns the file as a downloadable attachment alongside the chat message

The AI does the writing. We do the file conversion.

---

## Architecture

```
User Prompt: "Create me a PDF for my product PRD"
        │
        ▼
┌──────────────────────────────────────────────────────┐
│                   NestJS API                         │
│                                                      │
│  1. ChatService receives prompt                      │
│  2. FormatDetector checks if user wants a file       │
│  3. Send prompt to Together AI (normal flow)         │
│  4. Receive Markdown response                        │
│  5. If file requested → DocumentService converts MD  │
│  6. Upload file to S3                                │
│  7. Return chat response + S3 download URL            │
└──────────────────────────────────────────────────────┘
        │                          │
   Chat Response              File Download
  (normal message)           (S3 presigned URL)
```

---

## How It Works (User Perspective)

### Chat Portal

1. User types: *"Create me a PDF for my product PRD"*
2. AI generates the content (user does **not** see the raw Markdown in chat)
3. System converts MD → PDF, uploads to S3
4. Chat shows a clean message: *"Here's your document, generated as a PDF."* with a download button
5. User clicks → browser downloads the file

> **No Markdown rendering in chat** — when a document format is detected, the AI response is hidden from the chat bubble. The user only sees a friendly confirmation message + download link. The raw Markdown lives only in the generated file.

### Via API (SDK users)

1. User sends `POST /api/chat/completions` with `"output_format": "pdf"`
2. Response includes the normal `choices[].message.content` (Markdown) **plus** a `document_url` field (S3 presigned URL)
3. User fetches the file directly from S3

---

## Format Detection — via PromptTemplate (Intent System)

Format detection uses the **existing `PromptTemplateService.classify()` pipeline** — no separate detector needed. We add new `PromptTemplate` records with document-related keywords. When the classifier matches a document template, it tells the AI how to structure its response AND signals the system to convert the output.

### How It Works (Existing Pipeline)

```
User: "Create me a PDF for my product PRD"
        │
        ▼
PromptTemplateService.classify(messages)
        │  keyword match: "pdf" → slug: "document-pdf"
        ▼
PromptTuningService.applyTuning()
        │  injects: [Document PDF Mode] system prompt
        ▼
Together AI generates clean, structured Markdown
        │
        ▼
ChatService checks: did the matched template have outputFormat?
        │  yes → DocumentService.generate(markdown, "pdf")
        ▼
Response includes chat message + download link
```

### PromptTemplate Seed Data (Document Generation)

Three new `PromptTemplate` records — one per format:

```typescript
// prisma/seed.ts

{
  slug: "document-pdf",
  name: "Document Generation (PDF)",
  description: "Generates structured documents and converts to PDF",
  keywords: [
    "pdf", "as pdf", "create a pdf", "generate a pdf", "make a pdf",
    "export as pdf", "download as pdf", "pdf file", "pdf document",
    "create me a pdf", "generate pdf"
  ],
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
  priority: 20,
  active: true,
},
{
  slug: "document-docx",
  name: "Document Generation (DOCX)",
  description: "Generates structured documents and converts to Word format",
  keywords: [
    "docx", "word document", "word doc", "as word", "create a word",
    "generate a word", "make a word document", "export as word",
    "download as word", "word file", ".docx"
  ],
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
  priority: 20,
  active: true,
},
{
  slug: "document-xlsx",
  name: "Document Generation (XLSX)",
  description: "Generates structured tabular data and converts to Excel format",
  keywords: [
    "xlsx", "excel", "spreadsheet", "as excel", "create a spreadsheet",
    "generate an excel", "make a spreadsheet", "export as excel",
    "download as excel", "excel file", ".xlsx"
  ],
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
  priority: 20,
  active: true,
}
```

### Schema Change — Add `outputFormat` to PromptTemplate

Add a nullable `outputFormat` field to `PromptTemplate` so the system knows which format to convert to when a template is matched:

```prisma
model PromptTemplate {
  id           String   @id @default(uuid())
  slug         String   @unique
  name         String
  description  String
  content      String
  keywords     String[]
  active       Boolean  @default(true)
  priority     Int      @default(0)
  outputFormat String?  // "pdf" | "docx" | "xlsx" | null
  createdAt    DateTime @default(now()) @db.Timestamptz()
  updatedAt    DateTime @updatedAt @db.Timestamptz()

  @@index([active])
  @@map("prompt_templates")
}
```

- `outputFormat = null` → normal chat response (existing templates unaffected)
- `outputFormat = "pdf"` → triggers PDF conversion after AI responds
- `outputFormat = "docx"` → triggers DOCX conversion
- `outputFormat = "xlsx"` → triggers XLSX conversion

### Alternative: System KB (RAG) Approach

Instead of (or in addition to) PromptTemplate, we can add document generation instructions as **System Knowledge Base** entries:

```markdown
<!-- docs/system-kb/document-generation.md (synced to S3 → system KB) -->

# Document Generation Guidelines

When a user asks you to generate a document in a specific format (PDF, Word, Excel):

1. Write the content in clean, structured Markdown
2. Use proper headings, lists, tables, and formatting
3. Focus on professional, complete content
4. The system will handle the file conversion automatically
```

**Recommendation**: Use **PromptTemplate** as the primary mechanism (it has `outputFormat` to trigger conversion), and optionally add System KB entries for general document-writing guidelines that apply across all formats.

### Explicit API Parameter (SDK Users)

API users can also explicitly request a format without relying on keyword detection:

```json
{
  "model": "llama-3",
  "messages": [{ "role": "user", "content": "Write a PRD for a todo app" }],
  "output_format": "pdf"
}
```

When `output_format` is provided, it **overrides** template detection — the system skips keyword classification and directly converts the output to the requested format. The document-generation system prompt is still injected to ensure the AI writes clean Markdown.

---

## API Design

### Modified Chat Completions Response

The existing `POST /api/chat/completions` response gains an optional `document` field:

```json
{
  "id": "chatcmpl-xxx",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "# Product Requirements Document\n\n## Overview\n..."
      }
    }
  ],
  "document": {
    "id": "doc_abc123",
    "format": "pdf",
    "url": "https://s3.amazonaws.com/performa-docs/documents/doc_abc123.pdf?X-Amz-...",
    "filename": "product-prd.pdf",
    "expires_at": "2026-05-10T13:00:00Z"
  }
}
```

### Document Download

Documents are served **directly from S3** via presigned URLs — no download endpoint needed on our API.

- The `document.url` in the response is a **presigned S3 URL** (valid for 1 hour)
- Users download directly from S3 — no load on our server
- S3 lifecycle rule auto-deletes files after 24 hours
- Presigned URL is scoped to the specific object — no auth needed, unguessable

### Direct Export Endpoint (for re-exporting existing messages)

```
POST /api/export
```

```json
{
  "markdown": "# My Document\n\nContent here...",
  "format": "pdf",
  "filename": "my-document"
}
```

This lets users re-export any AI response in a different format without re-generating the content.

---

## Supported Formats

### PDF

- **Library**: `pdfkit` + `marked`
- **No Chromium** — pure JS, fast, low memory
- **Rendering**: Parse Markdown tokens with `marked` → render to PDF pages with `pdfkit`
- **Styling**: Clean document look — proper heading sizes, body text, monospace code blocks, bordered tables, bullet/numbered lists

### DOCX

- **Library**: `docx` (pure JS)
- **Flow**: `marked` parses Markdown → walk token tree → build DOCX paragraphs/runs
- **Features**: Headings (H1-H6), bold/italic, code blocks (shaded background), tables, bullet/numbered lists

### XLSX

- **Library**: `exceljs`
- **Use case**: When the AI generates tabular/structured data
- **Handling**: Extract Markdown tables → map to Excel sheets. If no tables found, put content in a single cell with text wrapping

---

## Backend Implementation

### Module Structure

```
apps/api/src/app/
├── document/
│   ├── document.module.ts
│   ├── document.controller.ts       # POST /api/export
│   ├── document.service.ts          # Orchestrates conversion + temp storage
│   ├── converters/
│   │   ├── converter.interface.ts
│   │   ├── pdf.converter.ts
│   │   ├── docx.converter.ts
│   │   └── xlsx.converter.ts
│   ├── dto/
│   │   └── export-request.dto.ts
│   └── s3/
│       └── document-s3.service.ts   # S3 upload + presigned URL generation
```

No `FormatDetectorService` — format detection is handled by the existing `PromptTemplateService.classify()` via keyword matching on the `document-pdf`, `document-docx`, `document-xlsx` templates.
No cleanup cron — S3 lifecycle rules handle auto-deletion.

### Integration with ChatService

The `ChatService` is modified minimally — it checks the matched template's `outputFormat` after getting the AI response:

```typescript
// In ChatService.createCompletion()

// Existing flow: apply prompt tuning (now also matches document templates)
const { tunedMessages, matchedTemplate } = await this.promptTuning.applyTuning(
  body.messages,
  user?.id,
);

// Call provider as usual
const providerResponse = await this.providerRouter.chat(modelConfig.provider, {
  model: body.model,
  messages: tunedMessages,
  ...
});

const aiContent = providerResponse.choices[0].message.content;

// Determine output format: explicit param > template detection
const outputFormat = body.output_format || matchedTemplate?.outputFormat || null;

// If a document format was requested, convert the Markdown
let document = null;
if (outputFormat) {
  document = await this.documentService.generate(aiContent, outputFormat, title);
}

return {
  ...providerResponse,
  ...(document && { document }),
};
```

**Key change to `PromptTuningService.applyTuning()`**: It now returns the matched template alongside the tuned messages, so `ChatService` can check `matchedTemplate.outputFormat`:

```typescript
// prompt-tuning.service.ts
async applyTuning(messages, userId?) {
  const template = await this.promptTemplate.classify(messages);
  // ... existing system prompt + RAG injection logic ...
  return { tunedMessages: result, matchedTemplate: template };
}
```

### DocumentService

```typescript
@Injectable()
export class DocumentService {
  private readonly converters: Map<string, DocumentConverter>;

  constructor(
    private readonly s3Service: DocumentS3Service,
  ) {}

  async generate(markdown: string, format: string, title?: string): Promise<DocumentMeta> {
    const converter = this.converters.get(format);
    const buffer = await converter.convert(markdown);
    const id = `doc_${randomUUID()}`;
    const filename = this.buildFilename(title, converter.extension);
    const s3Key = `documents/${id}.${converter.extension}`;

    // Upload to S3
    await this.s3Service.upload(s3Key, buffer, converter.mimeType, filename);

    // Generate presigned download URL (1 hour expiry)
    const url = await this.s3Service.getPresignedUrl(s3Key, filename, 3600);
    const expiresAt = new Date(Date.now() + 3600_000);

    return { id, format, url, filename, expires_at: expiresAt.toISOString() };
  }
}
```

### Converter Interface

```typescript
interface DocumentConverter {
  convert(markdown: string): Promise<Buffer>;
  readonly mimeType: string;
  readonly extension: string;
}
```

### DocumentS3Service

```typescript
@Injectable()
export class DocumentS3Service {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get('S3_DOCUMENTS_BUCKET');
    this.s3 = new S3Client({
      region: config.get('AWS_REGION'),
      credentials: {
        accessKeyId: config.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY'),
      },
    });
  }

  async upload(key: string, buffer: Buffer, contentType: string, filename: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ContentDisposition: `attachment; filename="${filename}"`,
    }));
  }

  async getPresignedUrl(key: string, filename: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }
}
```

### S3 Bucket Configuration

```json
{
  "Bucket": "performa-documents",
  "LifecycleConfiguration": {
    "Rules": [
      {
        "ID": "auto-delete-documents",
        "Prefix": "documents/",
        "Status": "Enabled",
        "Expiration": { "Days": 1 }
      }
    ]
  },
  "PublicAccessBlockConfiguration": {
    "BlockPublicAcls": true,
    "BlockPublicPolicy": true,
    "IgnorePublicAcls": true,
    "RestrictPublicBuckets": true
  }
}
```

- **Lifecycle rule**: Auto-delete all objects under `documents/` after 24 hours
- **No public access**: All access is via presigned URLs only
- **Region**: Same as the API server to minimize latency

### Environment Variables

```env
S3_DOCUMENTS_BUCKET=performa-documents
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
```

---

## Frontend (Chat Portal)

### Changes

1. **Format detection in UI**: When user's message matches a file format pattern, show a hint: *"Generating your document..."*
2. **Document message**: When `document` field exists, render a clean confirmation message + download button (no markdown content shown)
3. **Re-export menu**: On any AI message, user can right-click → "Download as PDF / DOCX / XLSX" (calls `POST /api/export` with the message content)

### Download Button Component

```tsx
// In message bubble component — when document is present, show confirmation instead of markdown
{message.document ? (
  <div className="flex flex-col gap-2">
    <p className="text-sm text-muted-foreground">
      Here's your document, generated as a {message.document.format.toUpperCase()}.
    </p>
    <a
      href={message.document.url}  // S3 presigned URL
      download={message.document.filename}
      className="inline-flex items-center gap-2 w-fit px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
    >
      <FileDown className="w-4 h-4" />
      Download {message.document.filename}
    </a>
  </div>
) : (
  // Normal message rendering (markdown)
  <MarkdownRenderer content={message.content} />
)}
```

### Re-export Flow

```typescript
const reExport = async (markdownContent: string, format: string) => {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown: markdownContent, format }),
  });
  const blob = await res.blob();
  // trigger browser download...
};
```

---

## Streaming Document Generation

When the AI streams its response, the system **buffers chunks** in real-time and generates the document as soon as the stream completes — no extra wait time for the user.

### Flow

```
Together AI stream starts
        │
        ▼
┌─────────────────────────────────────────┐
│  ChatService receives SSE chunks        │
│                                         │
│  chunk 1: "# Product R"    → buffer     │
│  chunk 2: "equirements\n"  → buffer     │
│  chunk 3: "## Overview"    → buffer     │
│  ...                       → buffer     │
│  [DONE]                    → flush      │
│                                         │
│  Full Markdown assembled from buffer    │
│          │                              │
│          ▼                              │
│  DocumentService.generate() ← async     │
│          │                              │
│          ▼                              │
│  Upload to S3 + presigned URL           │
└─────────────────────────────────────────┘
        │                    │
   SSE stream to user     Final SSE event:
   (real-time chunks)     { "document": { url, filename } }
```

### Implementation

```typescript
// In ChatService — streaming mode

async *createCompletionStream(body, user) {
  const { tunedMessages, matchedTemplate } = await this.promptTuning.applyTuning(
    body.messages,
    user?.id,
  );

  const outputFormat = body.output_format || matchedTemplate?.outputFormat || null;
  const markdownBuffer: string[] = [];

  // Stream chunks to client in real-time
  for await (const chunk of this.providerRouter.chatStream(modelConfig.provider, { ... })) {
    const content = chunk.choices[0]?.delta?.content || '';

    // Buffer content for document generation
    if (outputFormat && content) {
      markdownBuffer.push(content);
    }

    // Forward chunk to client immediately
    yield chunk;
  }

  // Stream done — generate document from buffered Markdown
  if (outputFormat && markdownBuffer.length > 0) {
    const fullMarkdown = markdownBuffer.join('');
    const document = await this.documentService.generate(fullMarkdown, outputFormat, title);

    // Send final SSE event with document download link
    yield {
      choices: [{ delta: {}, finish_reason: 'stop' }],
      document,
    };
  }
}
```

### SSE Event Sequence (Client Perspective)

When a document format is detected, the stream **does not render chunks in the chat bubble**. Instead, the client silently buffers and waits for the final event with the document link:

```
data: {"choices":[{"delta":{"content":"# Product "}}], "is_document": true}
data: {"choices":[{"delta":{"content":"Requirements\n"}}], "is_document": true}
...streaming continues (client buffers silently, no rendering)...
data: {"choices":[{"delta":{},"finish_reason":"stop"}], "document":{"url":"https://s3...","filename":"product-prd.pdf"}}
data: [DONE]
```

The `is_document: true` flag tells the frontend to skip rendering the streamed content.

### Frontend Handling

```typescript
// In chat portal — handle streaming response
const reader = response.body.getReader();
let document = null;
let isDocumentMode = false;

for await (const chunk of readSSEStream(reader)) {
  if (chunk.is_document) {
    // Document mode — don't render content in chat
    isDocumentMode = true;
    continue;
  }

  if (!isDocumentMode && chunk.choices[0]?.delta?.content) {
    // Normal chat — render markdown in bubble
    appendToMessage(chunk.choices[0].delta.content);
  }

  if (chunk.document) {
    // Stream complete — show friendly message + download button
    document = chunk.document;
  }
}

if (document) {
  setMessage({
    role: 'assistant',
    content: '', // no markdown content shown
    document,
  });
}
```

### Non-Streaming Fallback

For non-streaming requests (`stream: false`), the flow is simpler — wait for the full response, then convert:

```typescript
// Non-streaming: response already has full content
const aiContent = providerResponse.choices[0].message.content;
if (outputFormat) {
  const document = await this.documentService.generate(aiContent, outputFormat, title);
  return { ...providerResponse, document };
}
```

---

## Storage Strategy (S3)

Documents are stored in **S3** with a 24-hour lifecycle expiration:

| Aspect | Detail |
|--------|--------|
| **Storage** | S3 bucket (`performa-documents`) |
| **Path** | `documents/{doc_id}.{ext}` |
| **Access** | Presigned URLs only (no public access) |
| **URL Expiry** | 1 hour (presigned URL TTL) |
| **File Expiry** | 24 hours (S3 lifecycle rule auto-deletes) |
| **Cleanup** | Automatic — no cron job needed |

**Why S3:**
- Survives API restarts — no lost documents
- No memory pressure on the API server
- Downloads served directly by S3 — no bandwidth cost on our server
- Lifecycle rules handle cleanup automatically
- Already using S3 for System KB files — reuse existing AWS credentials

**Cost estimate**: ~1000 documents/day × 500KB avg × $0.023/GB = ~$0.01/day — negligible.

---

## Auth & Access Control

| User Type | Can Generate Documents? | Notes |
|-----------|------------------------|-------|
| Free (anonymous) | Yes | Uses free request quota. Document URL is unguessable UUID |
| Paid (logged in) | Yes | Normal billing applies. Document included in response |
| API key users | Yes | Use `output_format` field in request |

- Document generation costs nothing extra — it's the same chat request, just with a file conversion step
- The document download URL (S3 presigned URL) requires no auth — the signed URL expires in 1 hour, S3 deletes the file after 24 hours

---

## Dependencies (npm packages)

| Package | Purpose | Size |
|---------|---------|------|
| `marked` | Markdown parsing to token tree | ~40KB |
| `pdfkit` | PDF generation (pure JS, no Chromium) | ~1MB |
| `docx` | DOCX generation (pure JS) | ~300KB |
| `exceljs` | XLSX generation (pure JS) | ~2MB |
| `@aws-sdk/client-s3` | S3 upload/download operations | ~200KB |
| `@aws-sdk/s3-request-presigner` | Generate presigned URLs | ~50KB |

All pure JS — no native binaries, no headless browser, Docker-friendly.

---

## Security Considerations

- **Input sanitization**: Strip `<script>`, HTML event handlers, and other dangerous content from Markdown before conversion
- **File size cap**: Limit AI response to 50,000 characters for document conversion (prevent memory abuse)
- **Rate limiting**: Existing throttler guard applies (60 req/min global, 30/min per endpoint)
- **Document URL security**: S3 presigned URLs are cryptographically signed + time-limited (1 hour). Files auto-deleted after 24 hours
- **No user-controlled S3 keys**: Keys are server-generated (`documents/{uuid}.{ext}`)
- **S3 bucket locked down**: No public access, presigned URLs only
- **No direct file system writes**: Documents go straight to S3, never touch local disk

---

## Implementation Phases

### Phase 1: Core Document Generation (PDF)

- [ ] Add `outputFormat` column to `PromptTemplate` schema (migration)
- [ ] Seed `document-pdf`, `document-docx`, `document-xlsx` prompt templates
- [ ] Modify `PromptTuningService.applyTuning()` to return matched template
- [ ] Create `DocumentModule` with controller, service
- [ ] Build PDF converter (`pdfkit` + `marked`)
- [ ] Create `DocumentS3Service` for S3 upload + presigned URL generation
- [ ] Set up S3 bucket with lifecycle rule (24h auto-delete)
- [ ] Integrate with `ChatService` — check `matchedTemplate.outputFormat`, add `document` field to response
- [ ] Add `output_format` param to chat completions DTO
- [ ] Add download button in chat portal UI

### Phase 2: DOCX + XLSX Converters

- [ ] Build DOCX converter with `docx` library
- [ ] Build XLSX converter with `exceljs`
- [ ] Test with complex Markdown (code blocks, nested lists, tables)

### Phase 3: Re-export Endpoint

- [ ] Add `POST /api/export` for converting raw Markdown to any format
- [ ] Add right-click "Download as..." menu on AI messages in chat portal

### Phase 4: Polish

- [ ] UI hint when format is detected from prompt
- [ ] Better PDF styling (custom fonts, page numbers, headers/footers)
- [ ] Error handling for edge cases (empty response, unsupported content)

---

## Future Considerations

- **HTML export**: Render Markdown to styled HTML page
- **Presentation (PPTX)**: Generate slide decks from structured Markdown
- **Custom templates**: Let users upload branded PDF/DOCX templates
- **R2 migration**: Move from AWS S3 to Cloudflare R2 if cost becomes a concern
- **Webhook delivery**: POST the generated document to a user-specified URL
