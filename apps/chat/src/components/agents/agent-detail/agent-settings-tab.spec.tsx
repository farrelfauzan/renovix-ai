/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { AgentSettingsTab } from './agent-settings-tab';

let mockEntitlements: { data?: unknown } = {};
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/use-agents', () => ({ useUpdateAgent: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('@/hooks/use-portal', () => ({
  usePortalModels: () => ({
    data: [
      { slug: 'premium-model', name: 'Premium Model', tier: 'premium' },
      { slug: 'standard-model', name: 'Standard Model', tier: 'standard' },
    ],
  }),
}));
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));
jest.mock('@/components/ui/select', () => {
  const React = require('react');
  const Box = ({ children }: any) => React.createElement('div', null, children);
  return {
    Select: Box, SelectContent: Box, SelectTrigger: Box, SelectValue: () => null,
    SelectItem: ({ children, disabled, value }: any) =>
      React.createElement('div', { 'data-testid': `option-${value}`, 'data-disabled': String(!!disabled) }, children),
  };
});

const agent = { name: 'A', systemPrompt: 'p', model: 'standard-model', temperature: 0.7, isPublic: false };

afterEach(cleanup);

it('disables a locked model in the agent model picker with the upgrade hint and leaves allowed ones enabled', () => {
  mockEntitlements = { data: { tiers: ['standard'], nextPackage: 'Pro' } };
  render(<AgentSettingsTab agent={agent} agentId="1" />);
  expect(screen.getByTestId('option-premium-model').getAttribute('data-disabled')).toBe('true');
  expect(screen.getByTestId('option-premium-model').textContent).toBe('Premium ModelAvailable on Pro');
  expect(screen.getByTestId('option-standard-model').getAttribute('data-disabled')).toBe('false');
});

it('locks nothing in the agent model picker without entitlements', () => {
  mockEntitlements = { data: undefined };
  render(<AgentSettingsTab agent={agent} agentId="1" />);
  expect(screen.getByTestId('option-premium-model').getAttribute('data-disabled')).toBe('false');
});
