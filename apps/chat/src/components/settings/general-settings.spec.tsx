/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { GeneralSettings } from './general-settings';

let mockEntitlements: { data?: unknown } = {};
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const profile = { id: '1', email: 'a@example.test', status: 'active', apiKey: 'rx_old', createdAt: '2026-01-01T00:00:00Z' };

const respondWith = (regenerate: { status: number; data: unknown }) => {
  apiClient.defaults.adapter = (config: any) => {
    if (config.url === '/auth/me') return Promise.resolve({ data: profile, status: 200, statusText: 'OK', headers: {}, config });
    return Promise.reject(
      Object.assign(new Error(`Request failed with status code ${regenerate.status}`), {
        isAxiosError: true,
        response: { status: regenerate.status, data: regenerate.data },
      }),
    );
  };
};

const clickRegenerate = async () => {
  render(<GeneralSettings />);
  fireEvent.click(await screen.findByText('Regenerate Key'));
  await waitFor(() => expect((toast.error as jest.Mock).mock.calls.length).toBeGreaterThan(0));
};

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => true);
  mockEntitlements = { data: { apiAccess: true, nextPackage: 'Pro' } };
});
afterEach(cleanup);

it('shows the package copy once, and not the generic failure, when regenerating is refused by the package', async () => {
  respondWith({ status: 400, data: { error: { type: 'PACKAGE_LIMIT_REACHED', feature: 'apiAccess', nextPackage: 'Pro' } } });
  await clickRegenerate();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith("API keys aren't included in your package. Upgrade to Pro to use the API.");
});

it('keeps the generic failure toast for any other regenerate failure', async () => {
  respondWith({ status: 500, data: {} });
  await clickRegenerate();
  expect(toast.error).toHaveBeenCalledWith('Failed to regenerate API key');
});

it('shows the API access pill next to the API key section', async () => {
  respondWith({ status: 500, data: {} });
  render(<GeneralSettings />);
  expect(await screen.findByText('API access included')).toBeTruthy();
});

it('shows no API access pill when the entitlements are unavailable', async () => {
  respondWith({ status: 500, data: {} });
  mockEntitlements = { data: undefined };
  render(<GeneralSettings />);
  await screen.findByText('API Token');
  expect(screen.queryByText('API access included')).toBeNull();
  expect(screen.queryByText(/Available on|Not in your package/)).toBeNull();
});
