/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import MemoryPage from './page';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
const mockDelete = jest.fn();
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('@/lib/stores', () => ({ useHydrated: () => true, useAuthStore: () => ({ isLoggedIn: () => true }) }));
jest.mock('@/components/chat-sidebar', () => ({ AppSidebar: () => null }));
jest.mock('@performa-ai/ui/components/sidebar', () => ({ SidebarProvider: ({ children }: any) => <>{children}</>, SidebarInset: ({ children }: any) => <>{children}</> }));
jest.mock('@/hooks/use-memory', () => ({
  useMemories: () => ({ data: { data: [{ id: 'mem-1', type: 'interest', content: 'Likes tea', isUserPinned: false }] }, isLoading: false }),
  useDeleteMemory: () => ({ mutate: mockDelete }),
  useUpdateMemory: () => ({ mutate: jest.fn() }),
  useClearMemories: () => ({ mutate: jest.fn() }),
}));

afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('Delete is an icon-only button with the tooltip "Delete" and deletes that memory', () => {
  render(<MemoryPage />);
  const actualButton = screen.getByRole('button', { name: 'Delete' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Delete');
  fireEvent.click(actualButton);
  expect(mockDelete).toHaveBeenCalledWith('mem-1');
});
