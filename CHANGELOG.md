# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-06-02

### Added

- **Document Generation (Chat Portal)**: Users can now generate PDF, DOCX, and XLSX documents directly from the chat portal
  - Portal detects document intent via `PromptTemplate.outputFormat` matching (e.g., "Create me a PDF for my PRD")
  - Accumulates LLM response without streaming raw markdown to user
  - Converts markdown to file via `DocumentService.generateWithStorage()` and emits download link via SSE
  - Works for both free-tier and paid-tier portal users
  - Frontend already handles `document` SSE event and renders `DocumentCard` with download button

- **`create_document` Agent Tool**: New built-in tool auto-injected for all agents
  - LLM can explicitly call `create_document` with `content`, `format`, and optional `filename`
  - Generates PDF/DOCX/XLSX via `DocumentService`, uploads to S3, returns presigned URL
  - Agent run controller checks `toolService.getLastDocumentResult()` after each run and emits document event
  - Eliminates dependency on fragile LLM-based `classifyDocumentIntent()` classifier

### Fixed

- **Portal document flow**: Previously, `PromptTuningService.applyTuning()` returned `matchedTemplate` with `outputFormat` but the portal controller completely ignored it — raw markdown was streamed to the user with no file conversion
- **Agent document reliability**: Document generation previously relied solely on a separate LLM classifier call (`classifyDocumentIntent`) which could silently fail or misclassify, resulting in no document being generated

## [0.0.2] - 2026-06-02

### Fixed

- **Auth**: Fix SSO session loss on page navigation (Google/GitHub login requiring re-auth on every page)
  - Fix `Set-Cookie` header corruption in BetterAuthController — multiple headers were merged into one unparseable value
  - Add `credentials: "include"` to Better Auth client for cross-origin cookie transmission
  - Add hydration guard to top-up page to prevent false login redirect before state rehydrates
  - Configure cross-subdomain cookies (`SameSite`, `Secure`, domain) for production deployment
  - Enable session cookie caching (5min) to reduce database lookups

[0.1.4]: https://github.com/farrelfauzan/renovix-ai/compare/v0.0.4...v0.1.4
[0.0.2]: https://github.com/farrelfauzan/renovix-ai/compare/v0.0.1...v0.0.2
