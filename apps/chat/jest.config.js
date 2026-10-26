module.exports = {
  displayName: 'chat',
  testEnvironment: 'jsdom',
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', esModuleInterop: true }, diagnostics: false }],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
};
