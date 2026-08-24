import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

import {
  CadHttpBridgeClient,
  CadHttpBridgeClientError,
  type CadHttpBridgeCallOptions,
  type CadHttpBridgeExecuteResult,
  type CadHttpBridgeExecutor,
  type CadHttpBridgeIdentity,
} from './bridge-client'
import {
  cadHttpBridgeDescriptorIsHealthy,
  startCadHttpBridge,
  type CadHttpBridgeHandle,
  type CadHttpBridgeLaunchOptions,
} from './bridge-launcher'
import {
  CadApplicationFacade,
  type CadBridgeApplicationStatus,
  type CadBridgeDocument,
} from './cad-application-facade'

const DEFAULT_WATCHDOG_INTERVAL_MS = 15_000
const DEFAULT_HEALTH_FAILURE_THRESHOLD = 2
const DEFAULT_RESTART_BACKOFF_MS = [1_000, 5_000, 30_000] as const
const DEFAULT_RESTART_LIMIT = 6
const DEFAULT_RESTART_WINDOW_MS = 10 * 60_000
const MAX_RUNTIME_EVENTS = 50

export type CadHttpRuntimeState =
  | 'stopped'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'restarting'
  | 'stopping'
  | 'disposed'

export interface CadHttpRuntimeError {
  code: string
  message: string
  at: string
}

export interface CadHttpRuntimeEvent {
  level: 'info' | 'warning' | 'error'
  code: string
  message: string
  at: string
}

export interface CadHttpRuntimeSnapshot {
  state: CadHttpRuntimeState
  projectRoot: string | null
  pid: number | null
  adopted: boolean
  activeLeases: number
  consecutiveHealthFailures: number
  restartCount: number
  lastHealthAt: string | null
  lastHealthyAt: string | null
  lastError: CadHttpRuntimeError | null
  events: CadHttpRuntimeEvent[]
}

export type CadHttpAutocadState =
  | 'ready'
  | 'not_installed'
  | 'com_unregistered'
  | 'not_running'
  | 'unsupported'
  | 'no_document'
  | 'busy'
  | 'unavailable'
  | 'error'

export type CadHttpPlotState =
  | 'ready'
  | 'ready_with_unsaved_changes'
  | 'bridge_unavailable'
  | 'operation_unavailable'
  | 'autocad_not_installed'
  | 'autocad_com_unregistered'
  | 'autocad_not_running'
  | 'autocad_unsupported'
  | 'no_document'
  | 'drawing_outside_project'
  | 'busy'
  | 'environment_unavailable'
  | 'error'

export interface CadHttpRuntimeDiagnosis {
  bridge: CadHttpRuntimeSnapshot & {
    reachable: boolean
    protocolVersion: number
    operations: string[]
    drawingWriteOperations: string[]
    statefulOperations: string[]
  }
  autocad: {
    state: CadHttpAutocadState
    fullInstalled: boolean | null
    ltInstalled: boolean | null
    comRegistered: boolean | null
    running: boolean
    supported: boolean
    visible: boolean | null
    version: string | null
    documentCount: number
    documents: CadBridgeDocument[]
    errorCode: string | null
    message: string
  }
  plot: {
    state: CadHttpPlotState
    ready: boolean
    operationAvailable: boolean
    activeDocument: CadBridgeDocument | null
    dependencies: {
      pywin32: boolean | null
      pillow: boolean | null
      pdfium: boolean | null
    }
    configurations: {
      pdf: boolean | null
      png: boolean | null
    }
    warnings: string[]
    message: string
  }
  updatedAt: string
}

export interface CadHttpRuntimeLease {
  projectRoot: string
  facade: CadApplicationFacade
  capabilities(signal?: AbortSignal): Promise<Record<string, unknown>>
  diagnose(signal?: AbortSignal): Promise<CadHttpRuntimeDiagnosis>
  release(): Promise<void>
}

export interface ProjectScopedCadHttpRuntimeOptions extends CadHttpBridgeLaunchOptions {
  watchdogIntervalMs?: number
  healthFailureThreshold?: number
  restartBackoffMs?: readonly number[]
  restartLimit?: number
  restartWindowMs?: number
  now?: () => number
}

