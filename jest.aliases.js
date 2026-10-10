/** tsconfig path aliases for Jest (unit + e2e). Keep in sync with tsconfig.json "paths". */
module.exports = {
  '^@common/(.*)$': '<rootDir>/src/common/$1',
  '^@config/(.*)$': '<rootDir>/src/config/$1',
  '^@infra/(.*)$': '<rootDir>/src/infrastructure/$1',
  '^@modules/(.*)$': '<rootDir>/src/modules/$1',
  '^@jobs/(.*)$': '<rootDir>/src/jobs/$1',
};
