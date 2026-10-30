/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { PackageLimitPill } from './package-limit-pill';

let mockEntitlements: { data?: unknown } = {};
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));

const entitlements = (overrides: Record<string, unknown> = {}) => ({
  data: { agents: { used: 3, limit: 10 }, connectedToolsPerAgent: 5, apiAccess: true, nextPackage: 'Pro', apiAccessNextPackage: null, ...overrides },
});

afterEach(cleanup);

it('shows used of limit agents', () => {
  mockEntitlements = entitlements();
  render(<PackageLimitPill kind="agents" />);
  expect(screen.getByText('3 of 10 agents')).toBeTruthy();
});

it('shows this agent tool count of the per-agent limit', () => {
  mockEntitlements = entitlements();
  render(<PackageLimitPill kind="connectedTools" connectedToolCount={2} />);
  expect(screen.getByText('2 of 5 connected tools')).toBeTruthy();
});

it('shows API access included when the package has it', () => {
  mockEntitlements = entitlements();
  render(<PackageLimitPill kind="apiAccess" />);
  expect(screen.getByText('API access included')).toBeTruthy();
});

it('points at the next package that grants API access, not the next with more agents', () => {
  mockEntitlements = entitlements({ apiAccess: false, apiAccessNextPackage: 'Enterprise' });
  render(<PackageLimitPill kind="apiAccess" />);
  expect(screen.getByText('Available on Enterprise')).toBeTruthy();
});

it('says not in your package when API access is missing and no package grants it', () => {
  mockEntitlements = entitlements({ apiAccess: false, apiAccessNextPackage: null });
  render(<PackageLimitPill kind="apiAccess" />);
  expect(screen.getByText('Not in your package')).toBeTruthy();
});

it('renders nothing while loading or on error', () => {
  mockEntitlements = { data: undefined };
  const { container } = render(<PackageLimitPill kind="agents" />);
  expect(container.textContent).toBe('');
});
