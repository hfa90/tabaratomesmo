// Testes automáticos do site (rodam no GitHub a cada envio: .github/workflows/testes.yml).
// Local: npm install && npx playwright install chromium && npm test
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: 'http://localhost:4173', locale: 'pt-BR', timezoneId: 'America/Manaus', trace: 'retain-on-failure' },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 7'] } },
    { name: 'computador', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: { command: 'python3 -m http.server 4173', url: 'http://localhost:4173', reuseExistingServer: true },
});
