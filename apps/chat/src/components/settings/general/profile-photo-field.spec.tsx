/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { CurrentUser } from '@/hooks/use-current-user';
import { ProfilePhotoField } from './profile-photo-field';

jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true, email: 'dewi@example.test' }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
// Radix draws the image only once the browser has loaded it (never, in jsdom): plain elements show what src is used.
jest.mock('@performa-ai/ui/components/avatar', () => ({
  Avatar: ({ children }: any) => <span>{children}</span>,
  AvatarImage: ({ src, alt }: any) => <img src={src} alt={alt} />,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));

// RNX-334: the photo of Settings > General > Profile, against a fake API behind the real api-client (the requests sent
// are asserted). The "server" keeps the photo between renders, so a re-render with a fresh query cache is a reload.
const user = { id: 'u1', email: 'dewi@example.test', name: 'Dewi Anggraini', avatar: 'users/u1/profile-photo/stored.png' } as CurrentUser;

type Request = { method: string; url: string; body?: unknown };
let requests: Request[];
let serverPhoto: string | null;
let nextFailure: { status: number; data: unknown } | null;

beforeEach(() => {
  requests = [];
  serverPhoto = null;
  nextFailure = null;
  apiClient.defaults.adapter = (config: any) => {
    requests.push({ method: config.method, url: config.url, body: config.data });
    const fail = config.method !== 'get' && nextFailure;
    if (fail) {
      nextFailure = null;
      return Promise.reject(Object.assign(new Error('failed'), { isAxiosError: true, config, response: { status: fail.status, data: fail.data, headers: {}, config } }));
    }
    if (config.method === 'put') serverPhoto = 'https://signed.example.test/users/u1/profile-photo/new.png?sig=2';
    if (config.method === 'delete') serverPhoto = null;
    const data = config.method === 'get' ? { url: serverPhoto } : undefined;
    return Promise.resolve({ data, status: config.method === 'delete' ? 204 : 200, statusText: 'OK', headers: {}, config });
  };
});
afterEach(cleanup);

/** Renders the field as after a reload: a fresh query cache, so the photo shown comes from the API. */
const renderField = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProfilePhotoField user={user} />
    </QueryClientProvider>,
  );
const photoSources = (container: HTMLElement) => Array.from(container.querySelectorAll('img')).map((image) => image.getAttribute('src'));
const chooseFile = (file: File) => fireEvent.change(screen.getByLabelText('Choose a photo'), { target: { files: [file] } });
const mutations = () => requests.filter((request) => request.method !== 'get');

it('AC1: with no photo it shows the initials and Upload (no Remove); the only request is GET /auth/me/photo', async () => {
  const { container } = renderField();

  await screen.findByText('Upload');

  expect(screen.getByText('DA')).toBeTruthy();
  expect(photoSources(container)).toEqual([]);
  expect(screen.queryByText('Remove')).toBeNull();
  expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual(['get /auth/me/photo']);
});

it('AC1: choosing a PNG sends PUT /auth/me/photo with the file as multipart, then shows the photo, also after a reload', async () => {
  const { container } = renderField();
  await screen.findByText('Upload');

  chooseFile(new File([new Uint8Array(10)], 'me.png', { type: 'image/png' }));

  await waitFor(() => expect(photoSources(container)).toEqual(['https://signed.example.test/users/u1/profile-photo/new.png?sig=2']));
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0]).toMatchObject({ method: 'put', url: '/auth/me/photo' });
  expect((mutations()[0].body as FormData).get('file')).toBeInstanceOf(File);
  expect(((mutations()[0].body as FormData).get('file') as File).name).toBe('me.png');
  expect(screen.getByText('Replace')).toBeTruthy();
  cleanup();
  const reloaded = renderField();
  await screen.findByText('Replace');
  expect(photoSources(reloaded.container)).toEqual(['https://signed.example.test/users/u1/profile-photo/new.png?sig=2']);
});

it('AC1: Remove sends DELETE /auth/me/photo; afterwards there is no photo, also after a reload', async () => {
  serverPhoto = 'https://signed.example.test/users/u1/profile-photo/old.png?sig=1';
  const { container } = renderField();
  fireEvent.click(await screen.findByText('Remove'));

  await screen.findByText('Upload');

  expect(mutations()).toEqual([{ method: 'delete', url: '/auth/me/photo', body: undefined }]);
  expect(photoSources(container)).toEqual([]);
  cleanup();
  const reloaded = renderField();
  await screen.findByText('Upload');
  expect(photoSources(reloaded.container)).toEqual([]);
});

it('never uses the avatar column (a storage key) as an image address', async () => {
  const { container } = renderField();

  await screen.findByText('Upload');

  expect(photoSources(container)).not.toContain(user.avatar);
  expect(photoSources(container)).toEqual([]);
});

describe('AC2/AC4: the file is checked before sending, for a friendly message (the API decides)', () => {
  it.each([
    ['a GIF', new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' }), 'Use a PNG, JPEG or WebP image.'],
    ['a PDF', new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }), 'Use a PNG, JPEG or WebP image.'],
    ['a PNG over 2 MB', new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }), 'The photo must be 2 MB or smaller.'],
  ])('%s: the message is shown and nothing is sent', async (_name, inputFile, expectedMessage) => {
    renderField();
    await screen.findByText('Upload');

    chooseFile(inputFile);

    expect((await screen.findByRole('alert')).textContent).toBe(expectedMessage);
    expect(mutations()).toEqual([]);
  });

  it('a file of exactly 2 MB is sent', async () => {
    renderField();
    await screen.findByText('Upload');

    chooseFile(new File([new Uint8Array(2 * 1024 * 1024)], 'limit.png', { type: 'image/png' }));

    await waitFor(() => expect(mutations()).toHaveLength(1));
  });
});

describe('failures are shown in place', () => {
  it('a refusal from the API shows its message under the photo; the photo is unchanged', async () => {
    const { container } = renderField();
    await screen.findByText('Upload');
    nextFailure = { status: 400, data: { error: { message: 'Invalid request body', type: 'invalid_request_error', details: { file: ['The photo is larger than the 2 MB limit.'] } } } };

    chooseFile(new File([new Uint8Array(10)], 'me.png', { type: 'image/png' }));

    expect((await screen.findByRole('alert')).textContent).toBe('The photo is larger than the 2 MB limit.');
    expect(photoSources(container)).toEqual([]);
    expect(screen.getByText('Upload')).toBeTruthy();
  });

  it('a failed removal says so and the photo stays', async () => {
    serverPhoto = 'https://signed.example.test/users/u1/profile-photo/old.png?sig=1';
    const { container } = renderField();
    await screen.findByText('Remove');
    nextFailure = { status: 500, data: {} };

    fireEvent.click(screen.getByText('Remove'));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not remove the photo. Try again.');
    expect(photoSources(container)).toEqual(['https://signed.example.test/users/u1/profile-photo/old.png?sig=1']);
  });

  it('shows Loading while the photo loads and an error with Try again when it cannot be loaded', async () => {
    apiClient.defaults.adapter = (config: any) =>
      Promise.reject(Object.assign(new Error('down'), { isAxiosError: true, config, response: { status: 500, data: {}, headers: {}, config } }));
    renderField();
    expect(screen.getByRole('status').textContent).toBe('Loading photo...');

    const alert = await screen.findByRole('alert');

    expect(alert.textContent).toContain('Could not load your photo.');
    expect(screen.getByText('Try again')).toBeTruthy();
  });
});
