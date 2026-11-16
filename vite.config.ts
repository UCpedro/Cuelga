import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  css: { postcss: { plugins: [] } },
  server: { proxy: { '/dev-api': { target: 'http://127.0.0.1:8789', rewrite: p => p.replace(/^\/dev-api/, '') } } },
});
