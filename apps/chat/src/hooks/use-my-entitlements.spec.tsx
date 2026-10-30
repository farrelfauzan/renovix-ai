/// <reference types="jest" />
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import apiClient from '@/lib/api-client';
import { useMyEntitlements } from './use-my-entitlements';

let mockLoggedIn = false;
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => mockLoggedIn }),
}));
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn() } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

beforeEach(() => jest.clearAllMocks());

it('requests /entitlements/me for a logged-in user', async () => {
  mockLoggedIn = true;
  (apiClient.get as jest.Mock).mockResolvedValue({ tiers: ['standard'] });
  const { result } = renderHook(() => useMyEntitlements(), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual({ tiers: ['standard'] }));
  expect(apiClient.get).toHaveBeenCalledWith('/entitlements/me');
});

it('never requests /entitlements/me for an anonymous visitor', async () => {
  mockLoggedIn = false;
  const { result } = renderHook(() => useMyEntitlements(), { wrapper });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(result.current.data).toBeUndefined();
});
