/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['@swc/jest'],
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.unit.spec.ts', '<rootDir>/src/**/*.unit.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.medusa/'],
}
