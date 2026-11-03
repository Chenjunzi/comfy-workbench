import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-ignore - runtime middleware is authored as Node ESM shared with the standalone server.
import { createComfyMiddleware } from './server/comfy-server.mjs'

const comfyMiddlewarePlugin = () => ({
  name: 'comfy-preset-local-api',
  enforce: 'pre' as const,
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use(createComfyMiddleware())
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [comfyMiddlewarePlugin(), react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
