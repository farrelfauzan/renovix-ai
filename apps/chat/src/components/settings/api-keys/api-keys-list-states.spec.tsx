/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ApiKeysSection } from './api-keys-section';

// jsdom has no ResizeObserver, which the Checkbox primitive needs.
(global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

let mockEntitlements: { data?: unknown } = {};
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const key = (id: string, name: string) => ({
  id, name, prefix: `pfx${id.slice(-4)}`, createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null, revokedAt: null,
  expiresAt: null, allowedTiers: ['standard'], monthlyCreditCap: null, creditsLast30Days: '4.2',
});

const reply = (config: any, data: unknown) => Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });
const refuse = (status: number, data: unknown) =>
  Promise.reject(Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } }));
const networkFailure = () => Promise.reject(Object.assign(new Error('Network Error'), { isAxiosError: true }));

type KeysHandler = (config: any) => Promise<any>;
let keysHandler: KeysHandler;
let keysRequestCount: number;

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
  keysRequestCount = 0;
  keysHandler = (config) => reply(config, [key('key-one-0001-aaaa', 'First'), key('key-two-0002-bbbb', 'Second')]);
  mockEntitlements = { data: { apiAccess: true, tiers: ['standard'], apiAccessNextPackage: null } };
  apiClient.defaults.adapter = (config: any) => {
    if (config.method === 'get' && config.url === '/auth/keys') {
      keysRequestCount += 1;
      return keysHandler(config);
    }
    if (config.url === '/models') return reply(config, { data: [] });
    if (config.url === '/auth/keys/rate-limit') return reply(config, { requestsPerMinute: 60 });
    return refuse(404, {});
  };
});
afterEach(cleanup);

describe('RNX-341 AC1: the list is loading', () => {
  it('shows the loading state and not "No keys yet." while GET /auth/keys has not answered', async () => {
    keysHandler = () => new Promise(() => {});
    renderPage();

    expect(await screen.findByText('Loading keys…')).toBeTruthy();
    expect(screen.queryByText('No keys yet.')).toBeNull();
    expect(keysRequestCount).toBe(1);
  });
});

describe('RNX-341 AC2: the list fails to load', () => {
  it('shows the error and a Retry button, not "No keys yet.", when the answer is a 500', async () => {
    keysHandler = () => refuse(500, {});
    renderPage();

    expect(await screen.findByText("Couldn't load your API keys.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No keys yet.')).toBeNull();
  });

  it('shows the error and a Retry button, not "No keys yet.", when the request fails with no response (network error)', async () => {
    keysHandler = () => networkFailure();
    renderPage();

    expect(await screen.findByText("Couldn't load your API keys.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No keys yet.')).toBeNull();
  });
});

describe('RNX-341 AC3: the list is empty', () => {
  it('shows "No keys yet." after a successful empty answer', async () => {
    keysHandler = (config) => reply(config, []);
    renderPage();

    expect(await screen.findByText('No keys yet.')).toBeTruthy();
    expect(screen.queryByText("Couldn't load your API keys.")).toBeNull();
  });
});

describe('RNX-341 AC4: Retry fetches again', () => {
  it('after a failed list, Retry fires GET /auth/keys a second time and then shows the keys table', async () => {
    keysHandler = (config) => (keysRequestCount === 1 ? refuse(500, {}) : reply(config, [key('key-one-0001-aaaa', 'First')]));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(keysRequestCount).toBe(2));
    expect(await screen.findByRole('table')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('rnx_live_pfxaaaa…')).toBeTruthy();
    expect(screen.queryByText("Couldn't load your API keys.")).toBeNull();
  });
});
