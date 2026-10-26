/// <reference types="jest" />
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppShell } from './app-shell';

let mockPath = '/';
let mockAuthenticated = true;
const mockToggle = jest.fn();
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('@/lib/stores', () => ({ useHydrated: () => true, useAuthStore: () => ({ isLoggedIn: () => mockAuthenticated }) }));
jest.mock('@/components/chat-sidebar', () => ({ AppSidebar: () => <nav aria-label="App navigation" /> }));
jest.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  SidebarTrigger: () => <button onClick={mockToggle}>Toggle Sidebar</button>,
}));
afterEach(() => { cleanup(); mockAuthenticated = true; mockToggle.mockClear(); });

it.each(['/', '/agents', '/agents/example/chat', '/settings', '/settings/general'])('shares navigation and mobile trigger on %s', (path) => {
  mockPath = path;
  render(<AppShell><p>Existing contents</p></AppShell>);
  expect(screen.getByRole('navigation', { name: 'App navigation' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
  expect(mockToggle).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Existing contents')).toBeTruthy();
});

it.each(['/login', '/register', '/workspace-invites/accept'])('does not wrap standalone route %s', (path) => {
  mockPath = path;
  render(<AppShell><p>Standalone</p></AppShell>);
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('Standalone')).toBeTruthy();
});

it('retains guest chat without account navigation', () => {
  mockPath = '/';
  mockAuthenticated = false;
  render(<AppShell><p>Guest chat</p></AppShell>);
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText('Guest chat')).toBeTruthy();
});
