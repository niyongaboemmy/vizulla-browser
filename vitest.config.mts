import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@vz': fileURLToPath(new URL('./vizulla', import.meta.url)) } },
  test: {
    include: ['vizulla/**/*.test.ts'],
    exclude: ['vizulla/test/e2e/**', 'node_modules/**'],
    environment: 'node',
    // Electron-only modules are never imported by unit-tested code; see handbook §8.
    pool: 'threads',
  },
});
