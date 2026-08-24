import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { Client } from '@modelcontextprotocol/sdk/client'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult, Tool as McpTool } from '@modelcontextprotocol/sdk/types'
import type {
  BlenderMcpConnectionTestResult,
  BlenderMcpSettingsView,
} from '../../../../src/shared/local-agent'
import { getBlenderMcpSettingsView } from '../../settings/blender-mcp-settings-repository'
import { getUvMirrorEnv } from './blender-mcp-runtime'

export interface BlenderMcpToolDescriptor {
  localName: string
  remoteName: string
  label: string
  description: string
  inputSchema: McpTool['inputSchema']
}

export interface BlenderMcpToolResultDetails {
  server: 'blender-mcp'
  remoteName: string
  localName: string
  isError: boolean
  raw: unknown
}

const LOCAL_TOOL_PREFIX = 'blender_mcp_'
const CONNECT_TIMEOUT_MS = 12_000
const LIST_TOOLS_TIMEOUT_MS = 12_000
const HOST_READINESS_TIMEOUT_MS = 10_000
const CALL_TOOL_TIMEOUT_MS = 180_000
const PACKAGED_UV_RESOURCE_DIR = 'uv'
const SCENE_INFO_TOOL_NAME = 'get_scene_info'
const HOST_READINESS_ERROR_PATTERN = /(?:^|\n)\s*error\s+getting\s+scene\s+info\s*:|could not connect to blender|not connected to blender|failed to connect to blender|connection to blender lost|make sure the blender addon is running|timeout waiting for blender response|\beconnrefused\b|connection refused/i

interface BlenderMcpCommandSpec {
  command: string
  args: string[]
}

function buildFingerprint(settings: BlenderMcpSettingsView) {
  return JSON.stringify({
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    command: settings.command,
    args: settings.args,
  })
}

function isBareCommand(command: string) {
  return command.trim() !== '' && !/[\\/]/.test(command) && !/^[a-zA-Z]:/.test(command)
}

function getPackagedExecutablePath(fileName: string) {
  if (!app.isPackaged) {
    return null
  }

  const candidate = path.join(process.resourcesPath, PACKAGED_UV_RESOURCE_DIR, fileName)
  return fs.existsSync(candidate) ? candidate : null
}

function resolveCommandSpec(settings: BlenderMcpSettingsView): BlenderMcpCommandSpec {
  const command = settings.command.trim()
  const args = [...settings.args]
  if (!app.isPackaged || !isBareCommand(command)) {
    return { command, args }
  }

  const normalized = command.toLowerCase()
  if (normalized === 'uvx' || normalized === 'uvx.exe') {
    const packagedUvx = getPackagedExecutablePath('uvx.exe')
    if (packagedUvx) {
      return { command: packagedUvx, args }
    }

    const packagedUv = getPackagedExecutablePath('uv.exe')
    if (packagedUv) {
      return {
        command: packagedUv,
        args: ['tool', 'run', ...args],
      }
    }
  }

  if (normalized === 'uv' || normalized === 'uv.exe') {
    const packagedUv = getPackagedExecutablePath('uv.exe')
    if (packagedUv) {
      return { command: packagedUv, args }
    }
  }

  return { command, args }
}

