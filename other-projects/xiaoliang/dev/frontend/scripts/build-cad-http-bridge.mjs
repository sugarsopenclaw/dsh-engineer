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
  'autocad-http',
  'python',
)
const entryPath = path.join(pythonRoot, 'xiaoliang_cad_bridge', '__main__.py')
const requirementsPath = path.join(pythonRoot, 'requirements.txt')
const packagedBinDir = path.join(pythonRoot, 'packaged-bin')
const outputExePath = path.join(packagedBinDir, 'xiaoliang_cad_bridge.exe')
const buildCacheRoot = path.join(projectRoot, 'build', '.cad-http-bridge')

function log(message) {
  process.stdout.write('[cad-http-bridge-build] ' + message + '\n')
}

function fail(message) {
  process.stderr.write('[cad-http-bridge-build] ' + message + '\n')
  process.exit(1)
}

function ensurePaths() {
  if (!fs.existsSync(entryPath)) fail('bridge entry not found: ' + entryPath)
  if (!fs.existsSync(requirementsPath)) fail('requirements file not found: ' + requirementsPath)
  fs.mkdirSync(packagedBinDir, { recursive: true })
  fs.mkdirSync(buildCacheRoot, { recursive: true })
}

function run(command, args, options = {}) {
  const rendered = [command, ...args].join(' ')
  log('run: ' + rendered)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error('command failed (' + result.status + '): ' + rendered)
  }
}

function probePython(command, prefixArgs = []) {
  const result = spawnSync(
    command,
    [...prefixArgs, '-c', 'import sys; print(sys.executable)'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    },
  )
  if (result.error || result.status !== 0) return null
  const executable = String(result.stdout || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  return executable ? { command, prefixArgs, executable } : null
}

function resolvePythonRuntime() {
  const configured = [
    process.env.XIAOLIANG_CAD_BRIDGE_BUILD_PYTHON,
    process.env.CAD_PYTHON_BUILD_PATH,
    process.env.CAD_PYTHON_PATH,
    process.env.PYTHON_PATH,
  ]
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
  for (const candidate of configured) {
    const probe = probePython(candidate)
    if (probe) return probe
  }
  for (const candidate of [
    { command: 'py', prefixArgs: ['-3'] },
    { command: 'python', prefixArgs: [] },
  ]) {
    const probe = probePython(candidate.command, candidate.prefixArgs)
    if (probe) return probe
  }
  return null
}

function main() {
  ensurePaths()
  if (process.platform !== 'win32') {
    log('skip build: bridge executable is only required on Windows packaging')
    return
  }
  if (process.env.CAD_SKIP_HTTP_BRIDGE_EXE_BUILD === '1') {
    log('skip build: CAD_SKIP_HTTP_BRIDGE_EXE_BUILD=1')
    return
  }
  const runtime = resolvePythonRuntime()
  if (!runtime) {
    fail(
      'python runtime not found. Set XIAOLIANG_CAD_BRIDGE_BUILD_PYTHON '
      + 'or install Python before packaging.',
    )
  }
  log('python: ' + runtime.executable)
  run(runtime.command, [
    ...runtime.prefixArgs,
    '-m',
    'pip',
    'install',
    '-r',
    requirementsPath,
    'pyinstaller==6.21.0',
  ])
  fs.rmSync(outputExePath, { force: true })
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
    'xiaoliang_cad_bridge',
    '--distpath',
    packagedBinDir,
    '--workpath',
    workDir,
    '--specpath',
    specDir,
    '--paths',
    pythonRoot,
    '--hidden-import',
    'pythoncom',
    '--hidden-import',
    'pywintypes',
    '--hidden-import',
    'win32com',
    '--hidden-import',
    'win32com.client',
    '--collect-all',
    'fastapi',
    '--collect-all',
    'pydantic',
    '--collect-all',
    'PIL',
    '--collect-all',
    'pypdfium2',
    '--collect-all',
    'uvicorn',
    entryPath,
  ])
  if (!fs.existsSync(outputExePath)) {
    fail('build finished without output exe: ' + outputExePath)
  }
  log('ok: ' + outputExePath)
}

main()
