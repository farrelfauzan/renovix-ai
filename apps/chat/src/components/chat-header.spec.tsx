/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { ChatHeader } from './chat-header';

let mockUsage: { data?: unknown } = {};
let mockPhoto: { data?: { url: string | null } } = {};
let mockStoreAvatar: string | null = null;
jest.mock('@/hooks/use-portal', () => ({ usePortalUsage: () => mockUsage }));
jest.mock('@/hooks/use-profile-photo', () => ({ useProfilePhoto: () => mockPhoto }));
// Radix draws the image only once the browser has loaded it (never, in jsdom): plain elements show what src is chosen.
jest.mock('@performa-ai/ui/components/avatar', () => ({
  Avatar: ({ children }: any) => <span>{children}</span>,
  AvatarImage: ({ src, alt }: any) => <img src={src} alt={alt} />,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true, name: 'Test Account', email: 'test@example.test', avatar: mockStoreAvatar, logout: jest.fn() }),
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

describe('RNX-334: the header shows the user own photo from the photo route, never the avatar column', () => {
  afterEach(() => {
    mockPhoto = {};
    mockStoreAvatar = null;
  });

  it('shows the URL the photo route gave, and ignores the avatar the auth store holds (a storage key)', () => {
    mockUsage = { data: undefined };
    mockPhoto = { data: { url: 'https://signed.example.test/users/u1/profile-photo/p.png?sig=1' } };
    mockStoreAvatar = 'users/u1/profile-photo/p.png';

    const { container } = render(<ChatHeader />);

    const sources = Array.from(container.querySelectorAll('img')).map((image) => image.getAttribute('src'));
    expect(sources).toEqual(['https://signed.example.test/users/u1/profile-photo/p.png?sig=1']);
  });

  it('shows the initials and no image when the user has no photo', () => {
    mockUsage = { data: undefined };
    mockPhoto = { data: { url: null } };
    mockStoreAvatar = 'users/u1/profile-photo/p.png';

    const { container } = render(<ChatHeader />);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('TA')).toBeTruthy();
  });
});
