import type { ChildRunInput } from "./child-run-input";

/**
 * RNX-121b-1: a hop that has ended, kept until its parent's row exists: what its child run records (RNX-302) and the
 * hops it made itself, in order.
 */
export type PeerHop = Omit<ChildRunInput, "parentRunId" | "userId"> & {
  readonly children: readonly PeerHop[];
};
