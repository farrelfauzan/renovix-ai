/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentSettingsPanel } from './agent-settings-panel';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => mockApi.get(...a), post: (...a: unknown[]) => mockApi.post(...a), delete: (...a: unknown[]) => mockApi.delete(...a) } }));
jest.mock('@/lib/stores', () => ({ useAuthStore: () => ({ isLoggedIn: () => true }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  mockApi.get.mockImplementation(async (url: string) => {
    if (url === '/mcp/servers') return [{ id: 'srv1', name: 'linear', displayName: 'Linear', transport: 'stdio', isGlobal: false, status: 'connected', createdAt: '' }];
    if (url === '/mcp/registry') return { notion: { displayName: 'Notion', description: 'Pages', package: 'p', envKeys: ['NOTION_TOKEN'], authType: 'token' } };
    return { exists: true, workspace: { id: 'ws-1' } };
  });
  mockApi.post.mockResolvedValue({ connected: true, provider: 'notion' });
  mockApi.delete.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); jest.clearAllMocks(); });

it('AC10: lists the workspace servers, disconnects one, and connects a token provider for its workspace', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AgentSettingsPanel channelId="ch1" /></QueryClientProvider>);
  expect(await screen.findByText('Linear')).toBeTruthy();
  const test = screen.getByRole('button', { name: 'Test connection Linear' });
  expect(test.textContent).toBe('');
  expect(tooltipOf(test)).toBe('Test connection');
  const disconnect = screen.getByRole('button', { name: 'Disconnect Linear' });
  expect(disconnect.textContent).toBe('');
  expect(tooltipOf(disconnect)).toBe('Disconnect');
  fireEvent.click(disconnect);
  await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/mcp/servers/srv1'));
  const connect = await screen.findByRole('button', { name: 'Connect Notion' });
  expect(connect.textContent).toBe('');
  expect(tooltipOf(connect)).toBe('Connect');
  await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(connect);
  fireEvent.change(await screen.findByPlaceholderText('Enter notion token'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: /Connect & Test/ }));
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/mcp/user/connect', { provider: 'notion', workspaceId: 'ws-1', env: { NOTION_TOKEN: 'secret' } }));
});

it('Connect is disabled while there is no workspace, and Test connection and Disconnect of a server act on it', async () => {
  mockApi.get.mockImplementation(async (url: string) => {
    if (url === '/mcp/servers') return [{ id: 'srv1', name: 'linear', displayName: 'Linear', transport: 'stdio', isGlobal: false, status: 'connected', createdAt: '' }];
    if (url === '/mcp/registry') return { notion: { displayName: 'Notion', description: 'Pages', package: 'p', envKeys: ['NOTION_TOKEN'], authType: 'token' } };
    if (url.startsWith('/mcp/user/credentials')) return [];
    return { exists: false };
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AgentSettingsPanel channelId="ch1" /></QueryClientProvider>);
  const connect = await screen.findByRole('button', { name: 'Connect Notion' });
  expect((connect as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Test connection Linear' }));
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/mcp/servers/srv1/test'));
});
