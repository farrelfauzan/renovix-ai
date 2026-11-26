/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AgentSubAgentsTab } from './agent-subagents-tab';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
const mockUpdate = jest.fn();
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/use-agents', () => ({ useAgents: () => ({ data: [] }), useUpdateAgent: () => ({ mutateAsync: mockUpdate }) }));

afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('View and Remove are icon-only buttons named by the sub-agent, with those tooltips, and run their actions', async () => {
  const onViewAgentAction = jest.fn();
  const agent = { id: 'a1', subAgents: [{ id: 's1', name: 'Researcher', status: 'active' }] };
  render(<AgentSubAgentsTab agent={agent} agentId="a1" onViewAgentAction={onViewAgentAction} />);
  const viewButton = screen.getByRole('button', { name: 'View Researcher' });
  expect(viewButton.textContent).toBe('');
  expect(viewButton.nextElementSibling?.textContent).toBe('View');
  fireEvent.click(viewButton);
  expect(onViewAgentAction).toHaveBeenCalledWith('s1');
  const removeButton = screen.getByRole('button', { name: 'Remove Researcher' });
  expect(removeButton.textContent).toBe('');
  expect(removeButton.nextElementSibling?.textContent).toBe('Remove');
  fireEvent.click(removeButton);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ id: 's1', data: { parentAgentId: null, agentType: 'standalone' } }));
});
