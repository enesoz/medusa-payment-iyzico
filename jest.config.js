/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['@swc/jest'],
  },
  // `roots` scopes discovery to src/; a rootDir-relative testMatch glob matched nothing when the
  // checkout sits under a dot-directory (e.g. a `.claude/worktrees/*` worktree on Windows).
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.unit.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.medusa/'],
}
