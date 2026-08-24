import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type {
  SubagentDelegateExecutionContext,
  SubagentDelegateService,
} from '../../../subagents/subagent-delegate'
import type {
  SubagentTaskService,
  SubagentTaskWaitResult,
} from '../../../tasks/background/subagent-task-service'
import { MAX_SUBAGENT_TASK_WAIT_MS } from '../../../tasks/background/subagent-task-service'
import {
  BLENDER_MODELER_AGENT_TYPE,
  CAD_ANALYST_AGENT_TYPE,
  CAD_DRAFTER_AGENT_TYPE,
  type SubagentType,
} from '../../../subagents/contracts'

export interface DelegateToolInput {
  task: string
}

export interface BuildSubagentDelegateToolsOptions {
  service: SubagentDelegateService
  resolveContext: (type: SubagentType) => SubagentDelegateExecutionContext
  resolveCadSessionContext?: () => Promise<string | null> | string | null
  projectId?: string | null
  cadContextAvailable: boolean
  taskService?: SubagentTaskService
  resolveParentConversationId?: () => string
  /**
   * Resolves when the user queues a steering message on the parent conversation.
   * Lets a blocking task wait release the turn so the interjection is answered first.
   */
  observeParentUserMessage?: (signal: AbortSignal) => Promise<void>
  /** When set, delegation defaults to ending the turn instead of blocking on the task. */
  interactiveDelegation?: boolean
}

const ZERO_TOOL_USAGE = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }),
})

const YIELD_NOTICES: Record<NonNullable<SubagentTaskWaitResult['yielded']>, string> = {
  user_message: [
    '用户发来了新消息，等待已提前结束。任务仍在后台运行，没有被取消。',
    '先响应用户这条消息；任务完成后 host 会自动把终态注入本会话，不需要你继续等待。',
  ].join('\n'),
  aborted: '当前回合已被中止，等待提前结束。任务仍在后台运行。',
}

function yieldNotice(waited: SubagentTaskWaitResult): { type: 'text'; text: string }[] {
  if (waited.yielded) return [{ type: 'text' as const, text: YIELD_NOTICES[waited.yielded] }]
  if (waited.timedOut) {
    return [{ type: 'text' as const, text: 'Wait timed out; the task is still active.' }]
  }
  return []
}

function projectTaskStatusResult(waited: SubagentTaskWaitResult) {
  const notices = yieldNotice(waited)
  if (waited.tasks.length === 1) {
    const task = waited.tasks[0]
    return {
      ...task.result,
      content: [...task.result.content, ...notices],
      details: { ...task.result.details, ...(waited.yielded ? { yielded: waited.yielded } : {}) },
      usage: ZERO_TOOL_USAGE,
    }
  }
  if (waited.tasks.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No background subagent tasks are registered for this conversation.' }],
      details: { timed_out: false, tasks: [] },
      usage: ZERO_TOOL_USAGE,
    }
  }
  return {
    content: [{
      type: 'text' as const,
      text: [
        ...notices.map((notice) => notice.text),
        waited.timedOut || waited.yielded ? '' : 'Subagent task status snapshot:',
        ...waited.tasks.flatMap((task) => [
          `\n--- ${task.taskId} ---`,
          ...task.result.content.map((item) => item.text),
        ]),
      ].filter((line) => line !== '').join('\n'),
    }],
    details: {
      timed_out: waited.timedOut,
      ...(waited.yielded ? { yielded: waited.yielded } : {}),
      tasks: waited.tasks.map((task) => ({
        task_id: task.taskId,
        terminal: task.terminal,
        delivered: task.delivered,
        ...task.result.details,
      })),
    },
    usage: ZERO_TOOL_USAGE,
  }
}

function backgroundDelegateNotes(options: BuildSubagentDelegateToolsOptions): string[] {
  if (!options.service.backgroundEnabled) return ['本工具等待 child 终态后返回。']
  if (!options.interactiveDelegation) {
    return ['本工具立即返回 taskId；用 subagent_task_status 查询或等待终态。']
  }
  return ['本工具立即返回 taskId，不是终态；默认结束本回合等 host 注入终态，等待纪律见[任务路由]。']
}

function taskSchema(description: string) {
  return Type.Object({
    task: Type.String({
      minLength: 1,
      maxLength: 50_000,
      description,
    }),
  }, { additionalProperties: false })
}

