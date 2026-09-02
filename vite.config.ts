import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://<user>.github.io/hanzi-trainer/ - override with BASE_PATH for other hosts.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/hanzi-trainer/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
