/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { apiClient } from '@/lib/api-client';
import { GeneralSettings } from './general-settings';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const profile = { id: '1', email: 'a@example.test', status: 'active', createdAt: '2026-01-01T00:00:00Z' };

beforeEach(() => {
  apiClient.defaults.adapter = (config: any) =>
    Promise.resolve({ data: profile, status: 200, statusText: 'OK', headers: {}, config });
});
afterEach(cleanup);

// RNX-82 AC4: the stale API Token block is gone and a link leads to the API keys page.
it('renders no API Token block and calls no key route (control: it does load the profile)', async () => {
  const requested: string[] = [];
  const adapter = apiClient.defaults.adapter as (config: any) => Promise<any>;
  apiClient.defaults.adapter = (config: any) => {
    requested.push(`${config.method} ${config.url}`);
    return adapter(config);
  };
  render(<GeneralSettings />);
  await screen.findByText('Profile Settings');
  expect(screen.queryByText('API Token')).toBeNull();
  expect(screen.queryByText('Regenerate Key')).toBeNull();
  expect(screen.queryByText('API access included')).toBeNull();
  expect(requested.filter((request) => request.includes('/auth/keys'))).toEqual([]);
  expect(requested).toContain('get /auth/me');
});

it('links to the API keys page', async () => {
  render(<GeneralSettings />);
  const link = await screen.findByRole('link', { name: 'API keys page' });
  expect(link.getAttribute('href')).toBe('/settings/api-keys');
});
