/** RNX-121b-1 (D46): the platform settings an agent call reads its limits from, in PeerRunLimits order; a missing row makes agent calls unavailable. RNX-326: the run's model-call cap and run time too. */
export const PEER_RUN_LIMIT_SETTINGS = ["peerRunMaxDepth", "peerRunMaxAgentCalls", "peerRunCallTimeoutSeconds", "peerRunMaxModelCalls", "peerRunMaxMinutes"] as const;
