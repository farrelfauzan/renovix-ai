-- RX-1: the code_exec agent tool was removed (remote code execution).
-- Data-only: no schema change. Rows are kept (disabled), not deleted.
-- Rollback is not meaningful: the tool no longer exists in the code.
UPDATE "agent_tools" SET "enabled" = false WHERE "tool_type" = 'code_exec' AND "enabled" = true;
