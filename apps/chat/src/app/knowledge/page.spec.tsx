/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import KnowledgePage from './page';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
const mockDeleteKnowledgeBase = jest.fn();
const mockDeleteChunk = jest.fn();
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('framer-motion', () => {
  const passthrough = ({ children }: any) => <div>{children}</div>;
  return { motion: { div: passthrough }, AnimatePresence: passthrough };
});
jest.mock('@/lib/stores', () => ({ useHydrated: () => true, useAuthStore: () => ({ isLoggedIn: () => true }) }));
jest.mock('@/components/chat-sidebar', () => ({ AppSidebar: () => null }));
jest.mock('@/components/kb-upload-dialog', () => ({ KBUploadDialog: () => null }));
jest.mock('@performa-ai/ui/components/sidebar', () => ({ SidebarProvider: ({ children }: any) => <>{children}</>, SidebarInset: ({ children }: any) => <>{children}</> }));
jest.mock('@/hooks/use-knowledge', () => ({
  useKnowledgeBases: () => ({ data: [{ id: 'kb-1', name: 'Handbook', _count: { chunks: 1 } }], isLoading: false }),
  useDeleteKnowledgeBase: () => ({ mutate: mockDeleteKnowledgeBase }),
  useKnowledgeChunks: () => ({ data: { chunks: [{ id: 'chunk-1', content: 'First part' }], total: 1 }, isLoading: false }),
  useDeleteKnowledgeChunk: () => ({ mutate: mockDeleteChunk }),
}));

afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('Delete on a knowledge base is an icon-only button named by it, with the tooltip "Delete", and deletes it', () => {
  render(<KnowledgePage />);
  const actualButton = screen.getByRole('button', { name: 'Delete Handbook' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Delete');
  fireEvent.click(actualButton);
  expect(mockDeleteKnowledgeBase).toHaveBeenCalledWith('kb-1');
});

it('Delete on a chunk is an icon-only button with the tooltip "Delete" and deletes that chunk', () => {
  render(<KnowledgePage />);
  fireEvent.click(screen.getByText('Handbook'));
  const actualButton = screen.getByRole('button', { name: 'Delete chunk' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Delete');
  fireEvent.click(actualButton);
  expect(mockDeleteChunk).toHaveBeenCalledWith({ knowledgeBaseId: 'kb-1', chunkId: 'chunk-1' });
});
