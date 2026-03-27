import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'Denk Fix - Scattergories',
        short_name: 'Denk Fix',
        description: 'Das ultimative Scattergories Erlebnis auf Deutsch',
        theme_color: '#0b0f19',
        background_color: '#0b0f19',
        icons: [
          {
            src: 'logo.png',
            sizes: '1024x1024',
            type: 'image/png'
          },
          {
            src: 'logo.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'logo.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    })
  ],
})
