import type { CallAgentArgsDto } from "../dto/call-agent-args.dto";

/** RNX-121b-1: the only input a called agent gets (never its caller's history): the task, naming the caller, and the optional context. */
export function toCalleeInput(callerName: string, args: CallAgentArgsDto): string {
  return `Task from agent "${callerName}": ${args.task}${args.context ? `\n\nContext: ${args.context}` : ""}`;
}
