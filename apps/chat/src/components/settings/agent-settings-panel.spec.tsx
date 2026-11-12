/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentSettingsPanel } from './agent-settings-panel';

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
  fireEvent.click(screen.getByTitle('Disconnect'));
  await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/mcp/servers/srv1'));
  const connect = await screen.findByRole('button', { name: 'Connect' });
  await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(connect);
  fireEvent.change(await screen.findByPlaceholderText('Enter notion token'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: /Connect & Test/ }));
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/mcp/user/connect', { provider: 'notion', workspaceId: 'ws-1', env: { NOTION_TOKEN: 'secret' } }));
});
