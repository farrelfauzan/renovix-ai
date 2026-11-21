/// <reference types="jest" />
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import apiClient from '@/lib/api-client';
import { useCreditMeter } from './use-credit-meter';

let mockLoggedIn = false;
let mockEmail: string | null = null;
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ email: mockEmail, isLoggedIn: () => mockLoggedIn }),
}));
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn() } }));

const meterFor = (paidAvailable: string) => ({
  paidAvailable,
  weeklyFreeAvailable: '0',
  projection: { status: 'not_enough_use' },
  level: 'none',
  belowFloor: false,
  dueReminders: [],
});

beforeEach(() => jest.clearAllMocks());

describe('RNX-330: the credit meter is per account', () => {
  it('shows the second account own meter after a sign-in in the same tab, never the first account cached one', async () => {
    mockLoggedIn = true;
    mockEmail = 'account-a@example.test';
    (apiClient.get as jest.Mock).mockResolvedValueOnce(meterFor('111.1'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useCreditMeter(), { wrapper });
    await waitFor(() => expect(result.current.data?.paidAvailable).toBe('111.1'));

    mockEmail = 'account-b@example.test';
    (apiClient.get as jest.Mock).mockResolvedValueOnce(meterFor('222.2'));
    rerender();

    await waitFor(() => expect(result.current.data?.paidAvailable).toBe('222.2'));
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});

describe('RNX-330: the credit meter is never requested for an anonymous visitor', () => {
  it('sends no request to /chat/portal/credit-meter when no one is signed in', async () => {
    mockLoggedIn = false;
    mockEmail = null;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreditMeter(), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
