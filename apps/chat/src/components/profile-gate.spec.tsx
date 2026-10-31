/// <reference types="jest" />
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { ProfileGate } from './profile-gate';

let mockPath = '/agents';
let mockLoggedIn = true;
const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({ usePathname: () => mockPath, useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ email: 'dewi@example.test', isLoggedIn: () => mockLoggedIn }),
}));
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { get: jest.fn() } }));

// The three sign-up methods give the same /auth/me shape; they differ only in what the account already has (an
// email sign-up a typed name, Google a name and a picture, GitHub possibly neither). The gate reads profileCompleted
// alone, so each shape is gated while incomplete and let through once complete.
const SIGNUP_SHAPES = [
  ['email and password', { name: 'Dewi', avatar: null }],
  ['Google', { name: 'Dewi Anggraini', avatar: 'https://lh3.example.test/a.png' }],
  ['GitHub', { name: null, avatar: 'https://avatars.example.test/u/1' }],
] as const;

const currentUser = (profileCompleted: boolean, shape: object = {}) => ({
  id: 'u1',
  email: 'dewi@example.test',
  name: 'Dewi',
  avatar: null,
  profileCompleted,
  profileCompletedAt: profileCompleted ? '2026-10-31T00:00:00.000Z' : null,
  ...shape,
});

const renderGate = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProfileGate>
        <p>App content</p>
      </ProfileGate>
    </QueryClientProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockPath = '/agents';
  mockLoggedIn = true;
  window.history.replaceState({}, '', '/');
});
afterEach(cleanup);

it.each(SIGNUP_SHAPES)('%s sign-up, incomplete profile: an app route is replaced by the profile step, no app content', async (_method, shape) => {
  (apiClient.get as jest.Mock).mockResolvedValue(currentUser(false, shape));

  renderGate();

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding/profile?redirect=%2Fagents'));
  expect(apiClient.get).toHaveBeenCalledWith('/auth/me');
  expect(screen.queryByText('App content')).toBeNull();
});

it.each(SIGNUP_SHAPES)('%s sign-up, completed profile: the app route renders, no redirect', async (_method, shape) => {
  (apiClient.get as jest.Mock).mockResolvedValue(currentUser(true, shape));

  renderGate();

  expect(await screen.findByText('App content')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
});

it.each(['/', '/settings/general', '/workspace-invites/accept', '/help'])('incomplete profile on %s: sent to the profile step', async (path) => {
  mockPath = path;
  (apiClient.get as jest.Mock).mockResolvedValue(currentUser(false));

  renderGate();

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/onboarding/profile?redirect=${encodeURIComponent(path)}`));
});

it('keeps the query string of the requested page in redirect', async () => {
  mockPath = '/workspace-invites/accept';
  window.history.replaceState({}, '', '/workspace-invites/accept?token=abc');
  (apiClient.get as jest.Mock).mockResolvedValue(currentUser(false));

  renderGate();

  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(`/onboarding/profile?redirect=${encodeURIComponent('/workspace-invites/accept?token=abc')}`),
  );
});

it.each(['/onboarding/profile', '/login', '/register'])('incomplete profile on the exempt route %s: rendered, never redirected (no loop)', async (path) => {
  mockPath = path;
  (apiClient.get as jest.Mock).mockResolvedValue(currentUser(false));

  renderGate();

  expect(screen.getByText('App content')).toBeTruthy();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.getByText('App content')).toBeTruthy();
});

it('shows no app content while the profile is still loading', async () => {
  (apiClient.get as jest.Mock).mockReturnValue(new Promise(() => {}));

  renderGate();

  expect(screen.queryByText('App content')).toBeNull();
  expect(screen.getByLabelText('Loading')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('an anonymous visitor: rendered, no profile request, no redirect', async () => {
  mockLoggedIn = false;

  renderGate();

  expect(screen.getByText('App content')).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('the profile cannot be read (an expired session): the API decides, the gate renders the route', async () => {
  (apiClient.get as jest.Mock).mockRejectedValue(new Error('Request failed with status code 401'));

  renderGate();

  expect(await screen.findByText('App content')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
});
