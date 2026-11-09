/// <reference types="jest" />
import { buildCountryOptions } from './build-country-options';

it('puts Indonesia first, then Singapore and Malaysia, then the rest by name', () => {
  const options = buildCountryOptions();

  expect(options.slice(0, 3).map((option) => option.value)).toEqual(['ID', 'SG', 'MY']);
  expect(options[0].label).toBe('Indonesia');
  const rest = options.slice(3).map((option) => option.label);
  expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
});
