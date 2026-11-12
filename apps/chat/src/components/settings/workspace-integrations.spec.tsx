/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkspaceIntegrations } from './workspace-integrations';

const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => mockApi.get(...a), post: (...a: unknown[]) => mockApi.post(...a), delete: (...a: unknown[]) => mockApi.delete(...a) } }));
jest.mock('@/lib/stores', () => ({ useAuthStore: () => ({ isLoggedIn: () => true }) }));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  mockApi.get.mockImplementation(async (url: string) => {
    if (url === '/mcp/servers') return [];
    if (url === '/mcp/registry') return { 'google-gmail': { displayName: 'Gmail', description: 'Mail', package: 'p', envKeys: [], authType: 'oauth' }, notion: { displayName: 'Notion', description: 'Pages', package: 'p', envKeys: ['NOTION_TOKEN'], authType: 'token' } };
    if (url.startsWith('/mcp/user/credentials')) return [{ id: 'c1', provider: 'google-gmail', status: 'connected', connectedAt: '', expiresAt: null }];
    return { exists: true, workspace: { id: 'ws-1' } };
  });
  mockApi.post.mockResolvedValue({ connected: true, provider: 'notion' });
  mockApi.delete.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); jest.clearAllMocks(); });

it('AC10: lists the workspace connections, disconnects one for the workspace, and connects a token provider for it', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkspaceIntegrations channelId="ch1" /></QueryClientProvider>);
  expect(await screen.findByText('Connected')).toBeTruthy();
  expect(mockApi.get).toHaveBeenCalledWith('/mcp/user/credentials?workspaceId=ws-1');
  fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
  await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/mcp/user/credentials/google-gmail?workspaceId=ws-1'));
  const connect = await screen.findByRole('button', { name: 'Connect' });
  await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(connect);
  fireEvent.change(await screen.findByPlaceholderText('Enter notion token'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: /Connect & Test/ }));
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/mcp/user/connect', { provider: 'notion', workspaceId: 'ws-1', env: { NOTION_TOKEN: 'secret' } }));
});
