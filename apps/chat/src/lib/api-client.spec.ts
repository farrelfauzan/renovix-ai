/// <reference types="jest" />
import { toast } from 'sonner';
import { apiClient } from './api-client';

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

const rejectWith = (status: number, data: unknown) => {
  apiClient.defaults.adapter = () =>
    Promise.reject(
      Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data },
      }),
    );
};

beforeEach(() => jest.clearAllMocks());

it('shows exactly one toast, with the package copy, for a package refusal', async () => {
  rejectWith(400, { error: { type: 'PACKAGE_LIMIT_REACHED', feature: 'apiAccess', nextPackage: 'Pro' } });
  await expect(apiClient.post('/auth/keys')).rejects.toBeTruthy();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith("API keys aren't included in your package. Upgrade to Pro to use the API.");
});

it('keeps the old toast for any other 400', async () => {
  rejectWith(400, {});
  await expect(apiClient.post('/agents')).rejects.toBeTruthy();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('Request failed with status code 400');
});

it('names the failing fields, once, for an invalid-body 400', async () => {
  rejectWith(400, {
    error: { message: 'Invalid request body', type: 'invalid_request_error', details: { name: ['Required'], instructions: ['Too long'] } },
  });
  await expect(apiClient.post('/agents')).rejects.toBeTruthy();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('Invalid request body: name, instructions');
  expect(toast.error).not.toHaveBeenCalledWith('Request failed with status code 400');
});

it('says only "Invalid request body" for an invalid-body 400 without details', async () => {
  rejectWith(400, { error: { message: 'Invalid request body', type: 'invalid_request_error' } });
  await expect(apiClient.post('/agents')).rejects.toBeTruthy();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('Invalid request body');
});

it('never shows a submitted value from an invalid-body 400', async () => {
  rejectWith(400, {
    error: { message: 'Invalid request body', type: 'invalid_request_error', details: { email: ['hunter2-secret@example.test'] } },
  });
  await expect(apiClient.post('/auth/keys')).rejects.toBeTruthy();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('Invalid request body: email');
  expect(JSON.stringify((toast.error as jest.Mock).mock.calls)).not.toContain('hunter2-secret');
});

it('shows a top-level message from a 400 as before', async () => {
  rejectWith(400, { message: 'Name already taken' });
  await expect(apiClient.post('/agents')).rejects.toBeTruthy();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith('Name already taken');
});
