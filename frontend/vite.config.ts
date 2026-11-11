import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? './' : '/',
  publicDir: mode === 'demo' ? false : 'public',
  build: { outDir: mode === 'demo' ? 'dist-demo' : 'dist' },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4000,
    proxy: mode === 'demo' ? undefined : {
      "/api": loadEnv(mode, process.cwd(), "").DOCUMIND_API_URL ?? "http://127.0.0.1:5000",
    },
  },

  assetsInclude: ['**/*.svg', '**/*.csv'],
}))
