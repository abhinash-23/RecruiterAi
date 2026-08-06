import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

/**
 * Fallback backend for local development. Override it without touching this
 * file by putting `VITE_API_PROXY_TARGET=...` in `.env.local` — handy because
 * a free ngrok tunnel gets a new hostname every restart.
 */
const DEFAULT_API_TARGET = "https://frostily-exert-epilogue.ngrok-free.dev"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        /**
         * The app calls same-origin `/api/...`; the dev server forwards it to
         * the backend. Since the browser never makes a cross-origin request,
         * CORS doesn't apply and the backend needs no localhost allow-list.
         *
         * No path rewrite: `/api/auth/login` here is `/api/auth/login` there.
         *
         * A **regex**, not the plain `"/api"` prefix it used to be. Vite matches
         * a string key as a prefix, so `/api-architecture.png` — a static image
         * in `public/` — matched too, and every request for it was forwarded to
         * the backend, which answered 404. The landing page's architecture
         * diagram was a broken image for that reason alone. This matches the
         * `/api` path *segment* and nothing that merely starts with those
         * characters.
         */
        "^/api(?:/|$)": {
          target: env.VITE_API_PROXY_TARGET || DEFAULT_API_TARGET,
          changeOrigin: true,
          // Live viewing signals over `WS /api/live/{id}`. Without this the
          // proxy answers the upgrade request with a 404 and the socket never
          // opens — only reachable through this path, since a production build
          // has no proxy and talks to the backend directly.
          ws: true,
          // Free ngrok tunnels serve an HTML warning page to anything that
          // looks like a browser. This header asks for the real response.
          headers: { "ngrok-skip-browser-warning": "true" },
        },
      },
    },
  }
})
