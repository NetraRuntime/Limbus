import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: route /api and /_/ to the local PocketBase so the waitlist
// (and any future authenticated routes) can use relative URLs — matches
// the nginx setup used in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        ws: true,
      },
      '/_': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
      },
    },
  },
});
