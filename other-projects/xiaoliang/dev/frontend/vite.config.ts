import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

import { docxPreviewRuntimePlugin } from './scripts/build-docx-preview-runtime.mjs'

const pkgPath = path.resolve(__dirname, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string }
const appVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
const require = createRequire(import.meta.url)
const mlightWorkerDirectory = path.dirname(require.resolve('@mlightcad/cad-simple-viewer'))
const mlightWorkerNames = ['libredwg-parser-worker.js', 'mtext-renderer-worker.js'] as const

function mlightCadWorkersPlugin(): Plugin {
  return {
    name: 'xiaoliang-mlightcad-workers',
    buildStart() {
      for (const fileName of mlightWorkerNames) {
        this.addWatchFile(path.join(mlightWorkerDirectory, fileName))
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
        const fileName = mlightWorkerNames.find((candidate) => pathname === `/assets/${candidate}`)
        if (!fileName) {
          next()
          return
        }
        response.statusCode = 200
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        fs.createReadStream(path.join(mlightWorkerDirectory, fileName)).pipe(response)
      })
    },
    generateBundle() {
      for (const fileName of mlightWorkerNames) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/${fileName}`,
          source: fs.readFileSync(path.join(mlightWorkerDirectory, fileName)),
        })
      }
    },
  }
}

export default defineConfig({
  plugins: [mlightCadWorkersPlugin(), docxPreviewRuntimePlugin(), react()],
  base: './',
  server: {
    watch: {
      ignored: ['**/dist-electron/**', '**/dist-electron-pkg/**'],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        'mlight-runtime': path.resolve(__dirname, 'mlight-runtime.html'),
        'cad-preview-runtime': path.resolve(__dirname, 'cad-preview-runtime.html'),
      },
      external: ['electron'],
    },
  },
  optimizeDeps: {
    exclude: ['@mlightcad/cad-simple-viewer', 'three'],
  },
})
