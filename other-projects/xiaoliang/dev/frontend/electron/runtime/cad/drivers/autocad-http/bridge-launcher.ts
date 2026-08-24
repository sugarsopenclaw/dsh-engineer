import {
  spawn as spawnProcess,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  CAD_HTTP_BRIDGE_PROTOCOL_VERSION,
  type CadHttpBridgeDescriptor,
  readCadHttpBridgeDescriptor,
} from './bridge-client'

const DEFAULT_START_TIMEOUT_MS = 20_000
const DEFAULT_POLL_INTERVAL_MS = 100
const DEFAULT_STOP_TIMEOUT_MS = 5_000

interface PythonLaunchSpec {
  command: string
  args: string[]
}

export interface CadHttpBridgeLaunchOptions {
  pythonRoot: string
  descriptorPath: string
  lockPath: string
  executablePath?: string
  python?: PythonLaunchSpec
  environment?: NodeJS.ProcessEnv
  fetchFn?: typeof fetch
  spawnFn?: typeof spawnProcess
  probeSpawnFn?: typeof spawnProcess
  startTimeoutMs?: number
  pollIntervalMs?: number
  stopTimeoutMs?: number
  isProcessAlive?: (pid: number) => boolean
  terminateProcess?: (pid: number) => void
}

export interface CadHttpBridgeHandle {
  descriptor: CadHttpBridgeDescriptor
  reused: boolean
  owned: boolean
  /** Stop this exact authenticated bridge even when it was adopted from an earlier host runtime. */
  terminate(): Promise<void>
  /** Release resources owned by this launcher; adopted bridges are intentionally left running. */
  stop(): Promise<void>
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function sameDescriptor(left: CadHttpBridgeDescriptor, right: CadHttpBridgeDescriptor): boolean {
  return (
    left.pid === right.pid
    && left.port === right.port
    && left.token === right.token
    && left.protocol_version === right.protocol_version
    && left.started_at === right.started_at
    && samePath(left.project_root, right.project_root)
  )
}

export function cadHttpBridgeProcessIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function readSmallJson(response: Response): Promise<unknown> {
  const maximumBytes = 64 * 1024
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) return null
  const body = await response.text()
  if (Buffer.byteLength(body, 'utf8') > maximumBytes) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

export async function cadHttpBridgeDescriptorIsHealthy(
  descriptor: CadHttpBridgeDescriptor,
  options: Pick<CadHttpBridgeLaunchOptions, 'fetchFn' | 'isProcessAlive'> = {},
): Promise<boolean> {
  if (!(options.isProcessAlive ?? cadHttpBridgeProcessIsAlive)(descriptor.pid)) return false
  const fetchFn = options.fetchFn ?? fetch
  const baseUrl = 'http://127.0.0.1:' + descriptor.port
  try {
    const health = await fetchWithTimeout(
      fetchFn,
      baseUrl + '/healthz',
      { method: 'GET' },
      1_000,
    )
    if (!health.ok) return false
    const healthPayload = await readSmallJson(health)
    if (
      typeof healthPayload !== 'object'
      || healthPayload === null
      || !('protocol_version' in healthPayload)
      || healthPayload.protocol_version !== descriptor.protocol_version
      || !('status' in healthPayload)
      || healthPayload.status !== 'alive'
      || !('worker_state' in healthPayload)
      || (healthPayload.worker_state !== 'ready' && healthPayload.worker_state !== 'busy')
    ) {
      return false
    }
    const capabilities = await fetchWithTimeout(
      fetchFn,
      baseUrl + '/v1/capabilities',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + descriptor.token },
      },
      2_000,
    )
    if (!capabilities.ok) return false
    const capabilitiesPayload = await readSmallJson(capabilities)
    return (
      typeof capabilitiesPayload === 'object'
      && capabilitiesPayload !== null
      && 'ok' in capabilitiesPayload
      && capabilitiesPayload.ok === true
      && 'protocol_version' in capabilitiesPayload
      && capabilitiesPayload.protocol_version === CAD_HTTP_BRIDGE_PROTOCOL_VERSION
    )
  } catch {
    return false
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForProcessExit(
  pid: number,
  options: CadHttpBridgeLaunchOptions,
): Promise<void> {
  const processAlive = options.isProcessAlive ?? cadHttpBridgeProcessIsAlive
  const deadline = Date.now() + (options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS)
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return
    await delay(50)
  }
  throw new Error('CAD HTTP bridge did not stop before its deadline.')
}

