/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { WorkspaceInvitesTab } from './workspace-invites-tab';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
const mockResend = jest.fn();
const mockRevoke = jest.fn();
let mockResendPending = false;
let mockRevokePending = false;
jest.mock('@/hooks/use-workspaces', () => ({
  useResendInvite: () => ({ mutate: mockResend, isPending: mockResendPending }),
  useRevokeInvite: () => ({ mutate: mockRevoke, isPending: mockRevokePending }),
}));
jest.mock('./workspace-invite-dialog', () => ({ WorkspaceInviteDialog: () => null }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const invites = [{ id: 'i1', workspaceId: 'w1', email: 'budi@example.test', role: 'member', status: 'pending', expiresAt: '2026-12-01T00:00:00Z', createdAt: '' }] as any;
afterEach(() => { cleanup(); jest.clearAllMocks(); mockResendPending = false; mockRevokePending = false; });

it('Resend and Revoke are icon-only buttons named by the invite, with tooltips, and send the same requests', () => {
  render(<WorkspaceInvitesTab workspaceId="w1" invites={invites} />);
  const resendButton = screen.getByRole('button', { name: 'Resend invite budi@example.test' });
  const revokeButton = screen.getByRole('button', { name: 'Revoke invite budi@example.test' });
  expect(resendButton.textContent).toBe('');
  expect(revokeButton.textContent).toBe('');
  expect(tooltipOf(resendButton)).toBe('Resend');
  expect(tooltipOf(revokeButton)).toBe('Revoke');
  fireEvent.click(resendButton);
  fireEvent.click(revokeButton);
  expect(mockResend).toHaveBeenCalledWith({ workspaceId: 'w1', inviteId: 'i1' }, expect.any(Object));
  expect(mockRevoke).toHaveBeenCalledWith({ workspaceId: 'w1', inviteId: 'i1' }, expect.any(Object));
});

it('each is disabled only while its own request is pending', () => {
  mockResendPending = true;
  const { rerender } = render(<WorkspaceInvitesTab workspaceId="w1" invites={invites} />);
  expect((screen.getByRole('button', { name: 'Resend invite budi@example.test' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Revoke invite budi@example.test' }) as HTMLButtonElement).disabled).toBe(false);
  mockResendPending = false;
  mockRevokePending = true;
  rerender(<WorkspaceInvitesTab workspaceId="w1" invites={invites} />);
  expect((screen.getByRole('button', { name: 'Resend invite budi@example.test' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'Revoke invite budi@example.test' }) as HTMLButtonElement).disabled).toBe(true);
});
