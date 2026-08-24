import { EventEmitter } from 'node:events'
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  CadProtocolMethod,
  CadRpcProgress,
  CadRpcRequest,
  CadRpcResponse,
} from '../../contracts/cad-protocol'
import { CAD_PROTOCOL_VERSION } from '../../contracts/cad-protocol'
import {
  CAD_ERROR_CODES,
  createCadRuntimeError,
} from '../../errors/cad-error-codes'

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason: Error) => void
  timeout: NodeJS.Timeout
  method: CadProtocolMethod
  startedAtMs: number
  onProgress?: (progress: CadRpcProgress) => void
  cleanup?: () => void
}

interface WorkerLaunchSpec {
  command: string
  args: string[]
  mode: 'python' | 'executable'
}

interface PythonCommandSpec {
  command: string
  prefixArgs: string[]
  source: string
}

interface PythonProbeResult {
  ok: boolean
  executable?: string
  reason?: string
}

export interface WorkerCallOptions {
  timeoutMs?: number
  onProgress?: (progress: CadRpcProgress) => void
  signal?: AbortSignal
  terminateOnAbort?: boolean
}

const CAD_WORKER_TIMEOUT_MS = 60 * 60 * 1000
const CAD_WORKER_PYTHON_PROBE_TIMEOUT_MS = 15_000

