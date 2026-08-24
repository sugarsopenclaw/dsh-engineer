import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { FactsBuildService } from '../../../../cad/facts/facts-build-service'
import {
  CAD_MLIGHT_ENTITIES_PRODUCER,
  drawingArtifactPaths,
  inspectEntitiesArtifact,
} from './artifact-store'
import { drawingFromProjectPath } from './entity-index'
import { cadToolResult, type CadSubagentToolDetails } from './tool-result'

const TASK_TYPES = [
  'count',
  'measure',
  'locate',
  'identify',
  'describe',
  'check',
  'audit',
  'reconcile',
  'trace',
] as const

const SCOPE_TYPES = [
  'entity',
  'pattern',
  'semantic_representation',
  'project_object',
  'region',
  'view',
  'sheet',
  'file',
  'storey',
  'building',
  'system',
  'discipline',
  'project',
  'revision_range',
] as const

const TRUTH_BASES = [
  'file_fact',
  'drawing_expression',
  'design_intent',
  'bom_declaration',
  'physical_reality',
] as const

interface CadFactsInput {
  action: 'status' | 'build'
  drawing_path?: string
}

interface CadAskInput {
  task_type: typeof TASK_TYPES[number]
  target: string | {
    semantic_class: string
    selectors?: Record<string, unknown>
  }
  scope?: {
    type?: typeof SCOPE_TYPES[number]
    files?: string[]
    sheets?: string[]
    views?: string[]
    regions?: number[][]
    systems?: string[]
    storeys?: string[]
    object_refs?: string[]
  }
  quantity_bases?: string[]
  output_contract?: string[]
  constraints?: Record<string, unknown>
  truth_basis?: typeof TRUTH_BASES[number]
  evidence_policy?: {
    minimum_grade?: string
    allow_model_inferred?: boolean
    allow_assumptions?: boolean
    partial_result_allowed?: boolean
  }
  assembly_policy?: string
  original_text?: string
}

interface CadLookupInput {
  drawing_path: string
  class?: string
  bounds?: [number, number, number, number]
  representation?: string
  text?: string
  limit?: number
}

const DrawingPath = Type.String({
  minLength: 1,
  maxLength: 4_096,
  description: 'Project-relative DWG/DXF path returned by cad_extract.',
})

const CadFactsParameters = Type.Object({
  action: Type.Union([Type.Literal('status'), Type.Literal('build')]),
  drawing_path: Type.Optional(DrawingPath),
}, { additionalProperties: false })

const Target = Type.Union([
  Type.String({ minLength: 1, maxLength: 512 }),
  Type.Object({
    semantic_class: Type.String({ minLength: 1, maxLength: 512 }),
    selectors: Type.Optional(Type.Record(Type.String({ maxLength: 256 }), Type.Unknown())),
  }, { additionalProperties: false }),
])

const Scope = Type.Object({
  type: Type.Optional(Type.Union(SCOPE_TYPES.map((value) => Type.Literal(value)))),
  files: Type.Optional(Type.Array(Type.String({ maxLength: 4_096 }), { maxItems: 100 })),
  sheets: Type.Optional(Type.Array(Type.String({ maxLength: 512 }), { maxItems: 100 })),
  views: Type.Optional(Type.Array(Type.String({ maxLength: 512 }), { maxItems: 100 })),
  regions: Type.Optional(Type.Array(Type.Array(Type.Number(), { minItems: 4, maxItems: 4 }), { maxItems: 100 })),
  systems: Type.Optional(Type.Array(Type.String({ maxLength: 512 }), { maxItems: 100 })),
  storeys: Type.Optional(Type.Array(Type.String({ maxLength: 512 }), { maxItems: 100 })),
  object_refs: Type.Optional(Type.Array(Type.String({ maxLength: 512 }), { maxItems: 500 })),
}, { additionalProperties: false })

