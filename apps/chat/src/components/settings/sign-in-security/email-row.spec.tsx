/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EmailRow } from './email-row';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
jest.mock('@/hooks/use-change-email', () => ({ useChangeEmail: () => ({ mutate: jest.fn(), isPending: false }) }));

afterEach(cleanup);

it('Change is an icon-only button with the tooltip "Change", and opens the new-email form', () => {
  render(<EmailRow user={{ email: 'dewi@example.test', emailVerified: true } as any} />);
  const actualButton = screen.getByRole('button', { name: 'Change' });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe('Change');
  fireEvent.click(actualButton);
  expect(screen.getByLabelText('New email')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
});
