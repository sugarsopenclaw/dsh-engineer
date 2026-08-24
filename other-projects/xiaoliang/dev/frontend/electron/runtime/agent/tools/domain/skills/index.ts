import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { getSkillRegistry } from '../../../skills/registry'
import {
  findLocalAlgorithms,
  runCadAlgorithm,
  saveCadAlgorithm,
  writeCadAlgorithmDraft,
} from '../../../algorithms/store'

function buildTextToolResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: 'text', text }],
    details,
  }
}

interface BuildSkillToolsOptions {
  conversationId: string
  consumeAlgorithmSaveApproval: () => boolean
}

export function buildSkillTools(options: BuildSkillToolsOptions): AgentTool<any>[] {
  const canAuthorAlgorithms = true

  const skillReadTool: AgentTool = {
    name: 'cad_skill_read',
    label: 'Read CAD Skill',
    description:
      '按 slug 读取本地已安装的 CAD skill 内容。适用于截图/图纸算量时，先读取匹配 skill，再生成算法或计算步骤。',
    parameters: Type.Object({
      slug: Type.String({
        minLength: 1,
        description: '技能 slug，例如 frustum-box-foundation',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const slug = typeof (params as { slug?: unknown }).slug === 'string'
        ? (params as { slug: string }).slug.trim()
        : ''
      const skill = slug ? getSkillRegistry().readSkill(slug) : null
      const content = skill ? getSkillRegistry().renderSkillContent(slug) : null
      return buildTextToolResult(
        content || `未找到 slug=${slug || '(empty)'} 对应的 CAD skill。`,
        {
          slug: slug || null,
          found: Boolean(skill && content),
          source: skill?.source ?? null,
          version: skill?.version ?? null,
          checksum: skill?.checksum ?? null,
        },
      )
    },
  }

  const algorithmFindTool: AgentTool = {
    name: 'cad_algorithm_find',
    label: 'Find CAD Algorithm',
    description:
      '构件工作流工具。生成新算法或执行算量前先检索本地已确认算法资产；若匹配当前构件且用户未要求重写，应直接调用 cad_algorithm_run 复用。',
    parameters: Type.Object({
      algorithm_slug: Type.Optional(Type.String({
        minLength: 2,
        description: '可选。已知算法 slug，例如 frustum-box-foundation。',
      })),
      query: Type.Optional(Type.String({
        description: '可选。用户问题、构件名称、图纸文字或关键尺寸，用于匹配已有算法。',
      })),
      limit: Type.Optional(Type.Number({
        minimum: 1,
        maximum: 10,
        description: '最多返回数量，默认 5。',
      })),
    }),
    execute: async (_toolCallId, params) => {
      const payload = params as {
        algorithm_slug?: unknown
        query?: unknown
        limit?: unknown
      }
      const slug = typeof payload.algorithm_slug === 'string' ? payload.algorithm_slug.trim() : ''
      const query = typeof payload.query === 'string' ? payload.query.trim() : ''
      const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit)
        ? payload.limit
        : 5
      let algorithms: ReturnType<typeof findLocalAlgorithms>
      try {
        algorithms = findLocalAlgorithms({
          slug: slug || undefined,
          query: query || undefined,
          limit,
        })
      } catch (error) {
        return buildTextToolResult(
          `本地算法资产检索失败：${error instanceof Error ? error.message : String(error)}`,
          {
            status: 'failed',
            query,
            slug: slug || null,
            algorithms: [],
          },
        )
      }
      if (algorithms.length === 0) {
        return buildTextToolResult(
          '未找到匹配的本地已确认算法资产。当前构件还没有确认算法，可先完成一次算法确认：生成 calculator.py 草稿、运行验证，并等待用户确认后保存。',
          {
            status: 'not_found',
            query,
            slug: slug || null,
            algorithms: [],
          },
        )
      }

      const primary = algorithms[0]
      const body = [
        `找到 ${algorithms.length} 个本地已确认算法资产。若当前构件匹配，且用户没有明确要求重写/优化算法，禁止重复生成 calculator.py；请直接提取参数并调用 cad_algorithm_run，source 传 saved。若用户明确要确认新算法，再走草稿验证链路。`,
        '',
        ...algorithms.map((algorithm, index) => [
          `${index + 1}. ${algorithm.slug} · ${algorithm.componentType} · ${algorithm.version}`,
          `   参数字段：${algorithm.parameterFields.length ? algorithm.parameterFields.join(', ') : '未声明'}`,
          `   确认时间：${algorithm.confirmedAt || '未知'}`,
        ].join('\n')),
        '',
        `首选算法 ${primary.slug} 的 parameter_contract：`,
        '```json',
        formatJsonForTool(primary.parameterContract),
        '```',
      ].join('\n')

      return buildTextToolResult(body, {
        status: 'found',
        query,
        slug: slug || null,
        algorithms: algorithms.map((algorithm) => ({
          slug: algorithm.slug,
          component_type: algorithm.componentType,
          version: algorithm.version,
          confirmed_at: algorithm.confirmedAt,
          parameter_fields: algorithm.parameterFields,
          calculator_checksum: algorithm.calculatorChecksum,
          algorithm_dir: algorithm.algorithmDir,
          calculator_path: algorithm.calculatorPath,
          metadata_path: algorithm.metadataPath,
          parameter_contract: algorithm.parameterContract,
          validation_cases: algorithm.validationCases,
          last_run: algorithm.lastRun,
        })),
      })
    },
  }

  const algorithmWriteTool: AgentTool = {
    name: 'cad_algorithm_write',
    label: 'Write CAD Algorithm',
    description:
      '构件工作流工具。仅在没有适用已确认算法、或用户明确要求重写/优化算法时，把可泛化 Python 算法写入草稿工作区；只允许生成 calculator.py、parameter_contract.json、validation_cases.json。',
    parameters: Type.Object({
      algorithm_slug: Type.String({
        minLength: 2,
        description: '算法 slug，仅小写字母、数字、中划线，例如 frustum-box-foundation。',
      }),
      calculator_code: Type.String({
        minLength: 40,
        description: 'Python 源码，必须定义 def calc(data: dict) -> dict。',
      }),
      parameter_contract: Type.Any({
        description: '算法入参协议 JSON，描述字段、单位、来源截图/实体、缺失时如何追问。',
      }),
      validation_cases: Type.Any({
        description: '验证样例 JSON，建议包含 input、expected_result、notes。',
      }),
    }),
    execute: async (_toolCallId, params) => {
      if (!canAuthorAlgorithms) {
        throw new Error('当前旧算量模式不允许写入算法草稿；请在统一问答中先完成算法确认。')
      }
      const payload = params as {
        algorithm_slug?: unknown
        calculator_code?: unknown
        parameter_contract?: unknown
        validation_cases?: unknown
      }
      const created = writeCadAlgorithmDraft({
        algorithmSlug: String(payload.algorithm_slug || ''),
        calculatorCode: String(payload.calculator_code || ''),
        parameterContract: payload.parameter_contract ?? {},
        validationCases: payload.validation_cases ?? [],
        sourceConversationId: options.conversationId,
      })
      const warnings = created.safetyWarnings.length > 0
        ? `\n\n注意：${created.safetyWarnings.join('；')}`
        : ''
      return buildTextToolResult(
        `算法草稿已写入：${created.slug}/calculator.py。下一步必须调用 cad_algorithm_run 执行验证。${warnings}`,
        {
          status: 'written',
          slug: created.slug,
          algorithm_dir: created.algorithmDir,
          calculator_path: created.calculatorPath,
          parameter_contract_path: created.parameterContractPath,
          validation_cases_path: created.validationCasesPath,
          metadata_path: created.metadataPath,
          calculator_checksum: created.calculatorChecksum,
          parameter_fields: created.parameterFields,
          safety_warnings: created.safetyWarnings,
        },
      )
    },
  }

  const algorithmRunTool: AgentTool = {
    name: 'cad_algorithm_run',
    label: 'Run CAD Algorithm',
    description:
      '构件工作流工具。执行本地已保存或草稿工作区中的 calculator.py；source=saved 用于复用已确认算法算量，source=draft 用于验证刚写入的草稿算法。',
    parameters: Type.Object({
      algorithm_slug: Type.String({ minLength: 2 }),
      source: Type.Optional(Type.Union([
        Type.Literal('auto'),
        Type.Literal('draft'),
        Type.Literal('saved'),
      ], {
        description: '执行来源。复用已确认算法时传 saved；验证刚写入的草稿时传 draft；默认 auto。',
      })),
      input_data: Type.Any({
        description: '传给 calc(data) 的 JSON 数据，字段应来自 parameter_contract。',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const payload = params as { algorithm_slug?: unknown, input_data?: unknown, source?: unknown }
      const sourcePreference =
        payload.source === 'draft' || payload.source === 'saved' || payload.source === 'auto'
          ? payload.source
          : 'auto'
      const result = await runCadAlgorithm({
        algorithmSlug: String(payload.algorithm_slug || ''),
        inputData: payload.input_data ?? {},
        sourcePreference,
      })
      const body = result.status === 'success'
        ? [
          `算法执行通过：${result.slug}`,
          '',
          '```json',
          JSON.stringify(result.result, null, 2),
          '```',
        ].join('\n')
        : [
          `算法执行失败：${result.slug}`,
          '',
          result.error || '未知错误',
          result.stderr ? `\n### stderr\n\`\`\`\n${result.stderr.trim()}\n\`\`\`` : '',
        ].join('\n')
      return buildTextToolResult(body, {
        ...result,
        source_conversation_id: options.conversationId,
      })
    },
  }

  const algorithmSaveTool: AgentTool = {
    name: 'cad_algorithm_save',
    label: 'Save CAD Algorithm',
    description:
      '构件工作流工具。最近一次 cad_algorithm_run 成功后，先展示验证结果，再在同一轮发起保存；运行时会弹出 A2UI 确认卡并在用户点击前阻塞写入，不要要求用户另发文字“确认”。',
    parameters: Type.Object({
      algorithm_slug: Type.String({ minLength: 2 }),
      confirmation_summary: Type.String({
        minLength: 10,
        description: '显示在确认卡上的验证依据摘要，例如截图、尺寸、体积结果与校验结论。',
      }),
      subtype_code: Type.Optional(Type.String({
        minLength: 1,
        description: '可选。当前构件已知的亚型路由编码，例如 DJP-300/600。未知时可省略。',
      })),
      drawing_name: Type.Optional(Type.String({
        minLength: 1,
        description: '可选。当前算法对应的图纸名；未传时将尝试按当前会话回填。',
      })),
      component_label: Type.Optional(Type.String({
        minLength: 1,
        description: '可选。紧凑构件摘要，例如 独立基础柱墩 / 截头体基础。',
      })),
    }),
    execute: async (_toolCallId, params) => {
      if (!canAuthorAlgorithms) {
        throw new Error('当前旧算量模式不允许保存新算法资产；请在统一问答中先完成算法确认。')
      }
      if (!options.consumeAlgorithmSaveApproval()) {
        const payload = params as { algorithm_slug?: unknown, confirmation_summary?: unknown }
        return buildTextToolResult(
          '保存被拦截：缺少本次工具调用对应的结构化确认令牌，当前算法未保存。请展示验证结果并重新发起 cad_algorithm_save，由运行时确认卡完成授权。',
          {
            status: 'blocked',
            saved: false,
            reason: 'missing_interaction_approval',
            slug: String(payload.algorithm_slug || ''),
            confirmation_summary: String(payload.confirmation_summary || ''),
            source_conversation_id: options.conversationId,
          },
        )
      }
      const payload = params as {
        algorithm_slug?: unknown
        confirmation_summary?: unknown
        subtype_code?: unknown
        drawing_name?: unknown
        component_label?: unknown
      }
      try {
        const saved = saveCadAlgorithm({
          algorithmSlug: String(payload.algorithm_slug || ''),
          confirmationSummary: String(payload.confirmation_summary || ''),
          subtypeCode: typeof payload.subtype_code === 'string' ? payload.subtype_code : null,
          drawingName: typeof payload.drawing_name === 'string' ? payload.drawing_name : null,
          componentLabel: typeof payload.component_label === 'string' ? payload.component_label : null,
        })

        return buildTextToolResult(
          `算法资产已保存：${saved.slug}/calculator.py。该资产仅保存在本机，不会投稿或上传到后端。`,
          {
            status: 'saved',
            saved: true,
            slug: saved.slug,
            algorithm_dir: saved.algorithmDir,
            calculator_path: saved.calculatorPath,
            metadata_path: saved.metadataPath,
            summary: saved.summary,
            source_conversation_id: options.conversationId,
          },
        )
      } catch (error) {
        return buildTextToolResult(
          `保存失败：${error instanceof Error ? error.message : String(error)}。当前算法未保存。`,
          {
            status: 'failed',
            saved: false,
            reason: error instanceof Error ? error.message : String(error),
            slug: String(payload.algorithm_slug || ''),
            source_conversation_id: options.conversationId,
          },
        )
      }
    },
  }

  return [
    ...(canAuthorAlgorithms ? [skillReadTool] : []),
    algorithmFindTool,
    ...(canAuthorAlgorithms ? [algorithmWriteTool] : []),
    algorithmRunTool,
    ...(canAuthorAlgorithms ? [algorithmSaveTool] : []),
  ]
}

function formatJsonForTool(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}
