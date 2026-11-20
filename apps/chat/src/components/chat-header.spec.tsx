/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { ChatHeader } from './chat-header';

let mockUsage: { data?: unknown } = {};
jest.mock('@/hooks/use-portal', () => ({ usePortalUsage: () => mockUsage }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true, name: 'Test Account', email: 'test@example.test', avatar: null, logout: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('@/lib/auth-client', () => ({ signOut: jest.fn() }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: any) => <div>{children}</div>;
  return { Tooltip: Container, TooltipTrigger: Container, TooltipContent: Container };
});

afterEach(cleanup);

describe('AC4: the old header pills are gone', () => {
  it.each([
    ['a free account', { tier: 'free', used: 3, limit: 10, remaining: 7 }],
    ['a paid account', { tier: 'paid', balance: '12.5' }],
  ])('shows no free-request counter and no dollar balance for %s', (_name, usage) => {
    mockUsage = { data: usage };
    const { container } = render(<ChatHeader />);
    expect(screen.getByText('TA')).toBeTruthy();
    expect(screen.queryByText(/\d+ left/)).toBeNull();
    expect(container.textContent).not.toContain('$');
    expect(container.textContent).not.toMatch(/Free tier|credit balance/i);
  });
});
