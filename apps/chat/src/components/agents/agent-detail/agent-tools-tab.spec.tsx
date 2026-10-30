/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { AgentToolsTab } from './agent-tools-tab';

let mockEntitlements: { data?: unknown } = {};
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));
jest.mock('@/hooks/use-agents', () => ({
  useAttachTool: () => ({ mutateAsync: jest.fn() }),
  useRemoveTool: () => ({ mutateAsync: jest.fn() }),
  useAvailableTools: () => ({ data: [] }),
}));
jest.mock('@/hooks/use-web-search', () => {
  const mutation = () => ({ mutateAsync: jest.fn(), isPending: false });
  return {
    useDeleteBraveWebSearchKey: mutation, useUpdateWebSearchPolicy: mutation, useUpsertBraveWebSearchKey: mutation,
    useWebSearchPolicy: () => ({ data: undefined }), useWebSearchStatus: () => ({ data: undefined }),
  };
});

// The API's connected-tools limit counts the agent's integrations (countAgentIntegrations), not its built-in tools.
const agent = { tools: [{ id: 't1', toolType: 'a' }, { id: 't2', toolType: 'b' }, { id: 't3', toolType: 'c' }], integrations: [{ id: 'i1' }, { id: 'i2' }] };

afterEach(cleanup);

it('shows this agent integration count of the per-agent connected-tools limit, not its built-in tool count', () => {
  mockEntitlements = { data: { connectedToolsPerAgent: 5 } };
  render(<AgentToolsTab agent={agent} agentId="1" />);
  expect(screen.getByText('2 of 5 connected tools')).toBeTruthy();
});

it('shows no tool pill when the entitlements are unavailable', () => {
  mockEntitlements = { data: undefined };
  render(<AgentToolsTab agent={agent} agentId="1" />);
  expect(screen.queryByText(/connected tools$/)).toBeNull();
  expect(screen.getByText('Enable or disable tools for this agent.')).toBeTruthy();
});
