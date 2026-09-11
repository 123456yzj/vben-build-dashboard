import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const backendTarget = process.env.BACKEND_URL || 'http://localhost:9527';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': backendTarget,
      '/ws': {
        target: backendTarget,
        ws: true,
      },
    },
  },
});
