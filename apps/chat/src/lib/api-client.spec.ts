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
