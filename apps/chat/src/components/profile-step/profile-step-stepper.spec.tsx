/// <reference types="jest" />
import { render, screen, cleanup, within } from '@testing-library/react';
import { ProfileStepStepper } from './profile-step-stepper';

afterEach(cleanup);

const renderSteps = (): HTMLElement[] => {
  render(<ProfileStepStepper />);
  return Array.from(screen.getByRole('navigation', { name: 'Setup progress' }).children) as HTMLElement[];
};

it('keeps the three steps on one line, each step unbroken', () => {
  const steps = renderSteps();
  const nav = screen.getByRole('navigation', { name: 'Setup progress' });
  expect(nav.classList.contains('flex-nowrap')).toBe(true);
  expect(steps).toHaveLength(3);
  steps.forEach((step) => expect(step.classList.contains('whitespace-nowrap')).toBe(true));
});

it('hides the labels of the other steps only below the sm breakpoint, and always shows the current one', () => {
  const [current, ...others] = renderSteps();
  expect(current.getAttribute('aria-current')).toBe('step');
  expect(within(current).getByText('About you').className).not.toContain('sr-only');
  others.forEach((step) => {
    const label = step.lastElementChild as HTMLElement;
    expect(label.classList.contains('sr-only')).toBe(true);
    expect(label.classList.contains('sm:not-sr-only')).toBe(true);
  });
});

it('keeps every label in the accessible names, at text-sm', () => {
  const steps = renderSteps();
  expect(steps.map((step) => step.textContent?.replace(/^\d/, ''))).toEqual(['About you', 'First agent', 'First result']);
  steps.forEach((step) => {
    expect(step.classList.contains('text-sm')).toBe(true);
    expect(step.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});
