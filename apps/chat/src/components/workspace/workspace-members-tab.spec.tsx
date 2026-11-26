/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { WorkspaceMembersTab } from './workspace-members-tab';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
const mockRemove = jest.fn();
jest.mock('@/hooks/use-workspaces', () => ({ useRemoveMember: () => ({ mutate: mockRemove }), useUpdateMember: () => ({ mutate: jest.fn() }) }));
jest.mock('./workspace-invite-dialog', () => ({ WorkspaceInviteDialog: () => null }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const members = [
  { id: 'm1', role: 'owner', joinedAt: '2026-11-01T00:00:00Z', user: { email: 'owner@example.test' } },
  { id: 'm2', role: 'member', joinedAt: '2026-11-02T00:00:00Z', user: { email: 'dewi@example.test' } },
] as any;
afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('Remove is an icon-only button named by the member (none for the owner), asks first, then removes that member', () => {
  render(<WorkspaceMembersTab workspaceId="w1" members={members} />);
  expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);
  const actualButton = screen.getByRole('button', { name: 'Remove dewi@example.test' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Remove');
  fireEvent.click(actualButton);
  const dialog = screen.getByRole('alertdialog');
  expect(dialog.textContent).toContain('dewi@example.test');
  expect(mockRemove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
  expect(mockRemove).toHaveBeenCalledWith({ workspaceId: 'w1', memberId: 'm2' }, expect.any(Object));
});