/** Codes the bridge raises when a COM call was refused rather than answered. */
const BUSY_ERROR_CODES = new Set(['CAD_BUSY', 'QUEUE_TIMEOUT', 'RESPONSE_TIMEOUT'])
const STALE_AUTOCAD_RECOVERY_GUIDANCE = 'Repeated busy responses while nobody is using AutoCAD '
  + '(for example after sleep/wake) can indicate a stale COM connection. Run cad_doctor first, '
  + 'then consider cad_app action=restart.'
export const AUTOCAD_NOT_RUNNING_CODE = 'AUTOCAD_NOT_RUNNING'
const AUTOCAD_NOT_RUNNING_MESSAGE = 'AutoCAD is not running, so the drawing could not be read. '
  + 'Start the application once (cad_app action=start) or ask the user to open it; if it stays '
  + 'closed, read the drawing through the MLightCAD file channel instead. Repeating this call '
  + 'while AutoCAD is closed fails the same way.'

function notRunningError(): CadHttpBridgeClientError {
  return new CadHttpBridgeClientError(AUTOCAD_NOT_RUNNING_CODE, AUTOCAD_NOT_RUNNING_MESSAGE, {
    statusCode: 503,
    retryable: false,
  })
}

class IdentityBoundExecutor implements CadHttpBridgeExecutor {
  constructor(
    private readonly client: CadHttpBridgeClient,
    private readonly identity: CadHttpBridgeIdentity,
  ) {}

  async execute(
    operation: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    options?: CadHttpBridgeCallOptions,
  ): Promise<CadHttpBridgeExecuteResult> {
    try {
      return await this.client.execute(operation, params, signal, {
        ...options,
        identity: this.identity,
      })
    } catch (error) {
      throw await this.explain(error, operation, signal)
    }
  }

  /**
   * Tells "AutoCAD is mid-operation" apart from "AutoCAD is not there".
   *
   * A COM call to an absent or still-loading AutoCAD comes back rejected, which the bridge
   * reports as busy. Read as busy, that invites a retry, and a whole review session was
   * spent retrying a connection that was never going to answer. Asking for the application
   * status settles it: no running application means the user has to start AutoCAD.
   */
  private async explain(error: unknown, operation: string, signal?: AbortSignal): Promise<unknown> {
    if (!(error instanceof CadHttpBridgeClientError)) return error
    if (error.code === 'CAD_NOT_RUNNING') return notRunningError()
    if (
      operation === 'app.status'
      || operation === 'app.restart'
      || !BUSY_ERROR_CODES.has(error.code)
    ) return error
    try {
      const status = await this.client.execute('app.status', {}, signal, { identity: this.identity })
      const running = (status.data as { running?: unknown } | undefined)?.running
      if (running !== false) return error
    } catch {
      // A second busy failure is the sleep/wake zombie signature. Preserve the
      // transport error and add one bounded, deterministic recovery path.
      if (!signal?.aborted && !error.message.includes(STALE_AUTOCAD_RECOVERY_GUIDANCE)) {
        error.message = `${error.message} ${STALE_AUTOCAD_RECOVERY_GUIDANCE}`
      }
      return error
    }
    return notRunningError()
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function resolveProjectRoot(projectRoot: string): string {
  const resolved = fs.realpathSync(path.resolve(projectRoot))
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error('CAD project root must be an existing directory.')
  }
  return resolved
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100)
}

function safeError(error: unknown, now: number): CadHttpRuntimeError {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const message = rawMessage
    .replace(/[A-Za-z]:\\[^,;)]*/gu, '[path]')
    .replace(/(?:bearer|token|secret|password)\s*[:=]?\s*\S+/giu, '[secret]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500) || 'CAD bridge operation failed.'
  const code = error instanceof CadHttpBridgeClientError
    ? error.code
    : 'BRIDGE_RUNTIME_ERROR'
  return { code, message, at: new Date(now).toISOString() }
}

