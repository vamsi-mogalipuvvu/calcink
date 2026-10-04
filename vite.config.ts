import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  server: {
    port: 5173,
    open: true,
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', 'onnxruntime-web/all'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    globals: false,
    // Polyfill OffscreenCanvas for preprocessor tests
    setupFiles: ['./tests/setup.ts'],
  },
});

