/* eslint-disable */
// API tests (docs/testing.md). Database tests need TEST_DATABASE_URL.
module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
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
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // Database tests share one database and truncate it, so files run one at a time.
  maxWorkers: 1,
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
