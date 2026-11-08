/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rolldownOptions: {
      // The app, plus the token showcase page (/tokens.html), which is only for checking the theme.
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        tokens: path.resolve(import.meta.dirname, 'tokens.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Each PGlite test file replays every migration in beforeAll, which passes the 10 s default on a loaded machine.
    hookTimeout: 60_000,
    // The page tests mount the whole Editor and walk it for seconds, so on a loaded machine they pass the 5 s default
    // that is right for unit tests. They get 20 s; a retry would hide a real failure and is not used.
    projects: [
      { extends: true, test: { name: 'unit', exclude: ['**/node_modules/**', 'src/pages/**'] } },
      { extends: true, test: { name: 'pages', include: ['src/pages/**/*.test.{ts,tsx}'], testTimeout: 20_000 } },
    ],
  },
})
