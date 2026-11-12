/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CredentialRequiredCard } from './credential-required-card';

const mockApi = { get: jest.fn(), put: jest.fn() };
const mockWorkspaces = [{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }];
let mockAccount: { provider: string; workspaceIds: string[] }[] = [];
jest.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => mockApi.get(...a), put: (...a: unknown[]) => mockApi.put(...a) } }));
jest.mock('@/lib/stores', () => ({ useAuthStore: () => ({ isLoggedIn: () => true }) }));
jest.mock('@/hooks/use-shell-workspaces', () => ({ useShellWorkspaces: () => ({ workspaces: mockWorkspaces }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const renderCard = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CredentialRequiredCard provider="google-gmail" workspaceId="ws-b" /></QueryClientProvider>);

beforeEach(() => {
  mockApi.get.mockImplementation(async (url: string) => {
    if (url === '/mcp/user/credentials') return mockAccount;
    return { authUrl: 'https://auth.example/start' };
  });
  mockApi.put.mockImplementation(async () => {
    mockAccount = mockAccount.map((c) => ({ ...c, workspaceIds: [...c.workspaceIds, 'ws-b'] }));
  });
});
afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('AC8: connected on the account but off in B offers "Turn on in Beta" and calls PUT for B', async () => {
  mockAccount = [{ provider: 'google-gmail', workspaceIds: ['ws-a'] }];
  renderCard();
  fireEvent.click(await screen.findByRole('button', { name: 'Turn on in Beta' }));
  await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith('/mcp/user/credentials/google-gmail/workspaces/ws-b'));
  expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
});

it('AC8: not connected shows Connect, which starts OAuth with the workspace', async () => {
  mockAccount = [];
  renderCard();
  const connect = await screen.findByRole('button', { name: 'Connect Google Gmail' });
  expect(screen.queryByRole('button', { name: /Turn on/ })).toBeNull();
  fireEvent.click(connect);
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/mcp/user/oauth/start?provider=google-gmail&workspaceId=ws-b'));
});
