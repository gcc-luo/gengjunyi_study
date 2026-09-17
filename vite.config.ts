import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    ...(mode === 'e2e' ? {} : {
      proxy: {
        '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      },
    }),
  },
}));