function normalizeToolName(name: string) {
  return `${LOCAL_TOOL_PREFIX}${name.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

function buildEnv(settings: BlenderMcpSettingsView) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value
    }
  }
  // uv 首跑需下载 managed Python 与 PyPI 包,未预热时也走国内镜像兜底。
  Object.assign(env, getUvMirrorEnv(env))
  env.BLENDER_HOST = settings.host
  env.BLENDER_PORT = String(settings.port)
  return env
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function appendLimited(current: string, next: string, limit = 4_000) {
  const merged = `${current}${next}`
  return merged.length > limit ? merged.slice(-limit) : merged
}

function compactMessage(value: string, limit = 600) {
  const compacted = value.replace(/\s+/g, ' ').trim()
  return compacted.length > limit ? `${compacted.slice(0, limit)}...` : compacted
}

function buildSceneProbeArguments(inputSchema: McpTool['inputSchema']) {
  const properties = inputSchema && typeof inputSchema === 'object'
    ? (inputSchema as { properties?: unknown }).properties
    : null
  if (properties && typeof properties === 'object' && 'user_prompt' in properties) {
    return { user_prompt: 'Check whether the host Blender scene is reachable.' }
  }
  return {}
}

function readSceneProbeError(result: CallToolResult) {
  const messages: string[] = []
  if (Array.isArray((result as { content?: unknown }).content)) {
    for (const block of (result as { content: unknown[] }).content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') {
        messages.push(record.text)
      }
    }
  }
  if ('structuredContent' in result && result.structuredContent != null) {
    messages.push(safeStringify(result.structuredContent))
  }
  if ('toolResult' in result && result.toolResult != null) {
    messages.push(safeStringify(result.toolResult))
  }

  const message = compactMessage(messages.join('\n'))
  if (Boolean((result as { isError?: unknown }).isError)) {
    return message || 'Blender MCP 场景探测失败。'
  }
  return HOST_READINESS_ERROR_PATTERN.test(messages.join('\n')) ? message : ''
}

function convertMcpContentBlock(block: unknown): AgentToolResult<BlenderMcpToolResultDetails>['content'][number] | null {
  if (!block || typeof block !== 'object') {
    return null
  }
  const record = block as Record<string, unknown>
  const type = record.type
  if (type === 'text' && typeof record.text === 'string') {
    return { type: 'text', text: record.text }
  }
  if (type === 'image' && typeof record.data === 'string' && typeof record.mimeType === 'string') {
    return { type: 'image', data: record.data, mimeType: record.mimeType }
  }
  if (type === 'resource') {
    return { type: 'text', text: safeStringify(record.resource ?? record) }
  }
  if (type === 'resource_link') {
    return { type: 'text', text: safeStringify(record) }
  }
  return { type: 'text', text: safeStringify(record) }
}

export function convertMcpToolResult(
  localName: string,
  remoteName: string,
  result: CallToolResult,
): AgentToolResult<BlenderMcpToolResultDetails> {
  const content: AgentToolResult<BlenderMcpToolResultDetails>['content'] = []
  if (Array.isArray((result as { content?: unknown }).content)) {
    for (const block of (result as { content: unknown[] }).content) {
      const converted = convertMcpContentBlock(block)
      if (converted) {
        content.push(converted)
      }
    }
  }
  if ('structuredContent' in result && result.structuredContent != null) {
    content.push({
      type: 'text',
      text: `structuredContent:\n${safeStringify(result.structuredContent)}`,
    })
  }
  if ('toolResult' in result && result.toolResult != null) {
    content.push({
      type: 'text',
      text: safeStringify(result.toolResult),
    })
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: safeStringify(result) })
  }

  return {
    content,
    details: {
      server: 'blender-mcp',
      remoteName,
      localName,
      isError: Boolean((result as { isError?: unknown }).isError),
      raw: result,
    },
  }
}

export class BlenderMcpClientManager {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private fingerprint = ''
  private connecting: Promise<void> | null = null
  private cachedTools: BlenderMcpToolDescriptor[] = []
  private lastError = ''
  private stderrTail = ''

  private async connect(settings: BlenderMcpSettingsView) {
    if (!settings.enabled) {
      throw new Error('Blender MCP 未启用。')
    }

    await this.close()
    const commandSpec = resolveCommandSpec(settings)

    const transport = new StdioClientTransport({
      command: commandSpec.command,
      args: commandSpec.args,
      env: buildEnv(settings),
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => {
      this.stderrTail = appendLimited(this.stderrTail, Buffer.from(chunk).toString('utf8'))
    })

    const client = new Client({
      name: 'xiaoliang-blender-mcp-client',
      version: '0.1.0',
    })
    client.onclose = () => {
      if (this.client === client) {
        this.client = null
        this.transport = null
        this.cachedTools = []
      }
    }
    client.onerror = (error) => {
      this.lastError = readErrorMessage(error)
    }

    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS })
    this.client = client
    this.transport = transport
    this.fingerprint = buildFingerprint(settings)
    this.lastError = ''
  }

  private async ensureConnected() {
    const settings = getBlenderMcpSettingsView()
    const fingerprint = buildFingerprint(settings)
    if (this.client && this.fingerprint === fingerprint) {
      return settings
    }
    if (this.connecting) {
      await this.connecting
      return settings
    }

    this.connecting = this.connect(settings)
      .catch((error) => {
        this.lastError = readErrorMessage(error)
        throw error
      })
      .finally(() => {
        this.connecting = null
      })
    await this.connecting
    return settings
  }

  async listTools(): Promise<BlenderMcpToolDescriptor[]> {
    await this.ensureConnected()
    if (!this.client) {
      throw new Error('Blender MCP client 未连接。')
    }

    const result = await this.client.listTools(undefined, { timeout: LIST_TOOLS_TIMEOUT_MS })
    this.cachedTools = result.tools.map((tool) => ({
      localName: normalizeToolName(tool.name),
      remoteName: tool.name,
      label: `Blender MCP: ${tool.title || tool.name}`,
      description: tool.description || `调用 Blender MCP 工具 ${tool.name}。`,
      inputSchema: tool.inputSchema,
    }))
    return this.cachedTools
  }

  async callTool(
    localName: string,
    remoteName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    await this.ensureConnected()
    if (!this.client) {
      throw new Error('Blender MCP client 未连接。')
    }

    const result = await this.client.callTool(
      { name: remoteName, arguments: args },
      undefined,
      {
        signal,
        timeout: CALL_TOOL_TIMEOUT_MS,
        resetTimeoutOnProgress: true,
      },
    )
    return convertMcpToolResult(localName, remoteName, result as CallToolResult)
  }

  async testConnection(): Promise<BlenderMcpConnectionTestResult> {
    const settings = getBlenderMcpSettingsView()
    const startedAt = Date.now()
    if (!settings.enabled) {
      return {
        success: false,
        enabled: false,
        running: false,
        latencyMs: 0,
        host: settings.host,
        port: settings.port,
        command: settings.command,
        args: settings.args,
        toolCount: 0,
        tools: [],
        error: 'Blender MCP 未启用。',
      }
    }

    let discoveredTools: BlenderMcpToolDescriptor[] = []
    let probingHost = false
    try {
      discoveredTools = await this.listTools()
      const sceneInfoTool = discoveredTools.find((tool) => tool.remoteName === SCENE_INFO_TOOL_NAME)
      if (!sceneInfoTool || !this.client) {
        throw new Error('Blender MCP 未提供宿主场景探测工具 get_scene_info。')
      }

      probingHost = true
      const probeResult = await this.client.callTool(
        {
          name: sceneInfoTool.remoteName,
          arguments: buildSceneProbeArguments(sceneInfoTool.inputSchema),
        },
        undefined,
        { timeout: HOST_READINESS_TIMEOUT_MS },
      ) as CallToolResult
      const probeError = readSceneProbeError(probeResult)
      if (probeError) {
        throw new Error(`宿主 Blender 不可达：${probeError}`)
      }

      return {
        success: true,
        enabled: true,
        running: Boolean(this.client),
        latencyMs: Date.now() - startedAt,
        host: settings.host,
        port: settings.port,
        command: settings.command,
        args: settings.args,
        toolCount: discoveredTools.length,
        tools: discoveredTools.map((tool) => tool.localName),
      }
    } catch (error) {
      const message = readErrorMessage(error)
      const toolSnapshot = discoveredTools.length > 0 ? discoveredTools : this.cachedTools
      if (probingHost && !message.startsWith('宿主 Blender 不可达：')) {
        await this.close()
      }
      return {
        success: false,
        enabled: true,
        running: Boolean(this.client),
        latencyMs: Date.now() - startedAt,
        host: settings.host,
        port: settings.port,
        command: settings.command,
        args: settings.args,
        toolCount: toolSnapshot.length,
        tools: toolSnapshot.map((tool) => tool.localName),
        error: this.stderrTail ? `${message}\n${this.stderrTail}` : message,
      }
    }
  }

  async close() {
    const client = this.client
    this.client = null
    this.transport = null
    this.cachedTools = []
    if (client) {
      try {
        await client.close()
      } catch {
        // Ignore shutdown errors; the next connection attempt will spawn a clean process.
      }
    }
  }
}

export const blenderMcpClientManager = new BlenderMcpClientManager()
