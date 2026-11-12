/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountMcpConnections } from './account-mcp-connections';

type Credential = { id: string; provider: string; status: 'connected'; connectedAt: string; expiresAt: null; workspaceIds: string[] };
const workspace = (id: string, name: string) => ({ id, name, slug: id, ownerId: 'u1', status: 'active', createdAt: '', updatedAt: '' });
const mockApi = { get: jest.fn(), put: jest.fn(), delete: jest.fn(), post: jest.fn() };
const mockToastError = jest.fn();
let mockAccount: Credential[] = [];
let mockShared = [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')];
let mockSelectedId: string | null = null;
const mockRegistry = {
  'google-gmail': { displayName: 'Gmail', description: 'Mail', package: 'p', envKeys: [], authType: 'oauth' },
  notion: { displayName: 'Notion', description: 'Pages', package: 'p', envKeys: ['NOTION_TOKEN'], authType: 'token' },
};
jest.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => mockApi.get(...a), put: (...a: unknown[]) => mockApi.put(...a), delete: (...a: unknown[]) => mockApi.delete(...a), post: (...a: unknown[]) => mockApi.post(...a) } }));
jest.mock('@/lib/stores', () => ({ useAuthStore: () => ({ isLoggedIn: () => true }) }));
jest.mock('@/hooks/use-shell-workspaces', () => ({ useShellWorkspaces: () => ({ workspaces: mockShared, selected: mockShared.find((w) => w.id === mockSelectedId) }) }));
jest.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: jest.fn() } }));

const gmail = (workspaceIds: string[]): Credential => ({ id: 'c1', provider: 'google-gmail', status: 'connected', connectedAt: '', expiresAt: null, workspaceIds });
const renderScreen = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AccountMcpConnections /></QueryClientProvider>);
const gmailCard = () => screen.getByText('Gmail').closest('div.rounded-lg') as HTMLElement;

beforeEach(() => {
  mockAccount = [];
  mockShared = [workspace('ws-a', 'Alpha'), workspace('ws-b', 'Beta')];
  mockSelectedId = null;
  mockApi.get.mockImplementation(async (url: string) => (url === '/mcp/registry' ? mockRegistry : mockAccount.map((c) => ({ ...c, workspaceIds: [...c.workspaceIds] }))));
  mockApi.put.mockImplementation(async (url: string) => {
    const [, provider, workspaceId] = /credentials\/([^/]+)\/workspaces\/(.+)$/.exec(url) as RegExpExecArray;
    mockAccount.find((c) => c.provider === provider)?.workspaceIds.push(workspaceId);
  });
  mockApi.delete.mockImplementation(async (url: string) => {
    const [path, query] = url.split('?');
    const provider = path.split('/').pop();
    const workspaceId = new URLSearchParams(query).get('workspaceId');
    if (workspaceId) mockAccount.forEach((c) => { if (c.provider === provider) c.workspaceIds = c.workspaceIds.filter((id) => id !== workspaceId); });
    else mockAccount = mockAccount.filter((c) => c.provider !== provider);
  });
});
afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('AC1: with no connection every provider shows Connect, whatever workspace is selected', async () => {
  for (const selected of [null, 'ws-a', 'ws-b']) {
    mockSelectedId = selected;
    const view = renderScreen();
    expect(await screen.findByText('Gmail')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Connect/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Disconnect/ })).toBeNull();
    view.unmount();
  }
  expect(mockApi.get).not.toHaveBeenCalledWith(expect.stringContaining('workspaceId'));
});

it('AC2: after the OAuth return Gmail is Connected with no switch on', async () => {
  mockAccount = [gmail([])];
  renderScreen();
  expect(await within(await waitFor(gmailCard)).findByText('Connected')).toBeTruthy();
  const switches = within(gmailCard()).getAllByRole('switch');
  expect(switches).toHaveLength(2);
  switches.forEach((toggle) => expect(toggle.getAttribute('aria-checked')).toBe('false'));
});

