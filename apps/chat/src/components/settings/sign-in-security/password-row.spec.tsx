/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { PasswordRow } from './password-row';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
/** The tooltip text shown next to an icon-only action. */
const tooltipOf = (button: HTMLElement): string | null | undefined => button.nextElementSibling?.textContent;
jest.mock('@/components/settings/sign-in-security/change-password-form', () => ({ ChangePasswordForm: () => <p>change form</p> }));
jest.mock('@/components/settings/sign-in-security/set-password-form', () => ({ SetPasswordForm: () => <p>set form</p> }));

afterEach(cleanup);

it.each([
  { hasPassword: true, title: 'Change', form: 'change form' },
  { hasPassword: false, title: 'Set a password', form: 'set form' },
])(' is an icon-only button with that tooltip and opens its form', ({ hasPassword, title, form }) => {
  render(<PasswordRow hasPassword={hasPassword} />);
  const actualButton = screen.getByRole('button', { name: title });
  expect(actualButton.textContent).toBe('');
  expect(tooltipOf(actualButton)).toBe(title);
  fireEvent.click(actualButton);
  expect(screen.getByText(form)).toBeTruthy();
});
