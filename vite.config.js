import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageInfo from './package.json' with { type: 'json' }

export default defineConfig({
  base: './',
  define: { __SUJIAN_VERSION__: JSON.stringify(packageInfo.version) },
  plugins: [react()],
  server: { hmr: false },
})
