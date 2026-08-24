import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

const DEFAULT_STDOUT_LIMIT_BYTES = 1024 * 1024
const STDERR_TAIL_CHARS = 16_000

const COMMAND_TIMEOUTS: Readonly<Record<string, number>> = Object.freeze({
  ingest: 60 * 60_000,
  build: 60 * 60_000,
  bind: 30 * 60_000,
  status: 20_000,
  ask: 30 * 60_000,
  lookup: 60_000,
  probe: 60_000,
})

export function cadstackCommandTimeoutMs(command: string): number {
  return COMMAND_TIMEOUTS[command] ?? 60_000
}

const CADSTACK_SOURCE_PACKAGES = [
  'cadstack',
  'cadkernel',
  'cadpatterns',
  'cadsemantics',
  'cadtasks',
] as const

export interface CadstackLaunchSpec {
  command: string
  args: string[]
  label: string
}

export interface CadstackResponse extends Record<string, unknown> {
  ok: true
  command: string
}

export interface CadstackRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  stdoutLimitBytes?: number
}

export interface CadstackRuntimeOptions {
  launchSpecs?: readonly CadstackLaunchSpec[]
  environment?: NodeJS.ProcessEnv
  cwd?: string
  spawnProcess?: typeof spawn
}

class CadstackLaunchUnavailableError extends Error {}

export class CadstackCommandError extends Error {
  readonly response: Record<string, unknown> | null

  constructor(message: string, response: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'CadstackCommandError'
    this.response = response
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const value of values) {
    const identity = key(value)
    if (seen.has(identity)) continue
    seen.add(identity)
    result.push(value)
  }
  return result
}

function sourcePackageRootCandidates(cwd: string, environment: NodeJS.ProcessEnv): string[] {
  const explicit = environment.XIAOLIANG_CADSTACK_ROOT?.trim()
  const candidates = [
    explicit || '',
    path.join(cwd, 'cadstack'),
    path.resolve(cwd, '..', '..', 'cadstack'),
    path.resolve(cwd, '..', 'cadstack'),
  ]
  return unique(
    candidates
      .filter(Boolean)
      .map((candidate) => path.resolve(candidate))
      .filter((candidate) => fs.existsSync(path.join(candidate, 'pyproject.toml'))),
    (value) => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value,
  )
}

function pythonCandidates(
  sourceRoots: readonly string[],
  environment: NodeJS.ProcessEnv,
): Array<{ command: string; prefixArgs: string[]; label: string }> {
  const candidates: Array<{ command: string; prefixArgs: string[]; label: string } | null> = [
    environment.XIAOLIANG_CADSTACK_PYTHON?.trim()
      ? {
          command: environment.XIAOLIANG_CADSTACK_PYTHON.trim(),
          prefixArgs: [],
          label: 'XIAOLIANG_CADSTACK_PYTHON',
        }
      : null,
    environment.PYTHON_PATH?.trim()
      ? {
          command: environment.PYTHON_PATH.trim(),
          prefixArgs: [],
          label: 'PYTHON_PATH',
        }
      : null,
  ]
  for (const sourceRoot of sourceRoots) {
    const repositoryRoot = path.dirname(sourceRoot)
    const venvCandidates = process.platform === 'win32'
      ? [
          path.join(sourceRoot, '.venv', 'Scripts', 'python.exe'),
          path.join(repositoryRoot, '.venv', 'Scripts', 'python.exe'),
        ]
      : [
          path.join(sourceRoot, '.venv', 'bin', 'python'),
          path.join(repositoryRoot, '.venv', 'bin', 'python'),
        ]
    for (const executable of venvCandidates) {
      if (fs.existsSync(executable)) {
        candidates.push({ command: executable, prefixArgs: [], label: `repository venv (${executable})` })
      }
    }
  }
  candidates.push(
    { command: 'py', prefixArgs: ['-3'], label: 'py -3' },
    { command: 'python', prefixArgs: [], label: 'python' },
  )
  return unique(
    candidates.filter((value): value is NonNullable<typeof value> => value !== null),
    (value) => `${value.command}\u0000${value.prefixArgs.join('\u0000')}`,
  )
}

function bootstrapArguments(sourceRoot: string | undefined): string[] {
  if (!sourceRoot) {
    return ['-I', '-B', '-X', 'utf8', '-m', 'cadstack.cli.main']
  }
  const repositoryRoot = path.dirname(sourceRoot)
  const importRoots = CADSTACK_SOURCE_PACKAGES
    .map((name) => path.join(repositoryRoot, name))
    .filter((candidate) => fs.existsSync(candidate))
  const bootstrap = [
    'import runpy,sys',
    `sys.path[:0]=${JSON.stringify(importRoots)}`,
    'runpy.run_module("cadstack.cli.main",run_name="__main__")',
  ].join(';')
  return ['-I', '-B', '-X', 'utf8', '-c', bootstrap]
}

export function resolveCadstackLaunchSpecs(
  cwd = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): CadstackLaunchSpec[] {
  const roots = sourcePackageRootCandidates(cwd, environment)
  const sourceRoot = roots[0]
  return pythonCandidates(roots, environment).map((python) => ({
    command: python.command,
    args: [...python.prefixArgs, ...bootstrapArguments(sourceRoot)],
    label: `${python.label}${sourceRoot ? ` (${sourceRoot})` : ''}`,
  }))
}

