import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  // Assumes `docker compose up` is already running.
  // Run with: cd e2e && npm ci && npm run install-browsers && npm test
})
