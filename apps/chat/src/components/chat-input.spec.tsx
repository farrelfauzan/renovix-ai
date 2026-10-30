/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { ChatInput } from './chat-input';

const mockSetSelectedModel = jest.fn();
let mockSelectedModel: string | null = null;
let mockEntitlements: { data?: unknown } = {};
const models = [
  { slug: 'premium-model', name: 'Premium Model', tier: 'premium' },
  { slug: 'standard-model', name: 'Standard Model', tier: 'standard' },
];

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('framer-motion', () => {
  const React = require('react');
  const passthrough = ({ children }: any) => React.createElement('div', null, children);
  return { motion: { div: passthrough }, AnimatePresence: passthrough };
});
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true }),
  useChatStore: Object.assign(
    () => ({
      messages: [], isStreaming: false, conversationId: null, streamingConversationId: null,
      addMessage: jest.fn(), setStreaming: jest.fn(), setStreamStatus: jest.fn(), appendStreamContent: jest.fn(),
      finalizeStream: jest.fn(), selectedModel: mockSelectedModel, setSelectedModel: mockSetSelectedModel,
      setConversationId: jest.fn(), setPendingDocument: jest.fn(),
    }),
    { getState: () => ({ conversationId: null }) },
  ),
}));
jest.mock('@/hooks/use-portal', () => ({
  usePortalUsage: () => ({ data: { tier: 'paid' } }),
  usePortalModels: () => ({ data: models }),
}));
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));
jest.mock('@/lib/api', () => ({ FREE_LIMIT_CODES: [], PortalError: class extends Error {}, streamCompletion: jest.fn() }));
jest.mock('@/components/ui/select', () => {
  const React = require('react');
  const Box = ({ children }: any) => React.createElement('div', null, children);
  return {
    Select: Box, SelectContent: Box, SelectTrigger: Box, SelectValue: () => null,
    SelectItem: ({ children, disabled, value }: any) =>
      React.createElement('div', { 'data-testid': `option-${value}`, 'data-disabled': String(!!disabled) }, children),
  };
});

const standardOnly = { data: { tiers: ['standard'], nextPackage: 'Pro' } };

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectedModel = null;
  mockEntitlements = standardOnly;
});
afterEach(cleanup);

it('disables a model whose tier is not in the package and shows where it is available', () => {
  render(<ChatInput />);
  const locked = screen.getByTestId('option-premium-model');
  expect(locked.getAttribute('data-disabled')).toBe('true');
  expect(locked.textContent).toBe('Premium ModelAvailable on Pro');
});

it('says not in your package when the locked model has no next package', () => {
  mockEntitlements = { data: { tiers: ['standard'], nextPackage: null } };
  render(<ChatInput />);
  expect(screen.getByTestId('option-premium-model').textContent).toBe('Premium ModelNot in your package');
});

it('leaves a model whose tier is in the package enabled', () => {
  render(<ChatInput />);
  const allowed = screen.getByTestId('option-standard-model');
  expect(allowed.getAttribute('data-disabled')).toBe('false');
  expect(allowed.textContent).toBe('Standard Model');
});

it('auto-selects an allowed model, not the first locked one', () => {
  render(<ChatInput />);
  expect(mockSetSelectedModel).toHaveBeenCalledWith('standard-model');
});

it('replaces a persisted model that the package locks with an allowed one', () => {
  mockSelectedModel = 'premium-model';
  render(<ChatInput />);
  expect(mockSetSelectedModel).toHaveBeenCalledWith('standard-model');
});

it('locks nothing without entitlements (anonymous, loading or error)', () => {
  mockEntitlements = { data: undefined };
  render(<ChatInput />);
  expect(screen.getByTestId('option-premium-model').getAttribute('data-disabled')).toBe('false');
  expect(mockSetSelectedModel).toHaveBeenCalledWith('premium-model');
});
