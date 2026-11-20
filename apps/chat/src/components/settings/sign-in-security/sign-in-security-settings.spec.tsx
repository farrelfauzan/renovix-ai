/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import SignInSecurityPage from '@/app/settings/sign-in-security/page';
import { SignInSecuritySettings } from './sign-in-security-settings';

// Better Auth's client is ESM-only; each of its calls the page makes is a mock that answers like Better Auth.
const mockAuthClient = {
  listAccounts: jest.fn(),
  changeEmail: jest.fn(),
  changePassword: jest.fn(),
  unlinkAccount: jest.fn(),
  linkSocial: jest.fn(),
  revokeOtherSessions: jest.fn(),
};
jest.mock('@/lib/auth-client', () => ({
  get authClient() {
    return mockAuthClient;
  },
}));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true, email: 'dewi@example.test' }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const SETTINGS_URL = `${window.location.origin}/settings/sign-in-security`;
const profile = { id: 'u1', email: 'dewi@example.test', emailVerified: true, name: 'Dewi Anggraini', profileCompleted: true };
const sessions = [
  { id: 's1', device: 'Chrome on macOS', lastActiveAt: '2026-11-20T03:15:00.000Z', isCurrent: true },
  { id: 's2', device: 'Safari on iPhone', lastActiveAt: '2026-11-18T09:40:00.000Z', isCurrent: false },
];
const ok = (data: unknown) => Promise.resolve({ data, error: null });

let requests: { method: string; url: string; body?: unknown }[];

beforeEach(() => {
  requests = [];
  Object.values(mockAuthClient).forEach((mock) => mock.mockReset());
  mockAuthClient.listAccounts.mockImplementation(() => ok([{ providerId: 'credential' }, { providerId: 'google' }]));
  mockAuthClient.changeEmail.mockImplementation(() => ok({ status: true }));
  mockAuthClient.changePassword.mockImplementation(() => ok({ token: null }));
  mockAuthClient.unlinkAccount.mockImplementation(() => ok({ status: true }));
  mockAuthClient.linkSocial.mockImplementation(() => ok({ url: 'https://accounts.example.test', redirect: true }));
  mockAuthClient.revokeOtherSessions.mockImplementation(() => ok({ status: true }));
  apiClient.defaults.adapter = (config: any) => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ method: config.method, url: config.url, body });
    const data = config.url === '/auth/me' ? profile : config.url === '/auth/sessions' ? sessions : '';
    return Promise.resolve({ data, status: config.method === 'post' ? 204 : 200, statusText: 'OK', headers: {}, config });
  };
});
afterEach(cleanup);

const renderPage = (linkError?: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SignInSecuritySettings linkError={linkError} />
    </QueryClientProvider>,
  );
/** The row whose label is `label` (Email, Password, Google, GitHub). */
const row = (label: string) => screen.getByText(label, { selector: 'span.font-medium' }).closest('div.border-t') as HTMLElement;
const sessionRequests = () => requests.filter((request) => request.url === '/auth/sessions');

it('shows the email with its state, Change for a password, Google connected and GitHub not connected', async () => {
  renderPage();
  await screen.findByText('dewi@example.test');
  expect(within(row('Email')).getByText('verified')).toBeTruthy();
  expect(within(row('Password')).getByRole('button', { name: 'Change' })).toBeTruthy();
  expect(within(row('Google')).getByText('Connected')).toBeTruthy();
  expect((within(row('Google')).getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement).disabled).toBe(false);
  expect(within(row('GitHub')).getByText('Not connected')).toBeTruthy();
});

it('Change email sends the new address with the link back to this page, and says the change waits for the link', async () => {
  renderPage();
  await screen.findByText('dewi@example.test');
  fireEvent.click(within(row('Email')).getByRole('button', { name: 'Change' }));
  fireEvent.change(screen.getByLabelText('New email'), { target: { value: ' dewi@newmail.test ' } });

  fireEvent.click(screen.getByRole('button', { name: 'Send confirmation link' }));

  await waitFor(() => expect(mockAuthClient.changeEmail).toHaveBeenCalledTimes(1));
  expect(mockAuthClient.changeEmail).toHaveBeenCalledWith({ newEmail: 'dewi@newmail.test', callbackURL: SETTINGS_URL });
  expect((await screen.findByRole('status')).textContent).toBe('We sent a link to dewi@newmail.test. Your email changes when you open it.');
  expect(screen.getByText('dewi@example.test')).toBeTruthy();
});

