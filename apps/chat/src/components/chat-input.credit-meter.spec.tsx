/// <reference types="jest" />
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { useCreditMeter } from '@/hooks/use-credit-meter';
import { ChatInput } from './chat-input';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('framer-motion', () => {
  const React = require('react');
  const passthrough = ({ children }: any) => React.createElement('div', null, children);
  return { motion: { div: passthrough }, AnimatePresence: passthrough };
});
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ email: 'account@example.test', isLoggedIn: () => true }),
  useChatStore: Object.assign(
    () => ({
      messages: [], isStreaming: false, conversationId: null, streamingConversationId: null,
      addMessage: jest.fn(), setStreaming: jest.fn(), setStreamStatus: jest.fn(), appendStreamContent: jest.fn(),
      finalizeStream: jest.fn(), selectedModel: 'standard-model', setSelectedModel: jest.fn(),
      setConversationId: jest.fn(), setPendingDocument: jest.fn(),
    }),
    { getState: () => ({ conversationId: null }) },
  ),
}));
jest.mock('@/hooks/use-portal', () => ({
  usePortalUsage: () => ({ data: { tier: 'paid' } }),
  usePortalModels: () => ({ data: [{ slug: 'standard-model', name: 'Standard Model', tier: 'standard' }] }),
}));
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => ({ data: undefined }) }));
jest.mock('@/hooks/use-current-user', () => ({ useCurrentUser: () => ({ data: { defaultModelTier: null } }) }));
jest.mock('@/lib/api', () => ({
  FREE_LIMIT_CODES: [],
  PortalError: class extends Error {},
  streamCompletion: jest.fn((_messages: unknown, _model: unknown, _effort: unknown, _onChunk: unknown, onDone: (id: string | null) => void) => {
    onDone(null);
    return { abort: jest.fn() };
  }),
}));
jest.mock('@performa-ai/ui/components/select', () => {
  const React = require('react');
  const Box = ({ children }: any) => React.createElement('div', null, children);
  return { Select: Box, SelectContent: Box, SelectTrigger: Box, SelectValue: () => null, SelectItem: Box };
});

const meter = {
  paidAvailable: '50',
  weeklyFreeAvailable: '0',
  projection: { status: 'not_enough_use' },
  level: 'none',
  belowFloor: false,
  dueReminders: [],
};

function MeterProbe() {
  useCreditMeter();
  return null;
}

afterEach(cleanup);

describe('RNX-330: the credit meter is refreshed after a reply', () => {
  it('requests the meter again when a reply finishes', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue(meter);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MeterProbe />
        <ChatInput />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('Message Renovix AI...'), { target: { value: 'hello' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Message Renovix AI...'), { key: 'Enter' });

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(apiClient.get).toHaveBeenLastCalledWith('/chat/portal/credit-meter');
  });
});
