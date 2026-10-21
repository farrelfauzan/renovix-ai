/** RNX-119: what the run policy reads of an agent: its workspace, and whether it is published (public and active). */
export type RunPolicyAgent = {
  readonly workspaceId: string;
  readonly isPublic: boolean;
  readonly status: string;
};
