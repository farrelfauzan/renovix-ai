/// <reference types="jest" />
import { detectTimeZone } from './detect-time-zone';

const mockBrowserTimeZone = (timeZone: string | undefined) => {
  const real = new Intl.DateTimeFormat().resolvedOptions();
  jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...real, timeZone } as Intl.ResolvedDateTimeFormatOptions);
};

afterEach(() => jest.restoreAllMocks());

it('returns the browser time zone', () => {
  mockBrowserTimeZone('Asia/Makassar');
  expect(detectTimeZone()).toBe('Asia/Makassar');
});

it.each([undefined, '', 'Etc/Unknown'])('returns null when the browser gives nothing usable (%p)', (timeZone) => {
  mockBrowserTimeZone(timeZone);
  expect(detectTimeZone()).toBeNull();
});