it('Change password sends the current and the new password; it cannot be sent without the current one', async () => {
  renderPage();
  await screen.findByText('dewi@example.test');
  fireEvent.click(within(row('Password')).getByRole('button', { name: 'Change' }));
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-new-made-up-password' } });
  expect((screen.getByRole('button', { name: 'Change password' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'the-old-made-up-password' } });

  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

  await waitFor(() => expect(mockAuthClient.changePassword).toHaveBeenCalledTimes(1));
  expect(mockAuthClient.changePassword).toHaveBeenCalledWith({ currentPassword: 'the-old-made-up-password', newPassword: 'a-new-made-up-password' });
});

describe('RNX-78 AC6: a user who signed up with Google only', () => {
  beforeEach(() => mockAuthClient.listAccounts.mockImplementation(() => ok([{ providerId: 'google' }])));

  it('sees "Set a password" (no Change), and Google cannot be disconnected (AC1)', async () => {
    renderPage();
    await screen.findByText('dewi@example.test');
    expect(within(row('Password')).getByRole('button', { name: 'Set a password' })).toBeTruthy();
    expect(within(row('Password')).queryByRole('button', { name: 'Change' })).toBeNull();
    expect((within(row('Google')).getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(row('Google')).getByText(/your only way to sign in/)).toBeTruthy();
  });

  it('Set password sends POST /auth/password with the new password, then reads the sign-in methods again', async () => {
    renderPage();
    await screen.findByText('dewi@example.test');
    fireEvent.click(within(row('Password')).getByRole('button', { name: 'Set a password' }));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-first-made-up-password' } });
    mockAuthClient.listAccounts.mockImplementation(() => ok([{ providerId: 'google' }, { providerId: 'credential' }]));

    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(requests.filter((request) => request.method === 'post')).toHaveLength(1));
    expect(requests.find((request) => request.method === 'post')).toEqual({
      method: 'post',
      url: '/auth/password',
      body: { newPassword: 'a-first-made-up-password' },
    });
    expect(await within(row('Password')).findByRole('button', { name: 'Change' })).toBeTruthy();
    expect(mockAuthClient.listAccounts).toHaveBeenCalledTimes(2);
  });
});

it('Disconnect sends unlink-account for Google', async () => {
  renderPage();
  await screen.findByText('dewi@example.test');

  fireEvent.click(within(row('Google')).getByRole('button', { name: 'Disconnect' }));

  await waitFor(() => expect(mockAuthClient.unlinkAccount).toHaveBeenCalledWith({ providerId: 'google' }));
});

it('Connect sends link-social for GitHub, coming back to this page on success and on refusal', async () => {
  renderPage();
  await screen.findByText('dewi@example.test');

  fireEvent.click(within(row('GitHub')).getByRole('button', { name: 'Connect' }));

  await waitFor(() => expect(mockAuthClient.linkSocial).toHaveBeenCalledTimes(1));
  expect(mockAuthClient.linkSocial).toHaveBeenCalledWith({ provider: 'github', callbackURL: SETTINGS_URL, errorCallbackURL: SETTINGS_URL });
});

it('RNX-78 AC7: a link refused for a different email comes back with a clear message', () => {
  renderPage("email_doesn't_match");

  expect(screen.getByRole('alert').textContent).toBe(
    'That account uses a different email address. You can only link a Google or GitHub account with the same email as your Renovix account.',
  );
});

it('the page passes the error Better Auth put on the URL to the settings', async () => {
  const element = await SignInSecurityPage({ searchParams: Promise.resolve({ error: "email_doesn't_match" }) });

  expect(element.props).toEqual({ linkError: "email_doesn't_match" });
});

it('RNX-78 AC8: each session row shows the device and the last-active time, and nothing else (no location)', async () => {
  renderPage();
  const list = await screen.findByRole('list', { name: 'Active sessions' });
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const rows = within(list).getAllByRole('listitem').map((item) => item.textContent);

  expect(rows).toEqual([
    `Chrome on macOSThis deviceLast active ${format.format(new Date(sessions[0].lastActiveAt))}`,
    `Safari on iPhoneLast active ${format.format(new Date(sessions[1].lastActiveAt))}`,
  ]);
});

it('Sign out others sends revoke-other-sessions, then reads the session list again', async () => {
  renderPage();
  await screen.findByRole('list', { name: 'Active sessions' });
  expect(sessionRequests()).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Sign out others' }));

  await waitFor(() => expect(mockAuthClient.revokeOtherSessions).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(sessionRequests()).toHaveLength(2));
});
