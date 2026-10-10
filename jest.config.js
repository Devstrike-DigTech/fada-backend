/** Unit tests: fast, no database. */
const aliases = require('./jest.aliases');

module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: aliases,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.module.ts',
    '!src/**/dto/**',
    '!src/main.ts',
    '!src/types/**',
  ],
  coverageDirectory: '<rootDir>/coverage/unit',
  coverageReporters: ['text-summary', 'lcov', 'json-summary', 'json'],
};

