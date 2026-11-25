/** @jest-environment node */
/// <reference types="jest" />
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadConfig = require('../next.config.js') as (phase: string, context: { defaultConfig: object }) => Promise<{ redirects: () => Promise<object[]> }>;

it('redirects /settings to the Platform settings tab of /packages-and-credits before any page renders (RNX-315 AC4)', async () => {
  const config = await loadConfig('phase-production-build', { defaultConfig: {} });
  expect(await config.redirects()).toEqual([{ source: '/settings', destination: '/packages-and-credits?tab=platform-settings', permanent: false }]);
});
