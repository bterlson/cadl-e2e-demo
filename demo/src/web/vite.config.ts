import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      external: ['node-fetch']
    },
    outDir: "build",
  },

  optimizeDeps: {
    exclude: ['node-fetch']
  },
  plugins: [svelte()]
})