export class AutoCadComWorkerHost extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private buffer = ''
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private pending = new Map<number, PendingRequest>()
  private launchSpec: WorkerLaunchSpec | null = null

  get isRunning() {
    return this.proc !== null && !this.proc.killed
  }

  async start() {
    if (this.readyPromise) {
      return this.readyPromise
    }

    const launchSpec = this.findLaunchSpec()
    this.launchSpec = launchSpec

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })

    this.proc = spawn(launchSpec.command, launchSpec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    })

    this.proc.stdout.setEncoding('utf-8')
    this.proc.stderr.setEncoding('utf-8')
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.proc.stderr.on('data', (chunk: string) => {
      console.error('[cad-worker:stderr]', chunk.trim())
    })
    this.proc.on('exit', (code) => this.onExit(code))
    this.proc.on('error', (error) => this.onProcError(error))

    const startTimeout = setTimeout(() => {
      this.rejectReady?.(
        createCadRuntimeError(
          CAD_ERROR_CODES.workerStartTimeout,
          'CAD worker start timeout',
        ),
      )
      this.disposeProcess()
    }, CAD_WORKER_TIMEOUT_MS)

    this.readyPromise = this.readyPromise.finally(() => {
      clearTimeout(startTimeout)
    })

    return this.readyPromise
  }

  stop() {
    this.disposeProcess()
  }

  async call(
    method: CadProtocolMethod,
    params: Record<string, unknown> = {},
    options: WorkerCallOptions = {},
  ) {
    if (options.signal?.aborted) {
      throw createCadRuntimeError(
        CAD_ERROR_CODES.requestTimeout,
        `CAD worker request aborted before start: ${method}`,
      )
    }

    await this.start()

    if (!this.proc) {
      throw createCadRuntimeError(
        CAD_ERROR_CODES.workerUnavailable,
        'CAD worker is not available',
      )
    }

    const id = this.nextId++
    const startedAtMs = Date.now()
    const request: CadRpcRequest = {
      id,
      protocolVersion: CAD_PROTOCOL_VERSION,
      method,
      params,
    }

    console.info('[cad-worker] request start', {
      id,
      method,
    })

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let timeout: NodeJS.Timeout
      let onAbort: () => void
      const cleanupAbort = () => {
        options.signal?.removeEventListener('abort', onAbort)
      }
      onAbort = () => {
        clearTimeout(timeout)
        this.pending.delete(id)
        cleanupAbort()
        const elapsedMs = Date.now() - startedAtMs
        console.warn('[cad-worker] request aborted', {
          id,
          method,
          elapsedMs,
          terminateOnAbort: Boolean(options.terminateOnAbort),
        })
        if (options.terminateOnAbort) {
          this.disposeProcess()
        }
        reject(
          createCadRuntimeError(
            CAD_ERROR_CODES.requestTimeout,
            `CAD worker request aborted: ${method}`,
          ),
        )
      }

      timeout = setTimeout(() => {
        this.pending.delete(id)
        cleanupAbort()
        const elapsedMs = Date.now() - startedAtMs
        console.warn('[cad-worker] request timeout', {
          id,
          method,
          elapsedMs,
        })
        if (options.terminateOnAbort) {
          this.disposeProcess()
        }
        reject(
          createCadRuntimeError(
            CAD_ERROR_CODES.requestTimeout,
            `CAD worker request timed out: ${method}`,
          ),
        )
      }, options.timeoutMs ?? CAD_WORKER_TIMEOUT_MS)

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
        method,
        startedAtMs,
        onProgress: options.onProgress,
        cleanup: cleanupAbort,
      })

      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.proc?.stdin.write(`${JSON.stringify(request)}\n`, 'utf-8')
    })
  }

  private onData(chunk: string) {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      let payload: CadRpcResponse
      try {
        payload = JSON.parse(line) as CadRpcResponse
      } catch {
        console.warn('[cad-worker] invalid JSON line', line.slice(0, 200))
        continue
      }

      if (payload.id === 0 && payload.result?.status === 'ready') {
        this.resolveReady?.()
        this.resolveReady = null
        this.rejectReady = null
        continue
      }

      if (payload.progress) {
        const pending = this.pending.get(payload.id)
        pending?.onProgress?.(payload.progress)
        continue
      }

      const pending = this.pending.get(payload.id)
      if (!pending) continue

      clearTimeout(pending.timeout)
      this.pending.delete(payload.id)
      pending.cleanup?.()
      const elapsedMs = Date.now() - pending.startedAtMs

      if (
        pending.method === 'cad.entities.readByFilter'
        || pending.method === 'cad.entities.readReadableIndex'
      ) {
        console.info('[cad-worker] request finished', {
          id: payload.id,
          method: pending.method,
          elapsedMs,
          hasError: Boolean(payload.error),
        })
      }

      if (payload.error) {
        pending.reject(new Error(payload.error.message))
        continue
      }

      pending.resolve(payload.result ?? {})
    }
  }

  private onExit(code: number | null) {
    const error = createCadRuntimeError(
      CAD_ERROR_CODES.workerExited,
      `CAD worker exited with code ${code ?? -1}`,
    )
    this.rejectReady?.(error)
    this.resolveReady = null
    this.rejectReady = null
    this.readyPromise = null

    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.cleanup?.()
      request.reject(error)
    }
    this.pending.clear()
    this.emit('exit', code)
    this.proc = null
  }

  private onProcError(error: Error) {
    console.error('[cad-worker] process error', error)
    const launch = this.launchSpec
    const launchDetail = launch
      ? `${launch.command} ${launch.args.join(' ').trim()}`
      : 'unknown launch spec'
    const cadError = createCadRuntimeError(
      CAD_ERROR_CODES.workerUnavailable,
      `Failed to start CAD worker (${launchDetail}): ${error.message}`,
      error,
    )
    this.rejectReady?.(cadError)
    this.resolveReady = null
    this.rejectReady = null
    this.readyPromise = null
  }

  private disposeProcess() {
    if (this.proc && !this.proc.killed) {
      this.proc.kill()
    }
    this.proc = null
    this.readyPromise = null
    this.resolveReady = null
    this.rejectReady = null
    this.launchSpec = null
  }

  private findLaunchSpec(): WorkerLaunchSpec {
    const executablePath = this.findExecutablePath()
    if (executablePath) {
      return {
        command: executablePath,
        args: [],
        mode: 'executable',
      }
    }

    const scriptPath = this.findScriptPath()
    if (!fs.existsSync(scriptPath)) {
      throw createCadRuntimeError(
        CAD_ERROR_CODES.scriptNotFound,
        `CAD worker script not found: ${scriptPath}`,
      )
    }
    const python = this.pickPythonCommandSpec(scriptPath)
    return {
      command: python.command,
      args: [...python.prefixArgs, '-u', scriptPath],
      mode: 'python',
    }
  }

  private findExecutablePath() {
    if (!app.isPackaged) {
      return null
    }
    const candidates = [
      path.join(
        process.resourcesPath,
        'cad',
        'autocad-com',
        'python',
        'cad_worker.exe',
      ),
      path.join(
        process.resourcesPath,
        'cad',
        'autocad-com',
        'python',
        'packaged-bin',
        'cad_worker.exe',
      ),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  private pickPythonCommandSpec(scriptPath: string): PythonCommandSpec {
    const specs = this.buildPythonCommandSpecs()
    const failures: string[] = []

    for (const spec of specs) {
      const probe = this.probePythonCommand(spec)
      if (probe.ok) {
        return spec
      }
      const details = probe.reason ?? 'unknown error'
      failures.push(`${spec.source}: ${details}`)
    }

    const requirementsPath = path.join(path.dirname(scriptPath), 'requirements.txt')
    const dependencyHint = fs.existsSync(requirementsPath)
      ? `Install dependencies with: python -m pip install -r "${requirementsPath}"`
      : 'Install pywin32 and Pillow into the Python interpreter used by CAD worker.'

    throw createCadRuntimeError(
      CAD_ERROR_CODES.workerUnavailable,
      [
        'No usable Python runtime found for CAD worker (requires pythoncom/win32com/Pillow).',
        dependencyHint,
        'You can force a specific interpreter via CAD_PYTHON_PATH.',
        `Probed runtimes: ${failures.length ? failures.join(' | ') : 'none'}`,
      ].join('\n'),
    )
  }

  private buildPythonCommandSpecs(): PythonCommandSpec[] {
    const rawSpecs: PythonCommandSpec[] = []
    const envPython = process.env.CAD_PYTHON_PATH || process.env.PYTHON_PATH
    if (typeof envPython === 'string' && envPython.trim()) {
      rawSpecs.push({
        command: envPython.trim(),
        prefixArgs: [],
        source: 'env(CAD_PYTHON_PATH/PYTHON_PATH)',
      })
    }

    if (app.isPackaged) {
      const packagedCandidates = [
        path.join(process.resourcesPath, 'cad', 'python-runtime', 'python.exe'),
        path.join(process.resourcesPath, 'python', 'python.exe'),
      ]
      for (const candidate of packagedCandidates) {
        rawSpecs.push({
          command: candidate,
          prefixArgs: [],
          source: 'packaged-runtime',
        })
      }
    }

    rawSpecs.push(
      {
        command: 'py',
        prefixArgs: ['-3'],
        source: 'py-launcher',
      },
      {
        command: 'python',
        prefixArgs: [],
        source: 'python-on-path',
      },
    )

    const deduped: PythonCommandSpec[] = []
    const seen = new Set<string>()
    for (const spec of rawSpecs) {
      const key = `${spec.command}::${spec.prefixArgs.join(' ')}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      deduped.push(spec)
    }
    return deduped
  }

  private probePythonCommand(spec: PythonCommandSpec): PythonProbeResult {
    const probeScript = [
      'import sys',
      'mods=["pythoncom","win32com.client","PIL"]',
      'missing=[]',
      'for m in mods:',
      '  try:',
      '    __import__(m)',
      '  except Exception:',
      '    missing.append(m)',
      'print(sys.executable)',
      'print("MISSING:" + ",".join(missing))',
      'raise SystemExit(0 if not missing else 2)',
    ].join('\n')

    console.info('[cad-worker] probing python runtime', {
      source: spec.source,
      command: spec.command,
      timeoutMs: CAD_WORKER_PYTHON_PROBE_TIMEOUT_MS,
    })

    const result = spawnSync(spec.command, [...spec.prefixArgs, '-c', probeScript], {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CAD_WORKER_PYTHON_PROBE_TIMEOUT_MS,
    })

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code
      if (code === 'ETIMEDOUT') {
        return {
          ok: false,
          reason: `probe timed out after ${CAD_WORKER_PYTHON_PROBE_TIMEOUT_MS}ms`,
        }
      }
      return { ok: false, reason: result.error.message }
    }
    const stdout = String(result.stdout ?? '').trim()
    const stderr = String(result.stderr ?? '').trim()
    const missingLine = stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith('MISSING:'))
    const executable = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('MISSING:'))

    if (result.status === 0) {
      return { ok: true, executable }
    }

    const missing = missingLine?.replace('MISSING:', '').trim()
    if (missing) {
      return {
        ok: false,
        executable,
        reason: `missing modules: ${missing}`,
      }
    }
    if (stderr) {
      return { ok: false, executable, reason: stderr.split(/\r?\n/)[0] }
    }
    return { ok: false, executable, reason: `probe exited with code ${result.status ?? -1}` }
  }

  private findScriptPath() {
    if (!app.isPackaged) {
      return path.join(
        app.getAppPath(),
        'electron',
        'runtime',
        'cad',
        'drivers',
        'autocad-com',
        'python',
        'cad_worker.py',
      )
    }

    return path.join(
      process.resourcesPath,
      'cad',
      'autocad-com',
      'python',
      'cad_worker.py',
    )
  }
}
