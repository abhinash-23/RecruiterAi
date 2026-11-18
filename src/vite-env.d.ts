/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL for backend calls, e.g. `https://api.example.com/api`.
   *
   * Leave it unset in development: the app then uses the same-origin `/api`
   * path, which the dev server proxies (see `vite.config.ts`), so there is no
   * cross-origin request and no CORS to configure.
   */
  readonly VITE_API_BASE_URL?: string
  /**
   * Sentry project DSN. Unset means no error tracking — errors still go to the
   * console. See `lib/report-error.ts`.
   */
  readonly VITE_SENTRY_DSN?: string
  /**
   * `"false"` turns the microphone's noise suppression off for every sitting.
   * On by default; see `features/interview/mic-constraints.ts`.
   */
  readonly VITE_MIC_NOISE_SUPPRESSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
