/* eslint-disable */
// API tests (docs/testing.md). Database tests need TEST_DATABASE_URL.
module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    // otplib's dependencies @scure/base 2 and @noble/hashes 2 ship ESM only, which Jest's CommonJS runtime
    // cannot load (RX-94): those two packages, and nothing else in node_modules, are compiled to CommonJS.
    '/node_modules/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', moduleResolution: 'node' }, diagnostics: false },
    ],
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        // Type errors are reported by `tsc -p apps/api/tsconfig.spec.json`, not here.
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    // tsconfig path alias, and the ".js" suffixes in ESM-style imports (generated Prisma client).
    '^@generated/prisma/(.*)\\.js$': '<rootDir>/src/generated/prisma/$1',
    // Also applies to relative imports inside node_modules.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Bun's layout: node_modules/.bun/<name>@<version>/node_modules/<name>/...; both segments must be let through.
  transformIgnorePatterns: ['/node_modules/(?!\\.bun/@scure\\+base@2|\\.bun/@noble\\+hashes@2|@scure/base/|@noble/hashes/)'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // Database tests share one database and truncate it, so files run one at a time.
  maxWorkers: 1,
  // Applies to every test and every hook (Jest's default is 5 s). resetDatabase takes about 0.1 s, but under
  // machine load (RNX-204) a hook measured up to about 16 s; a hook or test that never ends still fails here.
  testTimeout: 30000,
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
