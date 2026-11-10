import { AGENT_RUN_MAX_STEPS_MESSAGE } from "../../agent/config/agent-run-max-steps-message";
import { AGENT_RUN_MAX_TOOL_ITERATIONS } from "../../agent/config/agent-run-max-tool-iterations";
import { TOOL_RESULT_MAX_CHARS } from "../../agent/config/tool-result-max-chars";
import { CHANNEL_CHAT_MAX_STEPS_MESSAGE } from "../../channel/config/channel-chat-max-steps-message";
import { CHANNEL_CHAT_MAX_TOOL_ITERATIONS } from "../../channel/config/channel-chat-max-tool-iterations";
import { REMINDER_MAX_STEPS_MESSAGE } from "../../reminder/config/reminder-max-steps-message";
import { REMINDER_MAX_TOOL_ITERATIONS } from "../../reminder/config/reminder-max-tool-iterations";
import type { ChatEngineLoopProfile } from "../types/chat-engine-loop-profile";
import type { ChatEngineRequest } from "../types/chat-engine-request";

/**
 * RNX-283: each source's tool loop as its legacy loop runs today (docs/testing.md, RNX-16 index and "AR and CH
 * differences"): agent-run.service.ts (AR), channel-chat.service.ts (CH) and reminder.scheduler.ts (RM). The portal has
 * no tool loop (one call, no tools) and no profile.
 */
export const CHAT_ENGINE_LOOP_PROFILES: Partial<Record<ChatEngineRequest["source"], ChatEngineLoopProfile>> = {
  "agent-run": {
    maxIterations: AGENT_RUN_MAX_TOOL_ITERATIONS,
    agentCallExtraIterations: 2,
    continuesOnLength: false,
    toolResultMaxChars: null,
    throwsOnMissingChoice: true,
    maxStepsMessage: AGENT_RUN_MAX_STEPS_MESSAGE,
  },
  "channel-chat": {
    maxIterations: CHANNEL_CHAT_MAX_TOOL_ITERATIONS,
    agentCallExtraIterations: 0,
    continuesOnLength: true,
    toolResultMaxChars: TOOL_RESULT_MAX_CHARS,
    throwsOnMissingChoice: false,
    maxStepsMessage: CHANNEL_CHAT_MAX_STEPS_MESSAGE,
  },
  reminder: {
    maxIterations: REMINDER_MAX_TOOL_ITERATIONS,
    agentCallExtraIterations: 0,
    continuesOnLength: false,
    toolResultMaxChars: TOOL_RESULT_MAX_CHARS,
    throwsOnMissingChoice: false,
    maxStepsMessage: REMINDER_MAX_STEPS_MESSAGE,
  },
};
