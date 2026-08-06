import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    /**
     * The vendored UI primitives export their `cva` variant definitions beside
     * the component, which is the convention they arrive with and how they get
     * updated. `react-refresh/only-export-components` flags that — correctly in
     * general, because a non-component export defeats Fast Refresh for the
     * whole file.
     *
     * Allowed here rather than refactored: the cost is a dev-only full reload
     * of a file nobody edits, and splitting them would mean re-doing the split
     * every time one of these is regenerated from upstream. Narrow on purpose —
     * only this directory, and only the `*Variants` name.
     */
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        { allowExportNames: ['badgeVariants', 'buttonVariants', 'tabsListVariants'] },
      ],
    },
  },
])
