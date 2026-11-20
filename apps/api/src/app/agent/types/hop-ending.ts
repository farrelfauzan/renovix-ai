import type { ChildRunStatus } from "./child-run-status";

/** RNX-121b-1: how a called agent's run ended: its status, the tool result its caller gets, and the error when it failed (null when it completed). */
export type HopEnding = {
  readonly status: ChildRunStatus;
  readonly answer: string;
  readonly failure: unknown;
};
