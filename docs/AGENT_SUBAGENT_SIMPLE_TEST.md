# Agent + Sub-Agent Simple Interaction Test

> **Obsolete since RNX-118.** Parent and sub-agents (`agentType`, `parentAgentId`), the `delegate_to_subagent` tool and
> forced delegation by keyword were removed. An agent now calls the agents it is linked to ("Can call",
> `POST /agents/:id/links`, workspace owner only) with the `call_agent` tool, offered only when the runner is the
> workspace owner or a current collaborator; a message saying "delegate" or "delegasikan" no longer forces a call.
> The automated checks are `apps/api/src/app/agent/service/agent-run.agent-links.spec.ts` and
> `apps/api/src/app/channel/service/channel-chat.agent-links.spec.ts`. The steps below describe the old behaviour.

## Goal
Verify that a parent agent can delegate a task to a linked sub-agent and return the result.

## Preconditions
- Parent agent is set to type: `parent`.
- At least one linked sub-agent exists and is active.
- Parent agent has tool: `delegate_to_subagent` enabled.
- API has been restarted after the latest backend changes.

## Test 1 (Real User Style)
Use this natural prompt in the parent agent chat:

> Tolong delegasikan riset pengenalan TypeScript (kulit materi, dangkal) ke sub-agent yang paling cocok, lalu berikan hasil ringkas dalam bahasa Indonesia.

## Expected Result for Test 1
- Parent chooses a configured sub-agent (not an invented one).
- Parent performs delegation without asking unnecessary clarification first.
- Final output returns short TypeScript introduction content in Indonesian.
- Response reflects actual execution, not intent-only text.

## Test 2 (Diagnostic Fallback)
Run this only if Test 1 still looks ambiguous:

> Delegate immediately using `delegate_to_subagent` (no confirmation question). Use the Research sub-agent. Task: find 3 short facts about TypeScript. Return format:
> DELEGATED_TO: <sub-agent-id-or-name>
> EXECUTED: yes|no
> REASON: <only if no>
> RESULT:
> - <fact 1>
> - <fact 2>
> - <fact 3>

## Expected Result for Test 2
- `DELEGATED_TO` is filled with a real configured sub-agent.
- `EXECUTED` is `yes`.
- `RESULT` contains exactly 3 short bullet points.

If you only get text like "I will use research-agent" without execution evidence, treat it as failed delegation (intent only).

## Pass/Fail Checklist
- [ ] Parent recognized available sub-agent.
- [ ] Delegation occurred.
- [ ] Final output returned to user.
- [ ] Output quality is correct for requested depth (intro-level).

## Optional DB Check (if needed)
If you want to verify relation in DB quickly:

```sql
SELECT child.id AS sub_agent_id,
       child.name AS sub_agent_name,
       parent.id AS parent_agent_id,
       parent.name AS parent_agent_name
FROM agents child
JOIN agents parent ON parent.id = child.parent_agent_id
ORDER BY parent.name, child.name;
```
