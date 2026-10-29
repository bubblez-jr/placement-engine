import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build` → normal multi-file build for Vercel.
// `npm run build:demo` → one self-contained HTML file (dist-demo/index.html)
// for sharing a click-through demo without hosting.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  build: mode === 'demo' ? { outDir: 'dist-demo', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 } : { chunkSizeWarningLimit: 2_000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}))