export function buildSubagentDelegateTools(
  options: BuildSubagentDelegateToolsOptions,
): AgentTool<any, any>[] {
  const tools: AgentTool<any, any>[] = []

  if (
    options.cadContextAvailable
    && options.service.isEnabled(CAD_ANALYST_AGENT_TYPE, options.projectId)
  ) {
    tools.push({
      name: 'delegate_cad',
      label: 'CAD Evidence Subagent',
      description: [
        '把一项自包含、项目内的 CAD 取证任务委派给隔离 cad-analyst；child 只收集证据，不形成用户答案，也不操作 Blender。',
        'AutoCAD 权威通道，同时只能跑一个：精确净尺寸量测、OLE/Excel 嵌入表渲染、嵌套块内部几何、权威 handle 字段、图框检测与宏观识图都只有本通道能做。',
        '也可取证项目名称与建设地点：从实际图纸的图签/标题栏/设计总说明逐字摘录并回报检查过的项目相对图纸名；不得根据文件名猜地区。',
        'task 写清区域/构件、编号和必需字段，并保留用户的快速/范围限制；单构件快速问题不得扩写成通用字段、全图实例或多张截图清单，明确要求 child 走 extract → 精确 search → detail。运行时自动附带当前活动图状态，无需在 task 里猜图。',
        '一任务一目标：一个构件或一个区域一次委派。多目标混在一个 task 里，child 会在取够证据后收尾失败，整单证据白跑；按目标拆成多次委派，两条通道各自可并行。',
        '终态产物是 evidence pack（evidence.md 与引用图片）的项目相对路径。',
        ...backgroundDelegateNotes(options),
      ].join('\n'),
      parameters: taskSchema('由当前对话消解得到的 CAD 取证任务；无需猜测或补写活动图路径。'),
      execute: async (_toolCallId, params, signal) => {
        const task = (params as DelegateToolInput).task.trim()
        const cadSessionContext = await options.resolveCadSessionContext?.()
        return options.service.delegate(
          CAD_ANALYST_AGENT_TYPE,
          cadSessionContext ? `${task}\n\n${cadSessionContext}` : task,
          options.resolveContext(CAD_ANALYST_AGENT_TYPE),
          signal,
        )
      },
    })
  }

  if (
    options.cadContextAvailable
    && options.service.isEnabled(CAD_DRAFTER_AGENT_TYPE, options.projectId)
  ) {
    tools.push({
      name: 'delegate_cad_drafter',
      label: 'CAD File Channel Subagent',
      description: [
        '文件通道读图取证：直接解析项目里的图纸文件、不占用 AutoCAD，可与 delegate_cad 同时进行。',
        '优先走本通道：线框表格类图纸（门窗表、材料做法表等）整表转录、区域扫图、文字与编号定位、图层清单。',
        '项目身份预检也可走本通道：从指定图纸的图签/标题栏/设计总说明摘录项目名称、建设地点、建设类型、专业与专项特征，并回报实际图纸名；不可读字段再交 AutoCAD 通道。',
        '必须改走 delegate_cad：OLE/Excel 嵌入表（本通道渲染为空白块）、嵌套块内部几何、精确净尺寸量测、以 AutoCAD 为准的权威 handle 字段。',
        '只读：不能画图、标注或导出新图纸。task 写清图纸项目相对路径与所需字段。',
        '一任务一目标：一张图一个目标一次委派。多目标混在一个 task 里，child 会在取够证据后收尾失败，整单证据白跑；多张图或多个构件拆成多次委派，本通道之间可并发。',
        '终态产物同样是 evidence.md。',
        ...backgroundDelegateNotes(options),
      ].join('\n'),
      parameters: taskSchema('由当前对话消解得到的读图取证任务，含图纸项目相对路径与所需字段。'),
      execute: async (_toolCallId, params, signal) => options.service.delegate(
        CAD_DRAFTER_AGENT_TYPE,
        (params as DelegateToolInput).task.trim(),
        options.resolveContext(CAD_DRAFTER_AGENT_TYPE),
        signal,
      ),
    })
  }

  tools.push({
    name: 'delegate_blender',
    label: 'Blender Modeling Subagent',
    description: [
      '把 Blender 场景检查、三维建模、修改或视觉自检任务委派给隔离 blender-modeler。',
      'child 不继承父对话：task 必须写清对象、关键参数、必须保留的内容和验收条件。',
      'CAD 驱动的建模先按[任务路由]完成取证与核验，再把已核验参数整理进本任务。',
      ...backgroundDelegateNotes(options),
    ].join('\n'),
    parameters: taskSchema('由当前对话和已核验证据整理出的自包含 Blender 执行任务。'),
    execute: async (_toolCallId, params, signal) => options.service.delegate(
      BLENDER_MODELER_AGENT_TYPE,
      (params as DelegateToolInput).task,
      options.resolveContext(BLENDER_MODELER_AGENT_TYPE),
      signal,
    ),
  })

  if (
    options.service.backgroundEnabled
    && options.taskService
    && options.resolveParentConversationId
  ) {
    tools.push({
      name: 'subagent_task_status',
      label: 'Subagent Task Status',
      description: [
        '查询或等待当前父会话启动的后台子代理任务（CAD / Blender）；何时等待见[任务路由]。',
        'timeoutMs=0 立即返回快照；timeoutMs>0 等待任一任务终态，最长 600000ms。',
        ...(options.interactiveDelegation
          ? ['阻塞等待会在用户插话时提前返回 yielded=user_message；此时任务仍在后台运行，应先回应用户而不是重新等待。']
          : []),
        '终态只返回 host 校验后的 CAD evidence refs 或 Blender resultText，不返回 child transcript。',
      ].join('\n'),
      parameters: Type.Object({
        taskIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
          minItems: 1,
          maxItems: 32,
          description: '要查询的 taskId；省略时返回当前会话全部活动任务和最近完成任务（通常最多 32 条）。',
        })),
        timeoutMs: Type.Optional(Type.Integer({
          minimum: 0,
          maximum: MAX_SUBAGENT_TASK_WAIT_MS,
          default: 0,
          description: '0 表示非阻塞查询；正数表示最长等待毫秒数。',
        })),
      }, { additionalProperties: false }),
      execute: async (_toolCallId, params, signal) => {
        const input = params as { taskIds?: string[]; timeoutMs?: number }
        return projectTaskStatusResult(await options.taskService!.wait({
          parentConversationId: options.resolveParentConversationId!(),
          taskIds: input.taskIds,
          timeoutMs: input.timeoutMs ?? 0,
          ...(options.observeParentUserMessage
            ? { interrupt: options.observeParentUserMessage }
            : {}),
          ...(signal ? { signal } : {}),
        }))
      },
    })
  }

  return tools
}
