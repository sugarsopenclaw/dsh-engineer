import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const pythonRoot = path.join(projectRoot, 'electron', 'runtime', 'project-files', 'python')
const requirementsPath = path.join(pythonRoot, 'requirements.txt')
const packagedBinDir = path.join(pythonRoot, 'packaged-bin')
const buildCacheRoot = path.join(projectRoot, 'build', '.project-file-workers')
const workers = [
  {
    name: 'artifact_worker',
    entryPath: path.join(pythonRoot, 'artifact_worker.py'),
    outputExePath: path.join(packagedBinDir, 'artifact_worker.exe'),
    hiddenImports: ['openpyxl', 'docx', 'pptx'],
  },
]

function log(message) {
  process.stdout.write(`[artifact-worker-build] ${message}\n`)
}

function fail(message) {
  process.stderr.write(`[artifact-worker-build] ${message}\n`)
  process.exit(1)
}

function ensurePaths() {
  for (const worker of workers) {
    if (!fs.existsSync(worker.entryPath)) {
      fail(`worker entry not found: ${worker.entryPath}`)
    }
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
  const result = spawnSync(command, [...prefixArgs, '-c', 'import sys; print(sys.executable)'], {
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
  return { command, prefixArgs, executable }
}

function resolvePythonRuntime() {
  const envCandidates = [
    process.env.ARTIFACT_PYTHON_BUILD_PATH,
    process.env.XIAOLIANG_ARTIFACT_PYTHON_PATH,
    process.env.PYTHON_PATH,
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  for (const envPath of envCandidates) {
    const probe = probePython(envPath, [])
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
    log('skip build: artifact worker exe is only required on Windows packaging')
    return
  }
  if (process.env.ARTIFACT_SKIP_WORKER_EXE_BUILD === '1') {
    log('skip build: ARTIFACT_SKIP_WORKER_EXE_BUILD=1')
    return
  }

  const runtime = resolvePythonRuntime()
  if (!runtime) {
    fail(
      'python runtime not found. Set ARTIFACT_PYTHON_BUILD_PATH or install Python/py launcher before packaging.',
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

  for (const worker of workers) {
    if (fs.existsSync(worker.outputExePath)) {
      fs.rmSync(worker.outputExePath, { force: true })
    }

    const workDir = path.join(buildCacheRoot, worker.name, 'work')
    const specDir = path.join(buildCacheRoot, worker.name, 'spec')
    fs.rmSync(workDir, { recursive: true, force: true })
    fs.rmSync(specDir, { recursive: true, force: true })
    fs.mkdirSync(workDir, { recursive: true })
    fs.mkdirSync(specDir, { recursive: true })

    const hiddenImportArgs = worker.hiddenImports.flatMap((item) => ['--hidden-import', item])
    run(runtime.command, [
      ...runtime.prefixArgs,
      '-m',
      'PyInstaller',
      '--noconfirm',
      '--clean',
      '--onefile',
      '--name',
      worker.name,
      '--distpath',
      packagedBinDir,
      '--workpath',
      workDir,
      '--specpath',
      specDir,
      ...hiddenImportArgs,
      worker.entryPath,
    ])

    if (!fs.existsSync(worker.outputExePath)) {
      fail(`build finished without output exe: ${worker.outputExePath}`)
    }
    log(`ok: ${worker.outputExePath}`)
  }
}

main()
