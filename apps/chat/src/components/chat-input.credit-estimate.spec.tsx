/// <reference types="jest" />
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { ChatInput } from './chat-input';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('framer-motion', () => {
  const React = require('react');
  const passthrough = ({ children }: any) => React.createElement('div', null, children);
  return { motion: { div: passthrough }, AnimatePresence: passthrough };
});
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
let mockSelectedModel = 'premium-model';
let mockHistory: { role: string; content: string }[] = [];
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ email: 'account@example.test', isLoggedIn: () => true }),
  useChatStore: Object.assign(
    () => ({
      messages: mockHistory, isStreaming: false, conversationId: null, streamingConversationId: null,
      addMessage: jest.fn(), setStreaming: jest.fn(), setStreamStatus: jest.fn(), appendStreamContent: jest.fn(),
      finalizeStream: jest.fn(), selectedModel: mockSelectedModel, setSelectedModel: jest.fn(),
      setConversationId: jest.fn(), setPendingDocument: jest.fn(),
    }),
    { getState: () => ({ conversationId: null }) },
  ),
}));
jest.mock('@/hooks/use-portal', () => ({
  usePortalUsage: () => ({ data: { tier: 'paid' } }),
  usePortalModels: () => ({
    data: [
      { slug: 'standard-model', name: 'Standard Model', tier: 'standard' },
      { slug: 'premium-model', name: 'Premium Model', tier: 'premium' },
      { slug: 'frontier-model', name: 'Frontier Model', tier: 'frontier' },
    ],
  }),
}));
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => ({ data: undefined }) }));
jest.mock('@/hooks/use-current-user', () => ({ useCurrentUser: () => ({ data: { defaultModelTier: null } }) }));
jest.mock('@/lib/api', () => ({ FREE_LIMIT_CODES: [], PortalError: class extends Error {}, streamCompletion: jest.fn() }));
jest.mock('@performa-ai/ui/components/select', () => {
  const React = require('react');
  const Box = ({ children }: any) => React.createElement('div', null, children);
  return { Select: Box, SelectContent: Box, SelectTrigger: Box, SelectValue: () => null, SelectItem: Box };
});

const ESTIMATE_URL = '/chat/portal/credit-estimate';
/** Longer than the hook's pause in typing (600 ms), so a request that would be made has been made. */
const PAST_THE_PAUSE_MS = 900;
const pause = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const composer = () => screen.getByPlaceholderText('Message Renovix AI...');
const type = (text: string) => fireEvent.change(composer(), { target: { value: text } });

function renderComposer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatInput />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockHistory = [];
  (apiClient.post as jest.Mock).mockReset().mockResolvedValue({ credits: '0.013319' });
});

afterEach(cleanup);

describe('RNX-331 AC1: a Premium or Frontier model shows "up to N credits" before sending', () => {
  it.each([['premium-model'], ['frontier-model']])('%s selected, a message typed: asks the API for that model and message and shows the figure rounded up', async (model) => {
    mockSelectedModel = model;
    mockHistory = [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }];
    renderComposer();

    type('hello');

    await waitFor(() => expect(screen.getByText('up to 0.02 credits')).toBeTruthy(), { timeout: 3000 });
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith(ESTIMATE_URL, {
      model,
      messages: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }, { role: 'user', content: 'hello' }],
    });
  });

  it('nothing typed: no request and no figure', async () => {
    mockSelectedModel = 'premium-model';
    renderComposer();

    await pause(PAST_THE_PAUSE_MS);

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(screen.queryByText(/up to/)).toBeNull();
  });

  it('typing is bounded: keystrokes less than the pause apart make one request, for the final text', async () => {
    mockSelectedModel = 'premium-model';
    renderComposer();

    type('h');
    await pause(100);
    type('he');
    await pause(100);
    type('hel');
    await waitFor(() => expect(screen.getByText('up to 0.02 credits')).toBeTruthy(), { timeout: 3000 });

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledWith(ESTIMATE_URL, { model: 'premium-model', messages: [{ role: 'user', content: 'hel' }] });
  });

  it('the API has no figure (credits null, the allowance setting is not set): the request is made, nothing is shown', async () => {
    mockSelectedModel = 'premium-model';
    (apiClient.post as jest.Mock).mockResolvedValue({ credits: null });
    renderComposer();

    type('hello');
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await pause(PAST_THE_PAUSE_MS);

    expect(apiClient.post).toHaveBeenCalledWith(ESTIMATE_URL, { model: 'premium-model', messages: [{ role: 'user', content: 'hello' }] });
    expect(screen.queryByText(/up to/)).toBeNull();
  });
});

describe('RNX-331 AC2: a Standard model shows no estimate and sends no estimate request', () => {
  it('standard selected, a message typed: no request after the pause, no figure', async () => {
    mockSelectedModel = 'standard-model';
    renderComposer();

    type('hello');
    await pause(PAST_THE_PAUSE_MS);

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(screen.queryByText(/up to/)).toBeNull();
  });
});
