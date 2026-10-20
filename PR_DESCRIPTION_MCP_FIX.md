# Fix: Enable MCP Tool Discovery & Resolve XLSX Duplicate Sheet Names

## Summary
This PR fixes two critical issues preventing MCP tools (Google Sheets, etc.) from being discovered during agent execution and resolves XLSX generation failures when multiple tables share the same heading.

## Issues Addressed

### 1. MCP Tools Not Discovered in Chat Flow
**Problem**: Diagnostic logs showed `foundProviders=0` even when MCP credentials were connected, because `workspaceId` was not being passed to `buildToolSchemasWithMcp()`.

**Root Cause**: The channel-chat service was attempting to access `agent.workspaceId`, but the Agent model's workspace relationship was not being loaded in the channel context. The correct workspace ID needed to be retrieved from `channelAgent.channel.workspace.id`.

**Impact**: 
- Users could not access MCP-based document generation (Google Sheets, etc.)
- Only built-in tools were available (7 tools: web_search, calculator, knowledge_retrieval, memory_store, delegate_to_subagent, code_exec, create_reminder, create_document)
- Error: `[buildToolSchemasWithMcp] Skipping MCP discovery: userId=SET workspaceId=MISSING`

### 2. XLSX Generation Failures with Duplicate Table Headings
**Problem**: When markdown content contained multiple tables with the same heading, the XLSX converter would crash with:
```
Worksheet name already exists: Monthly Financial Snapshot
```

**Root Cause**: The `sanitizeSheetName()` function would return the same name for multiple tables with identical headings, but ExcelJS does not allow duplicate worksheet names.

**Impact**: Users could not generate XLSX documents with repeated section headings (e.g., multiple "Monthly Financial Snapshot" tables in different sections).

---

## Changes Made

### 1. Channel Service: Load Workspace Relation
**File**: `apps/api/src/app/channel/channel.service.ts`

- Updated `resolveChannelAgent()` to include `workspace` in the channel query
- Added `workspace` to the nested channel include in channelAgent query
- This ensures workspace ID is available throughout the chat flow

```typescript
// Before: No workspace loaded
const channel = await this.prisma.channel.findFirst({
  where: { id: channelId, userId },
});

// After: Workspace included
const channel = await this.prisma.channel.findFirst({
  where: { id: channelId, userId },
  include: { workspace: true },
});
```

### 2. Channel Chat Service: Extract & Pass Workspace ID
**File**: `apps/api/src/app/channel/channel-chat.service.ts`

- Extract `workspaceId` from `channelAgent.channel.workspace.id` before calling `buildToolSchemasWithMcp()`
- Pass extracted workspace ID to tool schema builder

```typescript
// Before: Attempting to use undefined agent.workspaceId
const toolSchemas = await this.toolService.buildToolSchemasWithMcp(
  agent.tools,
  agent.id,
  userId,
  agent.workspaceId || undefined,  // ← Always undefined
  { injectDelegation: ... }
);

// After: Using channel's workspace relationship
const workspaceId = channelAgent.channel?.workspace?.id || undefined;
const toolSchemas = await this.toolService.buildToolSchemasWithMcp(
  agent.tools,
  agent.id,
  userId,
  workspaceId,  // ← Now correctly populated
  { injectDelegation: ... }
);
```

### 3. XLSX Converter: Deduplicate Sheet Names
**File**: `apps/api/src/app/document/converters/xlsx.converter.ts`

- Implemented sheet name deduplication using a `Set` to track used names
- When a duplicate is detected, append a counter: `"Monthly Financial Snapshot"`, `"Monthly Financial Snapshot 2"`, etc.
- Ensures all sheet names are unique within the workbook (required by ExcelJS)

```typescript
const usedNames = new Set<string>();

tables.forEach((table, i) => {
  let sheetName = this.sanitizeSheetName(table.title || `Sheet${i + 1}`);

  // If name already exists, append a counter
  let counter = 1;
  const originalName = sheetName;
  while (usedNames.has(sheetName)) {
    sheetName = `${originalName.substring(0, 28)} ${++counter}`;
  }
  usedNames.add(sheetName);

  const sheet = workbook.addWorksheet(sheetName);
  // ... rest of sheet creation
});
```

### 4. Agent Tool Service: Enhanced Diagnostics
**File**: `apps/api/src/app/agent/agent-tool.service.ts`

- Added comprehensive logging for MCP discovery flow:
  - When discovery is skipped (missing userId/workspaceId)
  - Number of providers found
  - Clear message when no providers connected
  - Per-provider connection logs

```typescript
// Diagnostic logging:
if (userCredMap.size === 0) {
  this.logger.info(
    `[buildToolSchemasWithMcp] No MCP providers connected for this user/workspace. Using only built-in tools (${schemas.length}).`
  );
  return schemas;
}
```

---

## Testing Recommendations

1. **MCP Tool Discovery**:
   - Connect an MCP provider (e.g., Google Sheets OAuth) to a test user
   - Run agent chat with document generation request
   - Verify logs show `foundProviders=1` (or higher)
   - Confirm MCP tools appear in the tools list (>7 total)

2. **XLSX Generation**:
   - Request XLSX document with markdown containing multiple tables with same heading
   - Verify document generates without errors
   - Confirm Excel file has correctly named sheets (e.g., "Monthly Financial Snapshot", "Monthly Financial Snapshot 2")

3. **Fallback Behavior**:
   - Without MCP credentials connected, document generation should still work
   - XLSX, PDF, and DOCX formats should all work with duplicate headings

---

## Backwards Compatibility
✅ **Fully backwards compatible**
- Built-in tools continue to work as before
- No schema changes
- MCP discovery is opt-in (only activates if credentials connected)
- XLSX fix is transparent to users

---

## Related Issues
- Users unable to generate documents with MCP providers
- XLSX generation crashes with duplicate table headings
- Agent tool discovery incomplete without workspace context

## Notes
- Agent model in other services (agent-run.service.ts, reminder.scheduler.ts) already includes workspaceId directly, so no changes needed there
- The workspace ID was already being stored on Agent records; we just needed to fetch it correctly through the channel relationship
