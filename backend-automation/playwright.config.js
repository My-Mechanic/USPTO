import { defineConfig } from '@playwright/test';

// This project mainly uses Playwright as a library (scripts/patent-center.js).
// This config is provided for completeness and for anyone who wants to add
// .spec.js tests. Headless is OFF and the real Chrome channel is preferred,
// because Patent Center requires an interactive, human sign-in (MFA) and
// reliably blocks headless automation.
export default defineConfig({
  timeout: 0,
  fullyParallel: false,
  use: {
    headless: false,
    channel: 'chrome',
    viewport: null,
    actionTimeout: 0,
  },
});
