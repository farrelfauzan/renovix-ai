/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { config as appConfig } from '@/lib/config';
import { ApiKeysSection } from './api-keys-section';

// jsdom has no ResizeObserver, which the Checkbox primitive needs.
(global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const SECRET = 'rnx_live_SECRETSECRETSECRETSECRETSECRET0123456789';
let mockEntitlements: { data?: unknown } = {};
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
// eslint-disable-next-line import/first
import { toast } from 'sonner';

const key = (id: string, name: string, revokedAt: string | null = null) => ({
  id, name, prefix: `pfx${id.slice(-4)}`, createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null, revokedAt,
  expiresAt: null, allowedTiers: ['standard'], monthlyCreditCap: null, creditsLast30Days: '4.2',
});
const created = { ...key('key-new-0001-cccc', 'Inventory sync'), apiKey: SECRET };

type Request = { method: string; url: string; data: unknown };
let requests: Request[];
let keys: ReturnType<typeof key>[];
let createRefusal: { status: number; data: unknown } | null;

const reply = (config: any, data: unknown) => Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });
const refuse = (status: number, data: unknown) =>
  Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } }));

const queryClients: QueryClient[] = [];
const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(client);
  return { client, ...render(<QueryClientProvider client={client}><ApiKeysSection /></QueryClientProvider>) };
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  requests = [];
  keys = [key('key-one-0001-aaaa', 'First'), key('key-two-0002-bbbb', 'Second')];
  createRefusal = null;
  mockEntitlements = { data: { apiAccess: true, tiers: ['standard', 'advanced'], apiAccessNextPackage: null } };
  apiClient.defaults.adapter = (config: any) => {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    requests.push({ method: config.method, url: config.url, data: body });
    if (config.method === 'post' && config.url === '/auth/keys') return createRefusal ? refuse(createRefusal.status, createRefusal.data) : reply(config, created);
    if (config.method === 'delete') {
      const id = config.url.split('/').pop();
      keys = keys.map((k) => (k.id === id ? { ...k, revokedAt: '2026-11-15T00:00:00Z' } : k));
      return reply(config, undefined);
    }
    if (config.url === '/auth/keys') return reply(config, keys);
    if (config.url === '/models') return reply(config, { data: [{ id: 'claude-sonnet', tier: 'standard' }, { id: 'gpt-big', tier: 'advanced' }] });
    if (config.url === '/auth/keys/rate-limit') return reply(config, { requestsPerMinute: 17 });
    return refuse(404, {});
  };
});
afterEach(cleanup);

const fillAndCreate = async (name = 'Inventory sync') => {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
};

describe('RNX-82 AC1: the full key is shown once', () => {
  it('fires POST /auth/keys with the exact body, shows the key once, and nothing keeps it after a remount', async () => {
    const first = renderPage();
    fireEvent.change(await screen.findByLabelText('Monthly credit cap (optional)'), { target: { value: '20' } });
    await fillAndCreate();

    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(requests.find((r) => r.method === 'post')).toEqual({
      method: 'post',
      url: '/auth/keys',
      data: { name: 'Inventory sync', expiresIn: '1y', allowedTiers: ['standard'], monthlyCreditCap: 20 },
    });

    first.unmount();
    keys = [created as never, ...keys].map(({ ...k }) => { delete (k as { apiKey?: string }).apiKey; return k; }) as typeof keys;
    const second = renderPage();
    await screen.findByText('Inventory sync');

    expect(document.body.textContent).not.toContain(SECRET);
    expect(JSON.stringify({ ...localStorage })).not.toContain(SECRET);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(SECRET);
    for (const client of [first.client, second.client]) {
      expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(SECRET);
      expect(JSON.stringify(client.getMutationCache().getAll().map((m) => [m.state.data, m.state.variables]))).not.toContain(SECRET);
    }
  });

  it('"Done, I saved it" removes the key from the page', async () => {
    renderPage();
    await fillAndCreate();
    await screen.findByText(SECRET);

    fireEvent.click(screen.getByRole('button', { name: 'Done, I saved it' }));

    expect(screen.queryByText(SECRET)).toBeNull();
  });

  it('a refused clipboard write shows a message instead of failing silently', async () => {
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });
    renderPage();
    await fillAndCreate();
    await screen.findByText(SECRET);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not copy. Select the key and copy it.'));
    expect(screen.queryByText('Copied')).toBeNull();
  });
});

