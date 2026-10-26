/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { SettingsNavigation } from './settings-navigation';

jest.mock('next/navigation', () => ({ redirect: jest.fn(), usePathname: () => '/settings/general' }));
jest.mock('@/hooks/use-shell-workspaces', () => ({ useShellWorkspaces: () => ({ capability: null }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
afterEach(cleanup);

it('shows available destinations and does not invent company or member capability', () => {
  render(<SettingsNavigation />);
  expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['General', 'Workspace', 'Billing and credits', 'Connected tools', 'API keys']);
  expect(screen.queryByText('Workspace and members')).toBeNull();
  expect(screen.queryByText('Company and credits')).toBeNull();
  expect(screen.queryByText('Workspace and members')).toBeNull();
  expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
});

it('shows company and workspace destinations only for an owner with collaboration allowed', () => {
  jest.resetModules();
  jest.doMock('@/hooks/use-shell-workspaces', () => ({ useShellWorkspaces: () => ({ capability: { collaborationAllowed: true, effectiveRole: 'owner' } }) }));
  const { SettingsNavigation: OwnerNavigation } = require('./settings-navigation');
  render(<OwnerNavigation />);
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
