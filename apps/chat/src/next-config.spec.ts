/** @jest-environment node */
/// <reference types="jest" />
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadConfig = require('../next.config.js') as (phase: string, context: { defaultConfig: object }) => Promise<{ redirects: () => Promise<object[]> }>;

it('redirects /settings to /settings/general before any page renders (RNX-303)', async () => {
  const config = await loadConfig('phase-production-build', { defaultConfig: {} });
  expect(await config.redirects()).toContainEqual({ source: '/settings', destination: '/settings/general', permanent: false });
});

it.each([['/profile', '/settings/general'], ['/top-up', '/settings/billing']])('redirects %s to %s before any page renders (RNX-307)', async (source, destination) => {
  const config = await loadConfig('phase-production-build', { defaultConfig: {} });
  expect(await config.redirects()).toContainEqual({ source, destination, permanent: false });
});
