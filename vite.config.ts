import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        // Precache every build asset, including the ONNX model and WASM files
        globPatterns: ['**/*.{js,css,html,onnx,wasm,mjs,woff,woff2,svg,png,ico,json}'],
        maximumFileSizeToCacheInBytes: 60 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
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
