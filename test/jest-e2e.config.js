/**
 * End-to-end tests: boot the real AppModule against a real Postgres + Redis
 * (TEST_DATABASE_URL / TEST_REDIS_URL). Run with `npm run test:e2e`, or
 * `npm run test:e2e:docker` to start throwaway containers automatically.
 */
const aliases = require('../jest.aliases');

module.exports = {
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: aliases,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  testTimeout: 60_000,
  maxWorkers: 1,
  // A suite that fails mid-boot can leave Redis/Bull sockets open; never hang CI
  forceExit: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.module.ts',
    '!src/**/dto/**',
    '!src/main.ts',
    '!src/types/**',
  ],
  coverageDirectory: '<rootDir>/coverage/e2e',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'json'],
};