export function parseCadstackResponse(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
  const finalLine = lines.at(-1)
  if (!finalLine) throw new Error('cadstack did not return a JSON result.')
  const parsed: unknown = JSON.parse(finalLine)
  if (!isRecord(parsed)) throw new Error('cadstack JSON result must be an object.')
  return parsed
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('cadstack operation was cancelled.')
}

function unavailableModule(stderr: string, response: Record<string, unknown> | null): boolean {
  const message = [
    stderr,
    isRecord(response?.error) ? String(response.error.message ?? '') : '',
  ].join('\n')
  return /No module named ['"]?cadstack|ModuleNotFoundError.*cadstack/iu.test(message)
}

function runWithSpec(
  spec: CadstackLaunchSpec,
  args: readonly string[],
  options: Required<Pick<CadstackRunOptions, 'timeoutMs' | 'stdoutLimitBytes'>> & Pick<CadstackRunOptions, 'signal'>,
  spawnProcess: typeof spawn,
  environment: NodeJS.ProcessEnv,
): Promise<CadstackResponse> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError(options.signal))
      return
    }
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnProcess(spec.command, [...spec.args, ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...environment,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      })
      child.stdin.end()
    } catch (error) {
      reject(new CadstackLaunchUnavailableError(`${spec.label}: ${error instanceof Error ? error.message : String(error)}`))
      return
    }
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let stdout = ''
    let stdoutBytes = 0
    let stderr = ''
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const succeed = (response: CadstackResponse) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }
    const onAbort = () => {
      child.kill()
      fail(abortError(options.signal as AbortSignal))
    }
    const timeout = setTimeout(() => {
      child.kill()
      fail(new Error(`${spec.label}: cadstack timed out after ${Math.round(options.timeoutMs / 1000)} seconds.`))
    }, options.timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error: NodeJS.ErrnoException) => {
      const message = `${spec.label}: ${error.message}`
      fail(error.code === 'ENOENT' ? new CadstackLaunchUnavailableError(message) : new Error(message))
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > options.stdoutLimitBytes) {
        child.kill()
        fail(new Error(`${spec.label}: cadstack stdout exceeded ${options.stdoutLimitBytes} bytes.`))
        return
      }
      stdout += stdoutDecoder.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + stderrDecoder.write(chunk)).slice(-STDERR_TAIL_CHARS)
    })
    child.on('close', (code) => {
      if (settled) return
      stdout += stdoutDecoder.end()
      stderr = (stderr + stderrDecoder.end()).slice(-STDERR_TAIL_CHARS)
      let response: Record<string, unknown> | null = null
      try {
        response = parseCadstackResponse(stdout)
      } catch (error) {
        if (unavailableModule(stderr, null)) {
          fail(new CadstackLaunchUnavailableError(`${spec.label}: ${stderr.trim() || 'cadstack module is unavailable.'}`))
          return
        }
        fail(new Error(`${spec.label}: ${error instanceof Error ? error.message : String(error)}${stderr.trim() ? ` ${stderr.trim()}` : ''}`))
        return
      }
      if (code !== 0 || response.ok !== true) {
        if (unavailableModule(stderr, response)) {
          fail(new CadstackLaunchUnavailableError(`${spec.label}: cadstack module is unavailable.`))
          return
        }
        const detail = isRecord(response.error)
          ? String(response.error.message ?? response.error.type ?? 'cadstack command failed')
          : stderr.trim() || `cadstack exited with code ${String(code)}`
        fail(new CadstackCommandError(`${spec.label}: ${detail}`, response))
        return
      }
      if (typeof response.command !== 'string' || response.command !== args[0]) {
        fail(new CadstackCommandError(
          `${spec.label}: cadstack response command did not match ${args[0]}.`,
          response,
        ))
        return
      }
      succeed(response as CadstackResponse)
    })
  })
}

export class CadstackRuntime {
  private readonly launchSpecs: readonly CadstackLaunchSpec[]
  private readonly environment: NodeJS.ProcessEnv
  private readonly spawnProcess: typeof spawn

  constructor(options: CadstackRuntimeOptions = {}) {
    this.environment = options.environment ?? process.env
    this.launchSpecs = options.launchSpecs
      ?? resolveCadstackLaunchSpecs(options.cwd ?? process.cwd(), this.environment)
    this.spawnProcess = options.spawnProcess ?? spawn
  }

  async run(args: readonly string[], options: CadstackRunOptions = {}): Promise<CadstackResponse> {
    if (args.length === 0 || !args[0]) throw new Error('cadstack command is required.')
    if (this.launchSpecs.length === 0) throw new Error('No cadstack Python runtime candidates were found.')
    const timeoutMs = options.timeoutMs ?? cadstackCommandTimeoutMs(args[0])
    const stdoutLimitBytes = options.stdoutLimitBytes ?? DEFAULT_STDOUT_LIMIT_BYTES
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('cadstack timeout must be positive.')
    if (!Number.isSafeInteger(stdoutLimitBytes) || stdoutLimitBytes < 1_024) {
      throw new Error('cadstack stdout limit must be at least 1024 bytes.')
    }
    const unavailable: string[] = []
    for (const spec of this.launchSpecs) {
      try {
        return await runWithSpec(
          spec,
          args,
          { ...options, timeoutMs, stdoutLimitBytes },
          this.spawnProcess,
          this.environment,
        )
      } catch (error) {
        if (!(error instanceof CadstackLaunchUnavailableError)) throw error
        unavailable.push(error.message)
      }
    }
    throw new Error(
      `cadstack Python runtime is unavailable: ${unavailable.slice(0, 4).join(' | ')}`,
    )
  }
}
