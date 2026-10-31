/// <reference types="jest" />
import { resolveDefaultTimeZone } from './resolve-default-time-zone';

it('uses the browser time zone when it gives one, whatever the country', () => {
  expect(resolveDefaultTimeZone({ detected: 'Asia/Makassar', country: 'ID' })).toBe('Asia/Makassar');
  expect(resolveDefaultTimeZone({ detected: 'Europe/Berlin', country: 'US' })).toBe('Europe/Berlin');
});

it('falls back to Asia/Jakarta for Indonesia when the browser gives none', () => {
  expect(resolveDefaultTimeZone({ detected: null, country: 'ID' })).toBe('Asia/Jakarta');
});

it('leaves it empty for another country when the browser gives none (the user picks one)', () => {
  expect(resolveDefaultTimeZone({ detected: null, country: 'SG' })).toBe('');
  expect(resolveDefaultTimeZone({ detected: null, country: '' })).toBe('');
});
