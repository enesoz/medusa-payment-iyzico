// Minimal flat config: typescript-eslint recommended over src/.
// Tightened rules (no-explicit-any as error, explicit return types) arrive with
// the provider implementation; keep the bootstrap lean but strict where it counts.
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    ignores: ['.medusa/', 'node_modules/', 'dist/'],
  }
)
