import { defineConfig } from 'vite';

export default defineConfig({
  // Serve from project root; index.html lives at root
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
});
