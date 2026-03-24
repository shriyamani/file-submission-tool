import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    allowedHosts: ['unventurous-hazardously-janay.ngrok-free.dev'],
  },
})
