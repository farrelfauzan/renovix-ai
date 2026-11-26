/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LinkedProviderRow } from './linked-provider-row';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
const mockLink = jest.fn();
const mockUnlink = jest.fn();
let mockLinkPending = false;
let mockUnlinkPending = false;
jest.mock('@/hooks/use-link-account', () => ({ useLinkAccount: () => ({ mutate: mockLink, isPending: mockLinkPending }) }));
jest.mock('@/hooks/use-unlink-account', () => ({ useUnlinkAccount: () => ({ mutate: mockUnlink, isPending: mockUnlinkPending }) }));
afterEach(() => { cleanup(); jest.clearAllMocks(); mockLinkPending = false; mockUnlinkPending = false; });

it('not connected: Connect is an icon-only button with a tooltip, links the provider, and is disabled while linking', () => {
  render(<LinkedProviderRow provider="github" label="GitHub" isLinked={false} isOnlyMethod={false} />);
  const actualButton = screen.getByRole('button', { name: 'Connect' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Connect');
  fireEvent.click(actualButton);
  expect(mockLink).toHaveBeenCalledWith('github');
  cleanup();
  mockLinkPending = true;
  render(<LinkedProviderRow provider="github" label="GitHub" isLinked={false} isOnlyMethod={false} />);
  expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);
});

it('connected: Disconnect is an icon-only button with a tooltip, unlinks, and is disabled when it is the only method or while unlinking', () => {
  render(<LinkedProviderRow provider="google" label="Google" isLinked isOnlyMethod={false} />);
  const actualButton = screen.getByRole('button', { name: 'Disconnect' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Disconnect');
  expect((actualButton as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(actualButton);
  expect(mockUnlink).toHaveBeenCalledWith('google');
  cleanup();
  render(<LinkedProviderRow provider="google" label="Google" isLinked isOnlyMethod />);
  expect((screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  mockUnlinkPending = true;
  render(<LinkedProviderRow provider="google" label="Google" isLinked isOnlyMethod={false} />);
  expect((screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement).disabled).toBe(true);
});
