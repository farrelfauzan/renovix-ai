import { ForbiddenException, NotFoundException } from "@nestjs/common";

/**
 * RNX-119: a run (by id) is read or deleted only by the person who ran it. 404 when there is no such run of the agent;
 * 403 when it is another person's (the caller is inside the workspace, but it is not their run).
 */
export function assertOwnRun<T extends { readonly userId: string }>(run: T | null, userId: string): asserts run is T {
  if (!run) throw new NotFoundException("Run not found");
  if (run.userId !== userId) throw new ForbiddenException("This run belongs to another person");
}
