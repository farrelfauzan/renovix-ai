/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AgentKnowledgeTab } from './agent-knowledge-tab';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
const mockRemove = jest.fn();
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/use-knowledge', () => ({ useKnowledgeBases: () => ({ data: [] }) }));
jest.mock('@/hooks/use-agents', () => ({ useAttachKnowledgeBase: () => ({ mutateAsync: jest.fn() }), useRemoveKnowledgeBase: () => ({ mutateAsync: mockRemove }) }));

afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('Remove is an icon-only button named by its knowledge base, with the tooltip "Remove", and removes it', async () => {
  const agent = { knowledgeBases: [{ id: 'akb-1', knowledgeBaseId: 'kb-1', knowledgeBase: { name: 'Handbook', description: 'Docs' } }] };
  render(<AgentKnowledgeTab agent={agent} agentId="a1" />);
  const actualButton = screen.getByRole('button', { name: 'Remove Handbook' });
  expect(actualButton.textContent).toBe('');
  expect(actualButton.nextElementSibling?.textContent).toBe('Remove');
  fireEvent.click(actualButton);
  await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ agentId: 'a1', kbId: 'akb-1' }));
});
