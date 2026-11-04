import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // host: true permite abrirla desde el móvil en la misma red (o por Tailscale).
    host: true,
    proxy: {
      // API_PORT permite levantar otra instancia (p. ej. para pruebas) sin chocar con la normal.
      '/api': `http://localhost:${process.env.API_PORT ?? 3001}`,
    },
  },
});