const EvidencePolicy = Type.Object({
  minimum_grade: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  allow_model_inferred: Type.Optional(Type.Boolean()),
  allow_assumptions: Type.Optional(Type.Boolean()),
  partial_result_allowed: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

const CadAskParameters = Type.Object({
  task_type: Type.Union(TASK_TYPES.map((value) => Type.Literal(value))),
  target: Target,
  scope: Type.Optional(Scope),
  quantity_bases: Type.Optional(Type.Array(Type.Union([
    Type.Literal('drawing_occurrence'),
    Type.Literal('unique_tag'),
    Type.Literal('bom_declared'),
    Type.Literal('physical_instance'),
  ]), { minItems: 1, maxItems: 4 })),
  output_contract: Type.Optional(Type.Array(Type.Union([
    Type.Literal('answer'),
    Type.Literal('structured_table'),
    Type.Literal('source_highlights'),
    Type.Literal('evidence_trace'),
  ]), { minItems: 1, maxItems: 4 })),
  constraints: Type.Optional(Type.Record(Type.String({ maxLength: 256 }), Type.Unknown())),
  truth_basis: Type.Optional(Type.Union(TRUTH_BASES.map((value) => Type.Literal(value)))),
  evidence_policy: Type.Optional(EvidencePolicy),
  assembly_policy: Type.Optional(Type.Union([
    Type.Literal('count_members'),
    Type.Literal('count_groups'),
    Type.Literal('report_both'),
  ])),
  original_text: Type.Optional(Type.String({ maxLength: 8_000 })),
}, { additionalProperties: false })

const CadLookupParameters = Type.Object({
  drawing_path: DrawingPath,
  class: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  bounds: Type.Optional(Type.Array(Type.Number(), {
    minItems: 4,
    maxItems: 4,
    description: '[min_x, min_y, max_x, max_y] in drawing WCS',
  })),
  representation: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
}, { additionalProperties: false })

export function buildCadFactsTools(options: {
  projectRoot: string
  factsBuildService: FactsBuildService
}): AgentTool<any, CadSubagentToolDetails>[] {
  const { projectRoot, factsBuildService } = options
  const cadFacts: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_facts',
    label: 'CAD Four-Layer Facts',
    description: [
      'Inspect verified L1-L4 status, real coverage, MLight conformance differences and capability gaps.',
      'action=build synchronously ensures L1 for an already extracted drawing, then schedules L2-L4 independently in the background.',
      'Run cad_extract first; this tool returns compact status and facts paths, never the full stores.',
    ].join('\n'),
    parameters: CadFactsParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadFactsInput
      const drawing = input.drawing_path
        ? drawingFromProjectPath(projectRoot, input.drawing_path)
        : null
      const drawingKey = drawing ? drawingArtifactPaths(drawing).artifactKey : undefined
      if (input.action === 'status') {
        const status = await factsBuildService.status(projectRoot, drawingKey, signal)
        return cadToolResult('facts.status', toolCallId, status)
      }
      if (!drawing) throw new Error('cad_facts action=build requires drawing_path.')
      const entities = await inspectEntitiesArtifact(projectRoot, drawing, signal)
      if (entities.status !== 'valid') {
        throw new Error(`Entity index is ${entities.status}; run cad_extract before cad_facts action=build.`)
      }
      const status = await factsBuildService.build({
        projectRoot,
        drawing,
        ...(entities.producer?.name === CAD_MLIGHT_ENTITIES_PRODUCER.name
          ? { mlightIndexPath: entities.rawPath }
          : {}),
      })
      return cadToolResult('facts.build', toolCallId, status)
    },
  }

  const cadAsk: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_ask',
    label: 'CAD Structured Task',
    description: [
      'Run a structured count/measure/locate/identify/describe/check/audit/reconcile/trace request over the pinned project binding.',
      'Returns claims, issues, capability_gap records, evidence references and the exported task path.',
      'Never fill a missing quantity or measurement by inference; follow the explicit fallback_suggestions when a capability is absent.',
    ].join('\n'),
    parameters: CadAskParameters,
    execute: async (toolCallId, raw, signal) => {
      const result = await factsBuildService.ask(projectRoot, raw as Record<string, unknown>, signal)
      const gapCount = typeof result.capability_gap_count === 'number'
        ? result.capability_gap_count
        : Array.isArray(result.capability_gap) ? result.capability_gap.length : 0
      return cadToolResult('facts.ask', toolCallId, result, gapCount > 0
        ? [`cad_ask returned ${gapCount} explicit capability gap(s); do not invent the missing facts.`]
        : [])
    },
  }

  const cadLookup: AgentTool<any, CadSubagentToolDetails> = {
    name: 'cad_lookup',
    label: 'CAD Evidence Lookup',
    description: [
      'Query bounded L3 semantic representations and L1 text evidence, or request one representation evidence packet plus same-signature peers.',
      'Use class and/or bounds for semantic lookup, text for indexed text, and representation for packet/similar evidence.',
      'This is the exact evidence-oriented replacement for whole-line JSON substring matching.',
    ].join('\n'),
    parameters: CadLookupParameters,
    execute: async (toolCallId, raw, signal) => {
      const input = raw as CadLookupInput
      if (!input.class && !input.bounds && !input.representation && !input.text) {
        throw new Error('cad_lookup requires class, bounds, representation, or text.')
      }
      const drawing = drawingFromProjectPath(projectRoot, input.drawing_path)
      const drawingKey = drawingArtifactPaths(drawing).artifactKey
      const result = await factsBuildService.lookup({
        projectRoot,
        drawingKey,
        ...(input.class ? { classId: input.class } : {}),
        ...(input.bounds ? { bounds: input.bounds } : {}),
        ...(input.representation ? { representation: input.representation } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(signal ? { signal } : {}),
      })
      return cadToolResult('facts.lookup', toolCallId, result)
    },
  }

  return [cadFacts, cadAsk, cadLookup]
}
