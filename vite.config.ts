import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 8100, strictPort: true, allowedHosts: true },
  preview: { port: 8100, strictPort: true, allowedHosts: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
})
