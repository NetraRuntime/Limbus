import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// When running `npm run dev`, proxy PocketBase routes to the local binary
// (default port 8090) so the frontend can use relative /api and /_/ URLs
// — matching the nginx setup used in docker-compose.
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
