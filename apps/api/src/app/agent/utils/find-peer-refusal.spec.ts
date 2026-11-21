import { PEER_CALL_MESSAGES } from "../config/peer-call-messages";
import type { PeerCall } from "../types/peer-call";
import { findPeerRefusal } from "./find-peer-refusal";

// RNX-121b-1: why an agent call may not run: a cycle, the depth limit or the run's agent-call limit (in that order).
describe("findPeerRefusal", () => {
  const limits = { maxDepth: 2, maxAgentCalls: 3, callTimeoutMs: 1_000, maxModelCalls: 30, maxRunMs: 300_000 };
  const inputCall = ({ stack = ["a"], depth = 0, agentCalls = 0, calleeId = "b" } = {}) =>
    ({ frame: { state: { stack, agentCalls }, depth }, callee: { id: calleeId } }) as unknown as PeerCall;

  it.each([
    ["a callee on the call stack (a cycle)", inputCall({ stack: ["a", "b"], depth: 1 }), PEER_CALL_MESSAGES.cycle],
    ["a call one level below the deepest allowed", inputCall({ depth: 2 }), PEER_CALL_MESSAGES.depthLimit],
    ["a run that has started as many calls as it may", inputCall({ agentCalls: 3 }), PEER_CALL_MESSAGES.agentCallLimit],
    ["a call within every limit", inputCall({ depth: 1, agentCalls: 2 }), null],
  ])("%s", (_case, call, expected) => {
    const actual = findPeerRefusal(call, limits);

    expect(actual).toBe(expected);
  });
});
