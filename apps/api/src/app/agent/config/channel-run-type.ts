/**
 * RNX-24a (D380): the `channel_type` of a channel chat's top-level agent_runs row, written only so the run's agent calls
 * (child runs) have a parent. It is not one of the agent's own runs: the agent's run list and session lookup skip it.
 */
export const CHANNEL_RUN_TYPE = "channel";