function unavailableDiagnosis(
  snapshot: CadHttpRuntimeSnapshot,
  error: CadHttpRuntimeError,
): CadHttpRuntimeDiagnosis {
  return {
    bridge: {
      ...snapshot,
      reachable: false,
      protocolVersion: 1,
      operations: [],
      drawingWriteOperations: [],
      statefulOperations: [],
    },
    autocad: {
      state: 'unavailable',
      fullInstalled: null,
      ltInstalled: null,
      comRegistered: null,
      running: false,
      supported: false,
      visible: null,
      version: null,
      documentCount: 0,
      documents: [],
      errorCode: error.code,
      message: 'CAD bridge is unavailable, so AutoCAD could not be inspected.',
    },
    plot: {
      state: 'bridge_unavailable',
      ready: false,
      operationAvailable: false,
      activeDocument: null,
      dependencies: { pywin32: null, pillow: null, pdfium: null },
      configurations: { pdf: null, png: null },
      warnings: [],
      message: 'Plot is blocked until the project-bound bridge is healthy.',
    },
    updatedAt: error.at,
  }
}

function applicationErrorState(code: string): CadHttpAutocadState {
  if (code === 'UNSUPPORTED_LT') return 'unsupported'
  if (code === 'CAD_NOT_RUNNING' || code === AUTOCAD_NOT_RUNNING_CODE) return 'not_running'
  if (code === 'CAD_BUSY' || code === 'QUEUE_TIMEOUT' || code === 'RESPONSE_TIMEOUT') return 'busy'
  if (code === 'NO_ACTIVE_DOCUMENT') return 'no_document'
  if (code.startsWith('BRIDGE_') || code === 'WORKER_UNAVAILABLE') return 'unavailable'
  return 'error'
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export class ProjectScopedCadHttpRuntime {
  private handle: CadHttpBridgeHandle | null = null
  private client: CadHttpBridgeClient | null = null
  private projectRoot: string | null = null
  private activeLeases = 0
  private transition: Promise<void> = Promise.resolve()
  private disposed = false
  private state: CadHttpRuntimeState = 'stopped'
  private consecutiveHealthFailures = 0
  private consecutiveHealthyChecks = 0
  private restartCount = 0
  private restartAttempt = 0
  private restartTimestamps: number[] = []
  private lastHealthAt: string | null = null
  private lastHealthyAt: string | null = null
  private lastError: CadHttpRuntimeError | null = null
  private events: CadHttpRuntimeEvent[] = []
  private watchdogTimer: NodeJS.Timeout | null = null
  private recoveryTimer: NodeJS.Timeout | null = null
  private watchdogRunning = false
  private disposeCompletion: {
    promise: Promise<void>
    resolve: () => void
    reject: (error: unknown) => void
  } | null = null

  constructor(private readonly options: ProjectScopedCadHttpRuntimeOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private recordEvent(
    level: CadHttpRuntimeEvent['level'],
    code: string,
    message: string,
  ): void {
    this.events.push({ level, code, message: message.slice(0, 500), at: new Date(this.now()).toISOString() })
    if (this.events.length > MAX_RUNTIME_EVENTS) {
      this.events.splice(0, this.events.length - MAX_RUNTIME_EVENTS)
    }
  }

  private captureError(error: unknown, code?: string): CadHttpRuntimeError {
    const captured = safeError(error, this.now())
    this.lastError = code ? { ...captured, code } : captured
    return this.lastError
  }

  snapshot(): CadHttpRuntimeSnapshot {
    return {
      state: this.state,
      projectRoot: this.projectRoot,
      pid: this.handle?.descriptor.pid ?? null,
      adopted: Boolean(this.handle && !this.handle.owned),
      activeLeases: this.activeLeases,
      consecutiveHealthFailures: this.consecutiveHealthFailures,
      restartCount: this.restartCount,
      lastHealthAt: this.lastHealthAt,
      lastHealthyAt: this.lastHealthyAt,
      lastError: this.lastError ? { ...this.lastError } : null,
      events: this.events.map((event) => ({ ...event })),
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transition.then(operation, operation)
    this.transition = result.then(() => undefined, () => undefined)
    return result
  }

  private cancelWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = null
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
  }

  private startWatchdog(): void {
    if (this.watchdogTimer || this.disposed) return
    const interval = Math.max(250, this.options.watchdogIntervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS)
    this.watchdogTimer = setInterval(() => void this.watchdogTick(), interval)
    this.watchdogTimer.unref?.()
  }

  private async stopCurrentBridge(terminateAdopted = false): Promise<void> {
    this.cancelWatchdog()
    const handle = this.handle
    if (handle) await (terminateAdopted ? handle.terminate() : handle.stop())
    this.handle = null
    this.client = null
    this.projectRoot = null
    this.consecutiveHealthFailures = 0
    this.consecutiveHealthyChecks = 0
  }

  private async finalizeDisposeIfIdle(): Promise<void> {
    if (!this.disposed || this.activeLeases > 0 || this.state === 'disposed') return
    const completion = this.disposeCompletion
    this.state = 'stopping'
    try {
      await this.stopCurrentBridge(true)
      this.state = 'disposed'
      this.recordEvent('info', 'BRIDGE_RUNTIME_DISPOSED', 'CAD HTTP runtime disposed.')
      completion?.resolve()
    } catch (error) {
      this.state = 'degraded'
      this.captureError(error)
      this.recordEvent('error', 'BRIDGE_DISPOSE_FAILED', 'CAD HTTP runtime could not stop its bridge.')
      completion?.reject(error)
      if (this.disposeCompletion === completion) this.disposeCompletion = null
      throw error
    }
  }

  private async launchBridge(projectRoot: string): Promise<CadHttpBridgeClient> {
    this.state = this.state === 'restarting' ? 'restarting' : 'starting'
    this.recordEvent('info', 'BRIDGE_STARTING', 'Starting the project-bound CAD HTTP bridge.')
    const handle = await startCadHttpBridge(projectRoot, this.options)
    const client = new CadHttpBridgeClient({
      descriptorPath: this.options.descriptorPath,
      projectRoot,
      fetchFn: this.options.fetchFn,
    })
    try {
      await client.capabilities()
    } catch (error) {
      await handle.terminate().catch(() => undefined)
      throw error
    }
    this.handle = handle
    this.client = client
    this.projectRoot = projectRoot
    this.state = 'healthy'
    this.consecutiveHealthFailures = 0
    this.consecutiveHealthyChecks = 0
    this.lastHealthAt = new Date(this.now()).toISOString()
    this.lastHealthyAt = this.lastHealthAt
    this.lastError = null
    this.recordEvent(
      'info',
      handle.reused ? 'BRIDGE_ADOPTED' : 'BRIDGE_STARTED',
      handle.reused ? 'Adopted the healthy project-bound CAD bridge.' : 'CAD HTTP bridge is healthy.',
    )
    this.startWatchdog()
    return client
  }

  private async ensureBridge(projectRoot: string): Promise<CadHttpBridgeClient> {
    if (this.projectRoot && !samePath(this.projectRoot, projectRoot)) {
      if (this.activeLeases > 0) {
        throw new Error('CAD bridge is leased to another project.')
      }
      this.state = 'stopping'
      await this.stopCurrentBridge(true)
      this.state = 'stopped'
    }

    if (this.client && this.projectRoot && samePath(this.projectRoot, projectRoot)) {
      try {
        await this.client.capabilities()
        return this.client
      } catch (error) {
        this.state = 'degraded'
        this.consecutiveHealthFailures += 1
        this.consecutiveHealthyChecks = 0
        this.captureError(error)
        this.recordEvent('warning', 'BRIDGE_UNHEALTHY', 'The existing CAD bridge failed its capability probe.')
        const threshold = Math.max(
          1,
          this.options.healthFailureThreshold ?? DEFAULT_HEALTH_FAILURE_THRESHOLD,
        )
        if (this.consecutiveHealthFailures >= threshold) this.scheduleRecovery()
        throw error
      }
    }

    try {
      return await this.launchBridge(projectRoot)
    } catch (error) {
      this.state = 'degraded'
      this.captureError(error)
      this.recordEvent('error', 'BRIDGE_START_FAILED', 'CAD HTTP bridge failed to become healthy.')
      throw error
    }
  }

  private restartAllowed(): boolean {
    const now = this.now()
    const windowMs = Math.max(1_000, this.options.restartWindowMs ?? DEFAULT_RESTART_WINDOW_MS)
    this.restartTimestamps = this.restartTimestamps.filter((value) => now - value <= windowMs)
    return this.restartTimestamps.length < Math.max(1, this.options.restartLimit ?? DEFAULT_RESTART_LIMIT)
  }

  private scheduleRecovery(): void {
    if (this.recoveryTimer || this.disposed || !this.projectRoot) return
    if (!this.restartAllowed()) {
      this.state = 'degraded'
      this.captureError(new Error('CAD bridge restart limit exceeded.'), 'BRIDGE_CRASH_LOOP')
      this.recordEvent('error', 'BRIDGE_CRASH_LOOP', 'Automatic bridge recovery paused after repeated failures.')
      return
    }
    const backoff = this.options.restartBackoffMs?.length
      ? this.options.restartBackoffMs
      : DEFAULT_RESTART_BACKOFF_MS
    const delayMs = Math.max(0, backoff[Math.min(this.restartAttempt, backoff.length - 1)] ?? 0)
    this.recordEvent('warning', 'BRIDGE_RECOVERY_SCHEDULED', `Bridge recovery scheduled in ${delayMs} ms.`)
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      void this.exclusive(async () => this.recoverBridge())
    }, delayMs)
    this.recoveryTimer.unref?.()
  }

  private async recoverBridge(): Promise<void> {
    const projectRoot = this.projectRoot
    if (!projectRoot || this.disposed) return
    this.state = 'restarting'
    this.restartAttempt += 1
    this.restartCount += 1
    this.restartTimestamps.push(this.now())
    this.recordEvent('warning', 'BRIDGE_RESTARTING', 'Restarting only the CAD HTTP bridge; AutoCAD is left untouched.')
    try {
      await this.stopCurrentBridge(true)
      this.state = 'restarting'
      await this.launchBridge(projectRoot)
    } catch (error) {
      this.state = 'degraded'
      this.captureError(error)
      this.recordEvent('error', 'BRIDGE_RESTART_FAILED', 'CAD HTTP bridge recovery failed.')
      this.projectRoot = projectRoot
      this.scheduleRecovery()
    }
  }

  private async watchdogTick(): Promise<void> {
    if (this.watchdogRunning || this.disposed || !this.handle) return
    this.watchdogRunning = true
    try {
      await this.exclusive(async () => {
        if (this.disposed || !this.handle) return
        const healthy = await cadHttpBridgeDescriptorIsHealthy(this.handle.descriptor, this.options)
        this.lastHealthAt = new Date(this.now()).toISOString()
        if (healthy) {
          if (this.recoveryTimer) clearTimeout(this.recoveryTimer)
          this.recoveryTimer = null
          const recovered = this.state !== 'healthy' || this.consecutiveHealthFailures > 0
          this.state = 'healthy'
          this.consecutiveHealthFailures = 0
          this.consecutiveHealthyChecks += 1
          this.lastHealthyAt = this.lastHealthAt
          this.lastError = null
          if (this.consecutiveHealthyChecks >= 2) this.restartAttempt = 0
          if (recovered) this.recordEvent('info', 'BRIDGE_HEALTH_RESTORED', 'CAD bridge health recovered.')
          return
        }
        this.state = 'degraded'
        this.consecutiveHealthFailures += 1
        this.consecutiveHealthyChecks = 0
        this.captureError(new Error('CAD bridge liveness probe failed.'), 'BRIDGE_HEALTH_FAILED')
        this.recordEvent('warning', 'BRIDGE_HEALTH_FAILED', 'CAD bridge liveness probe failed.')
        const threshold = Math.max(
          1,
          this.options.healthFailureThreshold ?? DEFAULT_HEALTH_FAILURE_THRESHOLD,
        )
        if (this.consecutiveHealthFailures >= threshold) this.scheduleRecovery()
      })
    } finally {
      this.watchdogRunning = false
    }
  }

  prepare(projectRoot: string): Promise<CadHttpRuntimeSnapshot> {
    return this.exclusive(async () => {
      if (this.disposed) throw new Error('CAD HTTP runtime is disposed.')
      await this.ensureBridge(resolveProjectRoot(projectRoot))
      return this.snapshot()
    })
  }

  restart(projectRoot?: string): Promise<CadHttpRuntimeSnapshot> {
    return this.exclusive(async () => {
      if (this.disposed) throw new Error('CAD HTTP runtime is disposed.')
      if (this.activeLeases > 0) {
        throw new Error('CAD bridge cannot be manually restarted while CAD work is active.')
      }
      const requestedProjectRoot = projectRoot ?? this.projectRoot
      if (!requestedProjectRoot) throw new Error('CAD bridge restart requires a project root.')
      const target = resolveProjectRoot(requestedProjectRoot)
      this.restartTimestamps = []
      this.restartAttempt = 0
      this.restartCount += 1
      this.state = 'restarting'
      this.recordEvent('warning', 'BRIDGE_MANUAL_RESTART', 'Restarting only the CAD HTTP bridge by host request.')
      try {
        await this.stopCurrentBridge(true)
        this.state = 'restarting'
        await this.launchBridge(target)
        return this.snapshot()
      } catch (error) {
        this.state = 'degraded'
        this.projectRoot = target
        this.captureError(error)
        this.recordEvent('error', 'BRIDGE_MANUAL_RESTART_FAILED', 'Requested CAD bridge restart failed.')
        this.scheduleRecovery()
        throw error
      }
    })
  }

  private async diagnoseClient(
    client: CadHttpBridgeClient,
    identity: CadHttpBridgeIdentity,
    signal?: AbortSignal,
  ): Promise<CadHttpRuntimeDiagnosis> {
    let capabilities: Record<string, unknown>
    try {
      capabilities = await client.capabilities(signal)
    } catch (error) {
      const captured = this.captureError(error)
      if (!this.disposed) this.state = 'degraded'
      return unavailableDiagnosis(this.snapshot(), captured)
    }
    const operations = stringList(capabilities.operations)
    const facade = new CadApplicationFacade(new IdentityBoundExecutor(client, identity))
    let status: CadBridgeApplicationStatus
    let doctor: Record<string, unknown> = {}
    let fullInstalled: boolean | null = null
    let ltInstalled: boolean | null = null
    let comRegistered: boolean | null = null
    try {
      if (operations.includes('app.doctor')) {
        const result = await facade.doctor(signal)
        status = result.application
        doctor = result.plot
        fullInstalled = result.installation.fullInstalled
        ltInstalled = result.installation.ltInstalled
        comRegistered = result.installation.comRegistered
      } else {
        status = await facade.status(signal)
      }
    } catch (error) {
      const captured = safeError(error, this.now())
      const state = applicationErrorState(captured.code)
      const plotState: CadHttpPlotState = state === 'busy'
        ? 'busy'
        : state === 'not_running'
          ? 'autocad_not_running'
          : state === 'unsupported'
            ? 'autocad_unsupported'
            : state === 'unavailable'
              ? 'bridge_unavailable'
              : 'error'
      return {
        bridge: {
          ...this.snapshot(),
          reachable: true,
          protocolVersion: 1,
          operations,
          drawingWriteOperations: stringList(capabilities.drawing_write_operations),
          statefulOperations: stringList(capabilities.stateful_operations),
        },
        autocad: {
          state,
          fullInstalled: null,
          ltInstalled: state === 'unsupported' ? true : null,
          comRegistered: null,
          running: false,
          supported: state !== 'unsupported',
          visible: null,
          version: null,
          documentCount: 0,
          documents: [],
          errorCode: captured.code,
          message: captured.message,
        },
        plot: {
          state: plotState,
          ready: false,
          operationAvailable: operations.includes('capture.plot'),
          activeDocument: null,
          dependencies: { pywin32: null, pillow: null, pdfium: null },
          configurations: { pdf: null, png: null },
          warnings: [],
          message: captured.message,
        },
        updatedAt: captured.at,
      }
    }
    const activeDocument = status.documents.find((document) => document.active) ?? null
    const operationAvailable = operations.includes('capture.plot')
    const dependencies = recordOrEmpty(doctor.dependencies)
    const configurations = recordOrEmpty(doctor.configurations)
    const warnings = stringList(doctor.warnings)
    const environmentReady = booleanOrNull(doctor.ready)
    const autocadState: CadHttpAutocadState = status.running
      ? (activeDocument ? 'ready' : 'no_document')
      : fullInstalled === false && ltInstalled === true
        ? 'unsupported'
        : fullInstalled === false && ltInstalled === false && comRegistered === false
          ? 'not_installed'
          : fullInstalled === true && comRegistered === false
            ? 'com_unregistered'
            : 'not_running'
    let plotState: CadHttpPlotState = 'ready'
    let plotReady = true
    let plotMessage = 'Plot prerequisites are ready for the active project drawing.'
    if (!operationAvailable) {
      plotState = 'operation_unavailable'
      plotReady = false
      plotMessage = 'The bridge does not expose capture.plot.'
    } else if (autocadState === 'not_installed') {
      plotState = 'autocad_not_installed'
      plotReady = false
      plotMessage = 'A registered full AutoCAD installation was not found.'
    } else if (autocadState === 'com_unregistered') {
      plotState = 'autocad_com_unregistered'
      plotReady = false
      plotMessage = 'AutoCAD is installed but its COM application class is not registered.'
    } else if (autocadState === 'unsupported') {
      plotState = 'autocad_unsupported'
      plotReady = false
      plotMessage = 'Only an unsupported AutoCAD LT installation was detected.'
    } else if (!status.running) {
      plotState = 'autocad_not_running'
      plotReady = false
      plotMessage = 'AutoCAD is not running; it may be started on demand.'
    } else if (!status.supported) {
      plotState = 'autocad_unsupported'
      plotReady = false
      plotMessage = 'This AutoCAD edition does not expose the required COM surface.'
    } else if (!activeDocument) {
      plotState = 'no_document'
      plotReady = false
      plotMessage = 'AutoCAD has no active drawing.'
    } else if (!activeDocument.project_relative_path) {
      plotState = 'drawing_outside_project'
      plotReady = false
      plotMessage = 'The active drawing must be saved inside the bound project.'
    } else if (environmentReady !== true) {
      plotState = 'environment_unavailable'
      plotReady = false
      plotMessage = environmentReady === false
        ? 'The packaged plot dependencies or AutoCAD plot configurations are incomplete.'
        : 'This bridge version cannot prove the packaged plot environment is ready.'
    } else if (!activeDocument.saved || (activeDocument.dbmod ?? 0) !== 0) {
      plotState = 'ready_with_unsaved_changes'
      plotMessage = 'Plot is ready; the bridge will restore the current drawing state after capture.'
    }
    return {
      bridge: {
        ...this.snapshot(),
        reachable: true,
        protocolVersion: 1,
        operations,
        drawingWriteOperations: stringList(capabilities.drawing_write_operations),
        statefulOperations: stringList(capabilities.stateful_operations),
      },
      autocad: {
        state: autocadState,
        fullInstalled,
        ltInstalled,
        comRegistered,
        running: status.running,
        supported: status.supported && autocadState !== 'unsupported' && autocadState !== 'not_installed',
        visible: status.visible ?? null,
        version: status.version ?? null,
        documentCount: status.document_count,
        documents: status.documents,
        errorCode: null,
        message: autocadState === 'not_installed'
          ? 'A registered full AutoCAD installation was not found.'
          : autocadState === 'com_unregistered'
            ? 'AutoCAD is installed but its COM application class is not registered.'
          : autocadState === 'unsupported'
            ? 'Only an unsupported AutoCAD LT installation was detected.'
            : status.running
              ? (status.document_count > 0 ? 'AutoCAD is connected.' : 'AutoCAD is running without an open drawing.')
              : 'AutoCAD is not running.',
      },
      plot: {
        state: plotState,
        ready: plotReady,
        operationAvailable,
        activeDocument,
        dependencies: {
          pywin32: booleanOrNull(dependencies.pywin32),
          pillow: booleanOrNull(dependencies.pillow),
          pdfium: booleanOrNull(dependencies.pdfium),
        },
        configurations: {
          pdf: booleanOrNull(configurations.pdf),
          png: booleanOrNull(configurations.png),
        },
        warnings,
        message: plotMessage,
      },
      updatedAt: new Date(this.now()).toISOString(),
    }
  }

  async diagnose(projectRoot: string, signal?: AbortSignal): Promise<CadHttpRuntimeDiagnosis> {
    let lease: CadHttpRuntimeLease | null = null
    try {
      lease = await this.acquire(projectRoot, { kind: 'xiaoliang-desktop' })
      return await lease.diagnose(signal)
    } catch (error) {
      const captured = this.captureError(error)
      if (!this.disposed) this.state = 'degraded'
      return unavailableDiagnosis(this.snapshot(), captured)
    } finally {
      await lease?.release().catch(() => undefined)
    }
  }

  acquire(
    projectRoot: string,
    identity: CadHttpBridgeIdentity,
  ): Promise<CadHttpRuntimeLease> {
    return this.exclusive(async () => {
      if (this.disposed) throw new Error('CAD HTTP runtime is disposed.')
      const resolvedProjectRoot = resolveProjectRoot(projectRoot)
      const client = await this.ensureBridge(resolvedProjectRoot)
      this.activeLeases += 1
      let released = false
      return {
        projectRoot: resolvedProjectRoot,
        facade: new CadApplicationFacade(new IdentityBoundExecutor(client, identity)),
        capabilities: (signal) => client.capabilities(signal),
        diagnose: (signal) => this.diagnoseClient(client, identity, signal),
        release: async () => {
          if (released) return
          released = true
          await this.exclusive(async () => {
            this.activeLeases = Math.max(0, this.activeLeases - 1)
            await this.finalizeDisposeIfIdle()
          })
        },
      }
    })
  }

  dispose(): Promise<void> {
    if (this.state === 'disposed') return Promise.resolve()
    if (this.disposeCompletion) return this.disposeCompletion.promise
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    this.disposeCompletion = { promise, resolve, reject }
    this.disposed = true
    this.cancelWatchdog()
    this.recordEvent(
      'info',
      'BRIDGE_RUNTIME_DISPOSING',
      this.activeLeases > 0
        ? 'CAD HTTP runtime will stop after active work releases its leases.'
        : 'CAD HTTP runtime is stopping.',
    )
    void this.exclusive(async () => this.finalizeDisposeIfIdle()).catch(() => undefined)
    return promise
  }
}