describe('RNX-82: monthly credit cap', () => {
  it('sends an entered cap of 0 for the API to refuse, instead of creating the key without a cap', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Monthly credit cap (optional)'), { target: { value: '0' } });
    await fillAndCreate();

    await waitFor(() => expect(requests.find((r) => r.method === 'post')?.data).toMatchObject({ monthlyCreditCap: 0 }));
  });
});

describe('RNX-82 AC2: the package refuses key creation', () => {
  it('disables Create with the package message when the account has no API access', async () => {
    mockEntitlements = { data: { apiAccess: false, tiers: ['standard'], apiAccessNextPackage: 'Pro' } };
    renderPage();

    await fillAndCreate();

    expect(screen.getByRole('button', { name: 'Create key' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText("API keys aren't included in your package. Upgrade to Pro to use the API.")).toBeTruthy();
    expect(requests.some((r) => r.method === 'post')).toBe(false);
  });

  it('a server 400 PACKAGE_LIMIT_REACHED shows the package message once and no generic toast', async () => {
    createRefusal = { status: 400, data: { error: { type: 'PACKAGE_LIMIT_REACHED', feature: 'apiAccess', nextPackage: 'Pro' } } };
    renderPage();

    await fillAndCreate();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create key' }) as HTMLButtonElement).disabled).toBe(false));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("API keys aren't included in your package. Upgrade to Pro to use the API.");
    expect(screen.queryByText(SECRET)).toBeNull();
  });
});

describe('RNX-82 AC3: Revoke', () => {
  it('confirming Revoke on row 2 fires DELETE with that row id, and the row shows revoked', async () => {
    renderPage();
    const rows = await screen.findAllByRole('row');
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Revoke' }));

    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(within(screen.getAllByRole('row')[2]).getByText('revoked')).toBeTruthy());
    expect(requests.filter((r) => r.method === 'delete')).toEqual([{ method: 'delete', url: '/auth/keys/key-two-0002-bbbb', data: undefined }]);
    expect(within(screen.getAllByRole('row')[1]).getByRole('button', { name: 'Revoke' })).toBeTruthy();
  });

  it('each row shows the key as the rnx_live_ marker plus its stored prefix, never the id', async () => {
    renderPage();
    const rows = await screen.findAllByRole('row');

    expect(within(rows[1]).getByText('rnx_live_pfxaaaa…')).toBeTruthy();
    expect(within(rows[2]).getByText('rnx_live_pfxbbbb…')).toBeTruthy();
  });
});

describe('RNX-82 AC6: the quick start shows the API\'s real values', () => {
  it('shows the configured base URL, model slugs by tier, a placeholder key, the 402 code and the served (non-default) rate limit', async () => {
    renderPage();

    const quickStart = await screen.findByRole('region', { name: 'Quick start' });
    expect(await within(quickStart).findByText('17 requests per minute per key')).toBeTruthy();
    expect(within(quickStart).getByText(appConfig.apiUrl)).toBeTruthy();
    expect(within(quickStart).getByText('claude-sonnet').parentElement?.textContent).toMatch(/^standard/i);
    expect(within(quickStart).getByText('gpt-big').parentElement?.textContent).toMatch(/^advanced/i);
    expect(within(quickStart).getByText(/CREDITS_EXHAUSTED/)).toBeTruthy();
    expect(within(quickStart).getByText(/Bearer \$RENOVIX_API_KEY/)).toBeTruthy();
    expect(requests.some((r) => r.url === '/auth/keys/rate-limit')).toBe(true);
  });
});
