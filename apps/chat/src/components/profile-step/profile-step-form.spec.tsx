/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api-client';
import { currentUserQueryKey } from '@/lib/current-user-query-key';
import type { CurrentUser } from '@/hooks/use-current-user';
import { ProfileStepForm } from './profile-step-form';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@/lib/stores', () => ({ useAuthStore: () => ({ email: 'dewi@example.test' }) }));
jest.mock('@/lib/api-client', () => ({ __esModule: true, default: { put: jest.fn() } }));

const user: CurrentUser = {
  id: 'u1',
  email: 'dewi@example.test',
  name: 'Dewi Anggraini',
  avatar: null,
  jobTitle: 'Operations',
  timezone: 'UTC',
  locale: 'en',
  country: null,
  signupGoal: null,
  profileCompletedAt: null,
  profileCompleted: false,
};

const mockBrowser = ({ timeZone, language }: { timeZone: string | undefined; language: string }) => {
  const real = new Intl.DateTimeFormat().resolvedOptions();
  jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...real, timeZone } as Intl.ResolvedDateTimeFormatOptions);
  jest.spyOn(navigator, 'language', 'get').mockReturnValue(language);
};

const renderForm = (queryClient = new QueryClient()) =>
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileStepForm user={user} />
    </QueryClientProvider>,
  );

const submit = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Data analysis' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(apiClient.put).toHaveBeenCalledTimes(1));
  return (apiClient.put as jest.Mock).mock.calls[0];
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, '', '/onboarding/profile?redirect=%2Fagents%3Ftab%3Dmine');
  (apiClient.put as jest.Mock).mockResolvedValue({ ...user, profileCompleted: true });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('defaults the timezone from the browser and submits every value through the API client', async () => {
  mockBrowser({ timeZone: 'Europe/Berlin', language: 'en-US' });
  renderForm();

  const [url, body] = await submit();

  expect(url).toBe('/auth/me/profile');
  expect(body).toEqual({
    name: 'Dewi Anggraini',
    role: 'Operations',
    country: 'US',
    timezone: 'Europe/Berlin',
    language: 'en',
    goal: 'Data analysis',
  });
});

it('Indonesia and no usable browser timezone: Asia/Jakarta', async () => {
  mockBrowser({ timeZone: undefined, language: 'id-ID' });
  renderForm();

  const [, body] = await submit();

  expect(body).toMatchObject({ country: 'ID', timezone: 'Asia/Jakarta', language: 'id' });
});

it('another country and no usable browser timezone: no timezone, so it cannot be saved yet', () => {
  mockBrowser({ timeZone: undefined, language: 'en-SG' });
  renderForm();

  fireEvent.click(screen.getByRole('button', { name: 'Data analysis' }));

  expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!);
  expect(apiClient.put).not.toHaveBeenCalled();
});

it('without a goal it cannot be saved', () => {
  mockBrowser({ timeZone: 'Asia/Jakarta', language: 'id-ID' });
  renderForm();

  expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
});

it('after saving: stores the answer as the current user and goes to the requested page', async () => {
  mockBrowser({ timeZone: 'Asia/Jakarta', language: 'id-ID' });
  const queryClient = new QueryClient();
  renderForm(queryClient);

  await submit();

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/agents?tab=mine'));
  expect(queryClient.getQueryData(currentUserQueryKey('dewi@example.test'))).toMatchObject({ profileCompleted: true });
});

it('after saving without a requested page: home', async () => {
  mockBrowser({ timeZone: 'Asia/Jakarta', language: 'id-ID' });
  window.history.replaceState({}, '', '/onboarding/profile');
  renderForm();

  await submit();

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
});

it('a failed save stays on the step', async () => {
  mockBrowser({ timeZone: 'Asia/Jakarta', language: 'id-ID' });
  (apiClient.put as jest.Mock).mockRejectedValue(new Error('Request failed with status code 400'));
  renderForm();

  await submit();

  await waitFor(() => expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false));
  expect(mockReplace).not.toHaveBeenCalled();
});

it('renders no skip control (D42)', () => {
  mockBrowser({ timeZone: 'Asia/Jakarta', language: 'id-ID' });
  renderForm();

  expect(screen.queryByText(/skip/i)).toBeNull();
  expect(screen.queryAllByRole('link')).toHaveLength(0);
  expect(screen.getAllByRole('button', { name: /continue/i })).toHaveLength(1);
});
