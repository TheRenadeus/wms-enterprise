import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 80, // o el puerto que uses (ej: 5173)
    proxy: {
      // Todo lo que vaya a /api, Vite lo mandará a tu backend oculto
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})

