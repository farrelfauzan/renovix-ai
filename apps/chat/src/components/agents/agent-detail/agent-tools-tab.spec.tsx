/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AgentToolsTab } from './agent-tools-tab';

let mockEntitlements: { data?: unknown } = {};
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));
const mockAttachTool = jest.fn();
const mockRemoveTool = jest.fn();
let mockAvailableTools: unknown[] = [];
jest.mock('@/hooks/use-agents', () => ({
  useAttachTool: () => ({ mutateAsync: mockAttachTool }),
  useRemoveTool: () => ({ mutateAsync: mockRemoveTool }),
  useAvailableTools: () => ({ data: mockAvailableTools }),
}));
// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
jest.mock('@/hooks/use-web-search', () => {
  const mutation = () => ({ mutateAsync: jest.fn(), isPending: false });
  return {
    useDeleteBraveWebSearchKey: mutation, useUpdateWebSearchPolicy: mutation, useUpsertBraveWebSearchKey: mutation,
    useWebSearchPolicy: () => ({ data: undefined }), useWebSearchStatus: () => ({ data: undefined }),
  };
});

// The API's connected-tools limit counts the agent's integrations (countAgentIntegrations), not its built-in tools.
const agent = { tools: [{ id: 't1', toolType: 'a' }, { id: 't2', toolType: 'b' }, { id: 't3', toolType: 'c' }], integrations: [{ id: 'i1' }, { id: 'i2' }] };

afterEach(() => { cleanup(); mockAvailableTools = []; jest.clearAllMocks(); });

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

it('Add and Remove are icon-only buttons named by their tool, with those tooltips, and attach or remove it', async () => {
  mockEntitlements = { data: undefined };
  mockAvailableTools = [{ type: 'a', name: 'Calculator' }, { type: 'z', name: 'Search' }];
  render(<AgentToolsTab agent={agent} agentId="1" />);
  const removeButton = screen.getByRole('button', { name: 'Remove Calculator' });
  expect(removeButton.textContent).toBe('');
  expect(removeButton.nextElementSibling?.textContent).toBe('Remove');
  fireEvent.click(removeButton);
  await waitFor(() => expect(mockRemoveTool).toHaveBeenCalledWith({ agentId: '1', toolId: 't1' }));
  const addButton = screen.getByRole('button', { name: 'Add Search' });
  expect(addButton.textContent).toBe('');
  expect(addButton.nextElementSibling?.textContent).toBe('Add');
  fireEvent.click(addButton);
  await waitFor(() => expect(mockAttachTool).toHaveBeenCalledWith({ agentId: '1', data: { toolType: 'z', enabled: true } }));
});
