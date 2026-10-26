/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { SettingsNavigation } from './settings-navigation';

let mockCapability: { collaborationAllowed: boolean; effectiveRole: 'owner' | 'member' } | null = null;
jest.mock('next/navigation', () => ({ redirect: jest.fn(), usePathname: () => '/settings/general' }));
jest.mock('@/hooks/use-shell-workspaces', () => ({ useShellWorkspaces: () => ({ capability: mockCapability }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
afterEach(() => { cleanup(); mockCapability = null; });

it.each([
  [{ collaborationAllowed: true, effectiveRole: 'member' }, 'Enterprise member'],
  [{ collaborationAllowed: false, effectiveRole: 'owner' }, 'non-Enterprise owner'],
] as const)('hides specialized entries for a %s', (capability) => {
  mockCapability = capability;
  render(<SettingsNavigation />);
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['General', 'Workspace', 'Billing and credits', 'Connected tools', 'API keys']);
  expect(screen.queryByText('Workspace and members')).toBeNull();
  expect(screen.queryByText('Company and credits')).toBeNull();
  expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
});

it('shows specialized entries for an owner with collaboration allowed', () => {
  mockCapability = { collaborationAllowed: true, effectiveRole: 'owner' };
  render(<SettingsNavigation />);
  expect(screen.getByText('Workspace and members')).toBeTruthy();
  expect(screen.getByText('Company and credits')).toBeTruthy();
});

it.each([['profile', '/settings/general'], ['top-up', '/settings/billing']])('redirects legacy %s to %s', (route, destination) => {
  jest.isolateModules(() => {
    const { redirect } = require('next/navigation');
    require(`../../app/${route}/page`).default();
    expect(redirect).toHaveBeenCalledWith(destination);
  });
});
