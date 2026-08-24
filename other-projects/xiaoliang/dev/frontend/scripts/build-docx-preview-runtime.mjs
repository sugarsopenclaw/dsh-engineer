import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import esbuild from 'esbuild'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entryPath = path.join(frontendRoot, 'src/docx-preview-runtime/entry.ts')
const cssPath = path.join(frontendRoot, 'src/docx-preview-runtime/runtime.css')
const repairPath = path.join(frontendRoot, 'src/docx-preview-runtime/repair-preview-images.ts')
const sharedPath = path.join(frontendRoot, 'src/shared/docx-preview-runtime.ts')
const templatePath = path.join(frontendRoot, 'docx-preview-runtime.html')

export const DOCX_PREVIEW_RUNTIME_FILE_NAME = 'docx-preview-runtime.html'

export const DOCX_PREVIEW_RUNTIME_WATCH_FILES = [entryPath, cssPath, repairPath, sharedPath, templatePath]

function inlineScriptForHtml(source) {
  return source.replace(/<\/script/gi, '<\\/script')
}

function renderCsp(scriptHash) {
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

export async function buildDocxPreviewRuntimeHtml() {
  const result = await esbuild.build({
    absWorkingDir: frontendRoot,
    entryPoints: [entryPath],
    outfile: path.join(frontendRoot, 'docx-preview-runtime.bundle.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    write: false,
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
  })
  const scriptFile = result.outputFiles.find((file) => file.path.endsWith('.js'))
  if (!scriptFile) throw new Error('DOCX preview runtime bundle produced no JavaScript.')

  const script = inlineScriptForHtml(scriptFile.text)
  const scriptHash = crypto.createHash('sha256').update(script, 'utf8').digest('base64')
  const template = fs.readFileSync(templatePath, 'utf8')
  if (
    !template.includes('__DOCX_RUNTIME_CSP__')
    || !template.includes('__DOCX_RUNTIME_STYLE__')
    || !template.includes('__DOCX_RUNTIME_SCRIPT__')
  ) {
    throw new Error('DOCX preview runtime HTML template is missing substitution markers.')
  }
  const style = fs.readFileSync(cssPath, 'utf8')
  return template
    .replace('__DOCX_RUNTIME_CSP__', () => renderCsp(scriptHash))
    .replace('__DOCX_RUNTIME_STYLE__', () => style)
    .replace('__DOCX_RUNTIME_SCRIPT__', () => script)
}

export function docxPreviewRuntimePlugin() {
  return {
    name: 'xiaoliang-docx-preview-runtime',
    buildStart() {
      for (const filePath of DOCX_PREVIEW_RUNTIME_WATCH_FILES) {
        this.addWatchFile(filePath)
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
        if (pathname !== `/${DOCX_PREVIEW_RUNTIME_FILE_NAME}`) {
          next()
          return
        }
        void buildDocxPreviewRuntimeHtml().then((html) => {
          response.statusCode = 200
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader('Content-Type', 'text/html; charset=utf-8')
          response.end(html)
        }).catch(next)
      })
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: DOCX_PREVIEW_RUNTIME_FILE_NAME,
        source: await buildDocxPreviewRuntimeHtml(),
      })
    },
  }
}
