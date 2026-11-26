/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { KeyRow } from './key-row';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;

const apiKey = { id: 'key-1', name: 'Inventory sync', prefix: 'abcd1234', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null, revokedAt: null, expiresAt: null, allowedTiers: ['standard'], monthlyCreditCap: null, creditsLast30Days: '4.2' };
afterEach(cleanup);

it('Revoke is an icon-only button named by its key, with the tooltip "Revoke", and asks before revoking', () => {
  const onRevokeAction = jest.fn();
  render(<table><tbody><KeyRow apiKey={apiKey} onRevokeAction={onRevokeAction} /></tbody></table>);
  const actualButton = screen.getByRole('button', { name: 'Revoke key Inventory sync' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Revoke');
  fireEvent.click(actualButton);
  expect(onRevokeAction).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke' }));
  expect(onRevokeAction).toHaveBeenCalledWith('key-1');
});
