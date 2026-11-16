import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', use: { baseURL: 'http://127.0.0.1:5178', viewport: { width: 390, height: 844 } },
  webServer: { command: 'npm run dev', env: { VITE_CUELGA_API: 'http://127.0.0.1:5178/api/movil/v1' }, url: 'http://127.0.0.1:5178', reuseExistingServer: false, timeout: 30000 },
});
