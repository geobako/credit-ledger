/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  transform: { '^.+\\.ts$': 'ts-jest' },
  testEnvironment: 'node',
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testRegex: '.*\\.spec\\.ts$' },
    {
      ...base,
      displayName: 'integration',
      testRegex: '.*\\.int-spec\\.ts$',
      globalSetup: '<rootDir>/test/global-setup.ts',
      globalTeardown: '<rootDir>/test/global-teardown.ts',
      setupFilesAfterEnv: ['<rootDir>/test/setup-integration.ts'],
    },
  ],
};
