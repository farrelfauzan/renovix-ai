/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { AppSidebar } from './chat-sidebar';
jest.mock('@/components/workspace/workspace-switcher', () => ({ WorkspaceSwitcher: () => null }));

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('next/navigation', () => ({ redirect: jest.fn(), usePathname: () => '/', useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => false, name: 'Test Account', email: 'test@example.test' }),
  useChatStore: () => ({ clearChat: jest.fn() }),
}));
jest.mock('@/hooks/use-conversations', () => ({ useConversations: jest.fn(), useDeleteConversation: jest.fn() }));
jest.mock('@/lib/api', () => ({ fetchConversation: jest.fn() }));
jest.mock('sonner', () => ({ toast: {} }));
jest.mock('@/components/ui/sidebar', () => {
  const React = require('react');
  const Container = ({ children }: any) => React.createElement('div', null, children);
  return {
    Sidebar: Container, SidebarContent: Container, SidebarGroup: Container,
    SidebarGroupContent: Container, SidebarGroupLabel: Container, SidebarHeader: Container,
    SidebarMenu: Container, SidebarMenuItem: Container, SidebarMenuButton: Container,
    SidebarMenuAction: Container, useSidebar: () => ({ toggleSidebar: jest.fn() }),
  };
});

afterEach(cleanup);

it('exposes exactly Chat, Agents and Settings navigation', () => {
  render(<AppSidebar />);
  expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['Chat', '/'], ['Agents', '/agents'], ['Settings', '/settings'],
  ]);
});

it('shows account identity and an empty credit slot, not an invented balance', () => {
  render(<AppSidebar />);
  expect(screen.getByText('Test Account')).toBeTruthy();
  expect(screen.getByText('test@example.test')).toBeTruthy();
  expect(screen.getByText('Credits')).toBeTruthy();
  expect(screen.getByText('SLOT')).toBeTruthy();
  const slot = screen.getByLabelText('Credit balance unavailable');
  expect(slot.textContent).toBe('');
  expect(slot.parentElement?.textContent).toBe('CreditsSLOT');
  expect(slot.getAttribute('role')).not.toBe('progressbar');
});

it('redirects the settings entry to general without a legacy redirect cycle', () => {
  jest.isolateModules(() => {
    const { redirect } = require('next/navigation');
    require('../app/settings/page').default();
    expect(redirect).toHaveBeenCalledWith('/settings/general');
  });
});
