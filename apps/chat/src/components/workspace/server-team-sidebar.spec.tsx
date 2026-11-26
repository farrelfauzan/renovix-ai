/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ServerTeamSidebar } from './server-team-sidebar';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
const mockRemoveMember = jest.fn();
const mockResend = jest.fn();
const mockRevoke = jest.fn();
const mockDeleteKb = jest.fn();
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('./workspace-knowledge-dialog', () => ({ WorkspaceKnowledgeDialog: () => null }));
jest.mock('@/hooks/use-workspace-knowledge', () => ({
  useWorkspaceKnowledgeBases: () => ({ data: [{ id: 'kb1', name: 'Handbook', _count: { chunks: 3 } }] }),
  useDeleteWorkspaceKB: () => ({ mutate: mockDeleteKb, isPending: false }),
}));
jest.mock('@/hooks/use-workspaces', () => ({
  useChannelWorkspace: () => ({ data: { exists: true }, isLoading: false }),
  useWorkspaceMembers: () => ({ data: [{ id: 'm2', role: 'member', user: { email: 'dewi@example.test' } }] }),
  useWorkspaceInvites: () => ({ data: [{ id: 'i1', email: 'budi@example.test', status: 'pending' }] }),
  useWorkspaceQuota: () => ({ data: undefined }),
  useCreateChannelWorkspace: () => ({ mutate: jest.fn(), isPending: false }),
  useInviteMember: () => ({ mutate: jest.fn(), isPending: false }),
  useResendInvite: () => ({ mutate: mockResend, isPending: false }),
  useRevokeInvite: () => ({ mutate: mockRevoke, isPending: false }),
  useUpdateMember: () => ({ mutate: jest.fn(), isPending: false }),
  useRemoveMember: () => ({ mutate: mockRemoveMember, isPending: false }),
}));

afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('each hover-only icon button keeps its handler, has a tooltip with the short title, a row-specific accessible name and no native title', () => {
  render(<ServerTeamSidebar channelId="ch1" isOwner onClose={jest.fn()} embedded />);
  const inputRows: [string, string, jest.Mock][] = [
    ['Remove dewi@example.test', 'Remove', mockRemoveMember],
    ['Resend invite budi@example.test', 'Resend', mockResend],
    ['Revoke invite budi@example.test', 'Revoke', mockRevoke],
    ['Delete Handbook', 'Delete', mockDeleteKb],
  ];
  inputRows.forEach(([inputName, expectedTooltip, mockHandler]) => {
    const actualButton = screen.getByRole('button', { name: inputName });
    expect(actualButton.textContent).toBe('');
    expect(actualButton.hasAttribute('title')).toBe(false);
    expect(tooltipOf(actualButton)).toBe(expectedTooltip);
    fireEvent.click(actualButton);
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });
  expect(tooltipOf(screen.getByRole('button', { name: 'Add knowledge to Handbook' }))).toBe('Add knowledge');
});
