/// <reference types="jest" />
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiClient } from '@/lib/api-client';
import { MY_ENTITLEMENTS_QUERY_KEY } from '@/lib/my-entitlements-query-key';
import { useCloneTemplate, useCreateAgent, useDeleteAgent } from './use-agents';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

let invalidateSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
});
afterEach(() => invalidateSpy.mockRestore());

const wasEntitlementsInvalidated = (): boolean =>
  invalidateSpy.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(MY_ENTITLEMENTS_QUERY_KEY));

it('invalidates my entitlements after creating an agent', async () => {
  (apiClient.post as jest.Mock).mockResolvedValue({ id: '1' });
  const { result } = renderHook(() => useCreateAgent(), { wrapper });
  await act(() => result.current.mutateAsync({ name: 'A' }));
  await waitFor(() => expect(wasEntitlementsInvalidated()).toBe(true));
});

it('invalidates my entitlements after cloning a template', async () => {
  (apiClient.post as jest.Mock).mockResolvedValue({ id: '2' });
  const { result } = renderHook(() => useCloneTemplate(), { wrapper });
  await act(() => result.current.mutateAsync('template-1'));
  await waitFor(() => expect(wasEntitlementsInvalidated()).toBe(true));
});

it('invalidates my entitlements after deleting an agent', async () => {
  (apiClient.delete as jest.Mock).mockResolvedValue(undefined);
  const { result } = renderHook(() => useDeleteAgent(), { wrapper });
  await act(() => result.current.mutateAsync('1'));
  await waitFor(() => expect(wasEntitlementsInvalidated()).toBe(true));
});
