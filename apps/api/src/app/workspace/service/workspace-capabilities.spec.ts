import { WorkspaceService } from './workspace.service';

describe('workspace detail read capabilities', () => {
  const prisma = { workspace: { findFirst: jest.fn() } };
  const quota = { enforceCollaboration: jest.fn(), isCollaborationAllowed: jest.fn() };
  const service = new WorkspaceService(prisma as never, quota as never, {} as never);
  beforeEach(() => jest.resetAllMocks());

  it.each([
    ['owner', true, 'owner'],
    ['owner', false, 'owner'],
    ['member', true, 'member'],
  ])('reports existing policy for caller %s collaboration %s', async (caller, collaborationAllowed, effectiveRole) => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'workspace', ownerId: 'owner' });
    quota.isCollaborationAllowed.mockResolvedValue(collaborationAllowed);
    expect(await service.getById('workspace', caller)).toMatchObject({ collaborationAllowed, effectiveRole });
    expect(quota.isCollaborationAllowed).toHaveBeenCalledWith('workspace');
    expect(quota.enforceCollaboration).toHaveBeenCalledTimes(caller === 'owner' ? 0 : 1);
  });

  it('does not reveal capabilities for a nonmember', async () => {
    prisma.workspace.findFirst.mockResolvedValue(null);
    await expect(service.getById('workspace', 'outsider')).rejects.toThrow('Workspace not found');
    expect(quota.isCollaborationAllowed).not.toHaveBeenCalled();
  });

  it('retains denied collaboration before returning any capabilities', async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: 'workspace', ownerId: 'owner' });
    quota.enforceCollaboration.mockRejectedValue(new Error('Forbidden'));
    await expect(service.getById('workspace', 'member')).rejects.toThrow('Forbidden');
    expect(quota.isCollaborationAllowed).not.toHaveBeenCalled();
  });
});
