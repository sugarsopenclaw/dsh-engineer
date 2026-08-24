import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  blenderMcpClientManager,
  type BlenderMcpClientManager,
  type BlenderMcpToolResultDetails,
} from '../../../mcp/blender-mcp-service'

interface BlenderMcpStatusDetails {
  success: boolean
  enabled: boolean
  running: boolean
  latencyMs: number
  host: string
  port: number
  command: string
  args: string[]
  toolCount: number
  tools: string[]
  error?: string
}

type BlenderSubagentTool = AgentTool<
  any,
  BlenderMcpToolResultDetails | BlenderMcpStatusDetails
>

function buildStatusTool(manager: BlenderMcpClientManager): BlenderSubagentTool {
  return {
    name: 'blender_mcp_status',
    label: 'Blender MCP Status',
    description: '检查隔离 Blender 子代理的 MCP 连接状态与可用工具。',
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      const result = await manager.testConnection()
      const text = result.success
        ? `Blender MCP 已连接：${result.host}:${result.port}，发现 ${result.toolCount} 个工具。`
        : `Blender MCP 未连接：${result.error || '未知错误'}`
      return {
        content: [{ type: 'text', text }],
        details: result,
      } satisfies AgentToolResult<BlenderMcpStatusDetails>
    },
  }
}

function buildRemoteTool(input: {
  manager: BlenderMcpClientManager
  localName: string
  remoteName: string
  label: string
  description: string
  parameters: any
}): BlenderSubagentTool {
  return {
    name: input.localName,
    label: input.label,
    description: [
      input.description,
      '只能读取或修改 Blender 场景；不得读取或修改 CAD/DWG、项目文件或外部系统。',
    ].join('\n'),
    parameters: input.parameters,
    execute: async (_toolCallId, params, signal) => input.manager.callTool(
      input.localName,
      input.remoteName,
      params as Record<string, unknown>,
      signal,
    ),
  }
}

/**
 * Fixed, auditable Blender tool surface for the isolated blender-modeler.
 * These wrappers stay available even when Blender is offline so the child can
 * report a stable connection failure instead of changing its trusted schema.
 */
export function buildBlenderSubagentTools(
  manager: BlenderMcpClientManager = blenderMcpClientManager,
): BlenderSubagentTool[] {
  return [
    buildStatusTool(manager),
    buildRemoteTool({
      manager,
      localName: 'blender_mcp_get_scene_info',
      remoteName: 'get_scene_info',
      label: 'Blender Scene Info',
      description: '读取当前 Blender 场景、对象和基础状态。',
      parameters: Type.Object({}, { additionalProperties: false }),
    }),
    buildRemoteTool({
      manager,
      localName: 'blender_mcp_get_object_info',
      remoteName: 'get_object_info',
      label: 'Blender Object Info',
      description: '按对象名称读取 Blender 对象的变换、几何和属性摘要。',
      parameters: Type.Object({
        object_name: Type.String({ minLength: 1, maxLength: 512 }),
      }, { additionalProperties: false }),
    }),
    buildRemoteTool({
      manager,
      localName: 'blender_mcp_get_viewport_screenshot',
      remoteName: 'get_viewport_screenshot',
      label: 'Blender Viewport Screenshot',
      description: '截取 Blender 当前视口，用于修改后的视觉自检。',
      parameters: Type.Object({
        max_size: Type.Optional(Type.Integer({ minimum: 256, maximum: 4096 })),
      }, { additionalProperties: false }),
    }),
    buildRemoteTool({
      manager,
      localName: 'blender_mcp_execute_blender_code',
      remoteName: 'execute_blender_code',
      label: 'Execute Blender Code',
      description: [
        '在 Blender 内执行聚焦当前任务的 Python 代码以创建或修改场景。',
        '代码不得访问文件、网络、进程、环境变量或凭证；修改主体几何后必须截图自检。',
      ].join('\n'),
      parameters: Type.Object({
        code: Type.String({ minLength: 1, maxLength: 100_000 }),
      }, { additionalProperties: false }),
    }),
  ]
}
