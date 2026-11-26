/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AccountMcpProviderCard } from './account-mcp-provider-card';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
jest.mock('@/components/settings/mcp-workspace-switches', () => ({ McpWorkspaceSwitches: () => null }));
jest.mock('@/components/agents/agent-detail/integration-provider-logo', () => ({ IntegrationProviderLogo: () => null }));

const entry = { displayName: 'Gmail', name: 'google-gmail', description: 'Mail', package: 'p', envKeys: [], authType: 'oauth' } as any;
afterEach(cleanup);

it('not connected: Connect is an icon-only button named by its provider and runs the connect action', () => {
  const onConnectAction = jest.fn();
  render(<AccountMcpProviderCard entry={entry} credential={undefined} workspaces={[]} onConnectAction={onConnectAction} onDisconnectAction={jest.fn()} />);
  const actualButton = screen.getByRole('button', { name: 'Connect Gmail' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Connect');
  fireEvent.click(actualButton);
  expect(onConnectAction).toHaveBeenCalledTimes(1);
});

it('connected: Disconnect is an icon-only button named by its provider and runs the disconnect action', () => {
  const onDisconnectAction = jest.fn();
  render(<AccountMcpProviderCard entry={entry} credential={{ workspaceIds: [] } as any} workspaces={[]} onConnectAction={jest.fn()} onDisconnectAction={onDisconnectAction} />);
  const actualButton = screen.getByRole('button', { name: 'Disconnect Gmail' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Disconnect');
  fireEvent.click(actualButton);
  expect(onDisconnectAction).toHaveBeenCalledTimes(1);
});