it('AC2: Connect on this page starts OAuth for the account, without a workspaceId, even with a workspace selected', async () => {
  mockSelectedId = 'ws-a';
  const defaultGet = mockApi.get.getMockImplementation() as (url: string) => Promise<unknown>;
  mockApi.get.mockImplementation(async (url: string) => (url.startsWith('/mcp/user/oauth/start') ? { authUrl: 'about:blank' } : defaultGet(url)));
  renderScreen();
  fireEvent.click(within(await waitFor(() => screen.getByText('Gmail').closest('div.rounded-lg') as HTMLElement)).getByRole('button', { name: /Connect/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Authorize Gmail/ }));
  await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/mcp/user/oauth/start?provider=google-gmail'));
  expect(mockApi.get).not.toHaveBeenCalledWith(expect.stringMatching(/oauth\/start.*workspaceId/));
});

it('AC2: a token connect on this page sends no workspaceId, even with a workspace selected', async () => {
  mockSelectedId = 'ws-a';
  mockApi.post.mockResolvedValue({ connected: true, provider: 'notion' });
  renderScreen();
  fireEvent.click(within(await waitFor(() => screen.getByText('Notion').closest('div.rounded-lg') as HTMLElement)).getByRole('button', { name: /Connect/ }));
  fireEvent.change(await screen.findByPlaceholderText(/notion token/i), { target: { value: 'test-notion-token-not-real' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Connect & Test/ }));
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledTimes(1));
  expect(mockApi.post.mock.calls[0][0]).toBe('/mcp/user/connect');
  expect(mockApi.post.mock.calls[0][1].workspaceId).toBeUndefined();
});

it('AC3: connected and a member of A and B, both are listed off; turning A on calls PUT for A only and stays on', async () => {
  mockAccount = [gmail([])];
  renderScreen();
  const alpha = await screen.findByRole('switch', { name: 'Alpha' });
  expect(screen.getByRole('switch', { name: 'Beta' }).getAttribute('aria-checked')).toBe('false');
  fireEvent.click(alpha);
  await waitFor(() => expect(mockApi.put).toHaveBeenCalledTimes(1));
  expect(mockApi.put).toHaveBeenCalledWith('/mcp/user/credentials/google-gmail/workspaces/ws-a');
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('true'));
  expect(screen.getByRole('switch', { name: 'Beta' }).getAttribute('aria-checked')).toBe('false');
  expect(mockApi.get.mock.calls.filter(([url]) => url === '/mcp/user/credentials').length).toBeGreaterThan(1);
});

it('AC4: turning A off calls DELETE with workspaceId A and the provider stays Connected', async () => {
  mockAccount = [gmail(['ws-a'])];
  renderScreen();
  fireEvent.click(await screen.findByRole('switch', { name: 'Alpha' }));
  await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/mcp/user/credentials/google-gmail?workspaceId=ws-a'));
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('false'));
  expect(within(gmailCard()).getByText('Connected')).toBeTruthy();
});

it('AC5: Disconnect asks first, names A, then deletes the account connection without a workspaceId', async () => {
  mockAccount = [gmail(['ws-a'])];
  renderScreen();
  fireEvent.click(await screen.findByRole('button', { name: /Disconnect/ }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog.textContent).toContain('Alpha');
  expect(dialog.textContent).not.toContain('Beta');
  expect(mockApi.delete).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
  await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/mcp/user/credentials/google-gmail'));
  await waitFor(() => expect(screen.getAllByRole('button', { name: /Connect/ })).toHaveLength(2));
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
});

it.each([403, 404])('AC6: a switch call failing with %i shows an error and the switch goes back', async (status) => {
  mockAccount = [gmail([])];
  mockApi.put.mockRejectedValueOnce({ response: { status } });
  renderScreen();
  fireEvent.click(await screen.findByRole('switch', { name: 'Alpha' }));
  await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Alpha')));
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('false'));
});

it('AC6: a switch-off failing puts the switch back on', async () => {
  mockAccount = [gmail(['ws-a'])];
  mockApi.delete.mockRejectedValueOnce({ response: { status: 403 } });
  renderScreen();
  fireEvent.click(await screen.findByRole('switch', { name: 'Alpha' }));
  await waitFor(() => expect(mockToastError).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Alpha' }).getAttribute('aria-checked')).toBe('true'));
});

it('AC7: the default workspace is never in the switch list (it is not among the shared workspaces)', async () => {
  mockAccount = [gmail(['default-ws', 'ws-a'])];
  renderScreen();
  await screen.findByRole('switch', { name: 'Alpha' });
  expect(screen.getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-label'))).toEqual(['Alpha', 'Beta']);
  expect(screen.queryByText(/personal|default/i)).toBeNull();
});
