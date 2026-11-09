// @ts-check
const { defineConfig } = require('@playwright/test');
const guard = require('./orchestrator/guard');

const target = process.env.MS_TARGET || 'http://127.0.0.1:8787';
const scope = guard.loadScope();
const check = guard.checkTarget(target, scope);
if (!check.ok) throw new Error(`[playwright.config] ${check.reason}`);

module.exports = defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'reports/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright', open: 'never' }],
    ['json', { outputFile: 'reports/playwright.json' }],
  ],
  use: { baseURL: target, extraHTTPHeaders: { Accept: 'application/json' } },
  projects: [
    { name: 'api', testMatch: /api\.spec\.js$/ },
    { name: 'access-control', testMatch: /access-control\.spec\.js$/ },
    { name: 'abuse', testMatch: /abuse\.spec\.js$/ },
  ],
  webServer: {
    command: 'node backend/test-api/server.js',
    url: `${target}/health`,
    reuseExistingServer: true,
    timeout: 15000,
    env: { MS_ENV: process.env.MS_ENV || 'test' },
  },
});