async function terminateVerifiedBridge(
  descriptor: CadHttpBridgeDescriptor,
  options: CadHttpBridgeLaunchOptions,
  requireAuthentication = false,
): Promise<void> {
  let current: CadHttpBridgeDescriptor
  try {
    current = readCadHttpBridgeDescriptor(options.descriptorPath)
  } catch {
    throw new Error('CAD bridge descriptor changed before termination; refusing to terminate a PID.')
  }
  if (!sameDescriptor(current, descriptor)) {
    throw new Error('CAD bridge identity changed before termination; refusing to terminate a PID.')
  }
  if (requireAuthentication) {
    const fetchFn = options.fetchFn ?? fetch
    try {
      const response = await fetchWithTimeout(
        fetchFn,
        `http://127.0.0.1:${descriptor.port}/v1/capabilities`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${descriptor.token}` },
        },
        2_000,
      )
      const payload = await readSmallJson(response)
      if (
        !response.ok
        || typeof payload !== 'object'
        || payload === null
        || !('ok' in payload)
        || payload.ok !== true
        || !('protocol_version' in payload)
        || payload.protocol_version !== descriptor.protocol_version
      ) {
        throw new Error('authentication failed')
      }
    } catch {
      throw new Error('CAD bridge could not authenticate before termination; refusing to terminate a PID.')
    }
  }
  const terminate = options.terminateProcess
    ?? ((pid: number) => process.kill(pid, 'SIGTERM'))
  terminate(descriptor.pid)
  await waitForProcessExit(descriptor.pid, options)
}

async function probePython(options: CadHttpBridgeLaunchOptions): Promise<PythonLaunchSpec> {
  const environment = { ...process.env, ...options.environment }
  const candidates: PythonLaunchSpec[] = []
  const explicit = environment.XIAOLIANG_CAD_BRIDGE_PYTHON
    || environment.CAD_PYTHON_PATH
    || environment.PYTHON_PATH
  if (explicit?.trim()) candidates.push({ command: explicit.trim(), args: [] })
  candidates.push(
    { command: 'py', args: ['-3'] },
    { command: 'python', args: [] },
  )
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = candidate.command + '\u0000' + candidate.args.join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    const executable = await new Promise<string | null>((resolve) => {
      let child: ChildProcess
      try {
        child = (options.probeSpawnFn ?? spawnProcess)(
          candidate.command,
          [
            ...candidate.args,
            '-c',
            'import sys,fastapi,uvicorn,PIL,pypdfium2,pythoncom,win32com.client; print(sys.executable)',
          ],
          {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
            env: environment,
          },
        )
      } catch {
        resolve(null)
        return
      }
      let settled = false
      let stdout = ''
      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(value)
      }
      const timeout = setTimeout(() => {
        child.kill()
        finish(null)
      }, 15_000)
      timeout.unref?.()
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        if (stdout.length >= 16 * 1024) return
        stdout += chunk.slice(0, 16 * 1024 - stdout.length)
      })
      child.once('error', () => finish(null))
      child.once('close', (code) => {
        if (code !== 0) return finish(null)
        const resolved = stdout
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .filter(Boolean)
        .at(-1)
        finish(resolved || null)
      })
    })
    if (executable) {
      return { command: executable, args: [] }
    }
  }
  throw new Error(
    'No Python runtime with pywin32, Pillow, FastAPI, Uvicorn, and pypdfium2 '
    + 'is available for CAD HTTP bridge.',
  )
}

function launchEnvironment(options: CadHttpBridgeLaunchOptions): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...options.environment }
  const existing = environment.PYTHONPATH?.trim()
  const pythonRoot = path.resolve(options.pythonRoot)
  return {
    ...environment,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONPATH: existing
      ? pythonRoot + path.delimiter + existing
      : pythonRoot,
  }
}

function removeDescriptorIfOwned(descriptorPath: string, pid: number): void {
  try {
    if (readCadHttpBridgeDescriptor(descriptorPath).pid === pid) {
      fs.rmSync(descriptorPath, { force: true })
    }
  } catch {
    // Missing, changed or malformed descriptors are not ours to remove.
  }
}

function adoptedHandle(
  descriptor: CadHttpBridgeDescriptor,
  descriptorPath: string,
  options: CadHttpBridgeLaunchOptions,
): CadHttpBridgeHandle {
  let terminated = false
  return {
    descriptor,
    reused: true,
    owned: false,
    terminate: async () => {
      if (terminated) return
      if ((options.isProcessAlive ?? cadHttpBridgeProcessIsAlive)(descriptor.pid)) {
        await terminateVerifiedBridge(descriptor, options, true)
      }
      removeDescriptorIfOwned(descriptorPath, descriptor.pid)
      terminated = true
    },
    async stop() {},
  }
}

export async function startCadHttpBridge(
  projectRoot: string,
  options: CadHttpBridgeLaunchOptions,
): Promise<CadHttpBridgeHandle> {
  const resolvedProjectRoot = fs.realpathSync(path.resolve(projectRoot))
  if (!fs.statSync(resolvedProjectRoot).isDirectory()) {
    throw new Error('Project root must be an existing directory.')
  }
  const descriptorPath = path.resolve(options.descriptorPath)
  const lockPath = path.resolve(options.lockPath)
  let existing: CadHttpBridgeDescriptor | undefined
  try {
    existing = readCadHttpBridgeDescriptor(descriptorPath)
  } catch {
    // Missing or malformed descriptors are stale.
  }
  if (existing && await cadHttpBridgeDescriptorIsHealthy(existing, options)) {
    if (samePath(existing.project_root, resolvedProjectRoot)) {
      return adoptedHandle(existing, descriptorPath, options)
    }
    await terminateVerifiedBridge(existing, options, true)
  }
  try {
    fs.rmSync(descriptorPath, { force: true })
  } catch {
    // Health polling resolves a concurrent winner.
  }

  const executablePath = options.executablePath
    ? path.resolve(options.executablePath)
    : undefined
  if (executablePath && !fs.existsSync(executablePath)) {
    throw new Error('Configured CAD HTTP bridge executable is missing.')
  }
  const executableMode = Boolean(executablePath && fs.existsSync(executablePath))
  const resolvedPythonRoot = path.resolve(options.pythonRoot)
  if (
    !executableMode
    && (!fs.existsSync(resolvedPythonRoot) || !fs.statSync(resolvedPythonRoot).isDirectory())
  ) {
    throw new Error('CAD HTTP bridge Python source root is missing.')
  }
  const python = executableMode ? undefined : (options.python ?? await probePython(options))
  const command = executableMode ? executablePath as string : python?.command as string
  const args = [
    ...(executableMode ? [] : [...(python?.args ?? []), '-m', 'xiaoliang_cad_bridge']),
    '--project-root',
    resolvedProjectRoot,
    '--descriptor',
    descriptorPath,
    '--lock',
    lockPath,
  ]
  const spawnOptions: SpawnOptions = {
    cwd: resolvedProjectRoot,
    env: launchEnvironment(options),
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
    detached: false,
  }
  const child: ChildProcess = (options.spawnFn ?? spawnProcess)(command, args, spawnOptions)
  const ownedPid = child.pid
  const startupDeadline = Date.now() + (options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS)
  try {
    while (Date.now() < startupDeadline) {
      try {
        const descriptor = readCadHttpBridgeDescriptor(descriptorPath)
        if (
          samePath(descriptor.project_root, resolvedProjectRoot)
          && await cadHttpBridgeDescriptorIsHealthy(descriptor, options)
        ) {
          const owned = ownedPid !== undefined && descriptor.pid === ownedPid
          if (!owned) return adoptedHandle(descriptor, descriptorPath, options)
          let stopped = false
          const terminate = async () => {
            if (stopped) return
            if (
              child.exitCode === null
              && (options.isProcessAlive ?? cadHttpBridgeProcessIsAlive)(descriptor.pid)
            ) {
              await terminateVerifiedBridge(descriptor, options)
            }
            removeDescriptorIfOwned(descriptorPath, descriptor.pid)
            stopped = true
          }
          return {
            descriptor,
            reused: false,
            owned: true,
            terminate,
            stop: terminate,
          }
        }
      } catch {
        // Descriptor is atomically published after loopback bind.
      }
      if (child.exitCode !== null) {
        throw new Error('CAD HTTP bridge exited during startup.')
      }
      await delay(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    }
    throw new Error('CAD HTTP bridge did not become healthy before its startup deadline.')
  } catch (error) {
    if (
      ownedPid !== undefined
      && (options.isProcessAlive ?? cadHttpBridgeProcessIsAlive)(ownedPid)
    ) {
      try {
        ;(options.terminateProcess ?? ((pid: number) => process.kill(pid, 'SIGTERM')))(ownedPid)
        await waitForProcessExit(ownedPid, options)
      } catch {
        // Preserve the startup error; the caller can surface diagnostics.
      }
    }
    removeDescriptorIfOwned(descriptorPath, ownedPid ?? -1)
    throw error
  }
}
