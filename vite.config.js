import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: parseInt(process.env.PORT) || 5173,
    host: true,
    proxy: {
      '/analyze': 'http://localhost:3001',
    },
  },
});