export interface DesktopCadHttpRuntimeOptions {
  appPath?: string
  userDataPath?: string
  resourcesPath?: string
  packaged?: boolean
  environment?: NodeJS.ProcessEnv
}

export function createDesktopCadHttpRuntime(
  options: DesktopCadHttpRuntimeOptions = {},
): ProjectScopedCadHttpRuntime {
  const packaged = options.packaged ?? app.isPackaged
  const appPath = path.resolve(options.appPath ?? app.getAppPath())
  const resourcesPath = path.resolve(options.resourcesPath ?? process.resourcesPath)
  const stateDirectory = path.join(
    path.resolve(options.userDataPath ?? app.getPath('userData')),
    'cad-http-bridge',
  )
  const pythonRoot = packaged
    ? path.join(resourcesPath, 'cad', 'autocad-http', 'python')
    : path.join(
        appPath,
        'electron',
        'runtime',
        'cad',
        'drivers',
        'autocad-http',
        'python',
      )
  const executablePath = packaged
    ? path.join(pythonRoot, 'packaged-bin', 'xiaoliang_cad_bridge.exe')
    : undefined
  return new ProjectScopedCadHttpRuntime({
    pythonRoot,
    descriptorPath: path.join(stateDirectory, 'descriptor.json'),
    lockPath: path.join(stateDirectory, 'bridge.lock'),
    ...(executablePath ? { executablePath } : {}),
    environment: options.environment,
  })
}
