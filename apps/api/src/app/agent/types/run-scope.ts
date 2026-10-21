/**
 * RNX-119 (D257): where a run happens, from the run policy (AgentRunPolicyService). "inside": the runner is the
 * agent's workspace owner or a current collaborator there (owner's plan allows collaboration, D64); the run uses the
 * workspace's memory and linked agents. "outside": anyone else running a public active agent; the agent stands alone
 * (R17: no workspace memory read or written, no linked agents).
 */
export type RunScope = "inside" | "outside";
