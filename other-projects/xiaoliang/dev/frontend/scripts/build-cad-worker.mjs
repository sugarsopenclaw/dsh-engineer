import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const pythonRoot = path.join(
  projectRoot,
  'electron',
  'runtime',
  'cad',
  'drivers',
  'autocad-com',
  'python',
)
const entryPath = path.join(pythonRoot, 'cad_worker.py')
const requirementsPath = path.join(pythonRoot, 'requirements.txt')
const packagedBinDir = path.join(pythonRoot, 'packaged-bin')
const outputExePath = path.join(packagedBinDir, 'cad_worker.exe')
const buildCacheRoot = path.join(projectRoot, 'build', '.cad-worker')

function log(message) {
  process.stdout.write(`[cad-worker-build] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[cad-worker-build] ${message}\n`)
  process.exit(1)
}

function ensurePaths() {
  if (!fs.existsSync(entryPath)) {
    fail(`worker entry not found: ${entryPath}`)
  }
  if (!fs.existsSync(requirementsPath)) {
    fail(`requirements file not found: ${requirementsPath}`)
  }
  fs.mkdirSync(packagedBinDir, { recursive: true })
  fs.mkdirSync(buildCacheRoot, { recursive: true })
}

function run(command, args, options = {}) {
  const rendered = [command, ...args].join(' ')
  log(`run: ${rendered}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status}): ${rendered}`)
  }
}

function probePython(command, prefixArgs = []) {
  const args = [...prefixArgs, '-c', 'import sys; print(sys.executable)']
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.error || result.status !== 0) {
    return null
  }
  const executable = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  if (!executable) return null
  return {
    command,
    prefixArgs,
    executable,
  }
}

function resolvePythonRuntime() {
  const envCandidates = [
    process.env.CAD_PYTHON_BUILD_PATH,
    process.env.CAD_PYTHON_PATH,
    process.env.PYTHON_PATH,
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  for (const envPath of envCandidates) {
    const probe = probePython(envPath, [])
    if (probe) return probe
  }

  const launcherCandidates = [
    { command: 'py', prefixArgs: ['-3'] },
    { command: 'python', prefixArgs: [] },
  ]
  for (const candidate of launcherCandidates) {
    const probe = probePython(candidate.command, candidate.prefixArgs)
    if (probe) return probe
  }
  return null
}

function main() {
  ensurePaths()

  if (process.platform !== 'win32') {
    log('skip build: cad worker exe is only required on Windows packaging')
    return
  }
  if (process.env.CAD_SKIP_WORKER_EXE_BUILD === '1') {
    log('skip build: CAD_SKIP_WORKER_EXE_BUILD=1')
    return
  }

  const runtime = resolvePythonRuntime()
  if (!runtime) {
    fail(
      'python runtime not found. Set CAD_PYTHON_BUILD_PATH or install Python/py launcher before packaging.',
    )
  }

  log(`python: ${runtime.executable}`)

  run(runtime.command, [
    ...runtime.prefixArgs,
    '-m',
    'pip',
    'install',
    '-r',
    requirementsPath,
    'pyinstaller',
  ])

  if (fs.existsSync(outputExePath)) {
    fs.rmSync(outputExePath, { force: true })
  }

  const workDir = path.join(buildCacheRoot, 'work')
  const specDir = path.join(buildCacheRoot, 'spec')
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.rmSync(specDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(specDir, { recursive: true })

  run(runtime.command, [
    ...runtime.prefixArgs,
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onefile',
    '--name',
    'cad_worker',
    '--distpath',
    packagedBinDir,
    '--workpath',
    workDir,
    '--specpath',
    specDir,
    '--paths',
    path.join(pythonRoot, 'billnova_bridge'),
    '--hidden-import',
    'pythoncom',
    '--hidden-import',
    'pywintypes',
    '--hidden-import',
    'win32com',
    '--hidden-import',
    'win32com.client',
    '--hidden-import',
    'pypdfium2',
    '--hidden-import',
    'pypdfium2_raw',
    // pypdfium2 bundles a native pdfium binary that must be collected explicitly
    '--collect-all',
    'pypdfium2',
    '--collect-all',
    'pypdfium2_raw',
    entryPath,
  ])

  if (!fs.existsSync(outputExePath)) {
    fail(`build finished without output exe: ${outputExePath}`)
  }

  log(`ok: ${outputExePath}`)
}

main()
