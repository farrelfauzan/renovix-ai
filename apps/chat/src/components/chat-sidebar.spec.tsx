/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { AppSidebar } from './chat-sidebar';
jest.mock('@/components/workspace/workspace-switcher', () => ({ WorkspaceSwitcher: () => null }));
jest.mock('@/hooks/use-credit-meter', () => ({
  useCreditMeter: () => ({
    data: {
      paidAvailable: '128.4', weeklyFreeAvailable: '0', level: 'none', belowFloor: false, dueReminders: [],
      projection: { status: 'date', runOutAt: '2026-12-03T07:00:00.000Z', runOutLabel: '03/12/2026 14:00', timeZone: 'Asia/Jakarta' },
    },
  }),
}));

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
jest.mock('@performa-ai/ui/components/sidebar', () => {
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

it('exposes exactly Chat, Agents and Settings navigation, plus the meter\'s top-up link', () => {
  render(<AppSidebar />);
  expect(screen.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['Chat', '/'], ['Agents', '/agents'], ['Settings', '/settings/general'], ['Top up', '/settings/billing'],
  ]);
});

it('shows account identity and the credit meter with the credits the API returns (AC1)', () => {
  render(<AppSidebar />);
  expect(screen.getByText('Test Account')).toBeTruthy();
  expect(screen.getByText('test@example.test')).toBeTruthy();
  expect(screen.getByText('Credits').parentElement?.textContent).toBe('Credits128.4');
  expect(screen.getByText('At this rate your credits run out on 03/12/2026 14:00')).toBeTruthy();
  expect(screen.queryByText('SLOT')).toBeNull();
});
