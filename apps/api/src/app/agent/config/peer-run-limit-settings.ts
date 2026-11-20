/** RNX-121b-1 (D46): the platform settings an agent call reads its limits from, in PeerRunLimits order; a missing row makes agent calls unavailable. */
export const PEER_RUN_LIMIT_SETTINGS = ["peerRunMaxDepth", "peerRunMaxAgentCalls", "peerRunCallTimeoutSeconds"] as const;
