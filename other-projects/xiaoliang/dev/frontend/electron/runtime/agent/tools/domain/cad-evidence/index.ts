import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import { loadCadArtifactImage } from '../cad-subagent'

export interface CadEvidenceImageDetails {
  operation: 'read_evidence_image'
  relative_path: string
}

/**
 * The parent agent may inspect image artifacts cited by a completed evidence pack,
 * but it never receives a general CAD artifact reader or direct CAD runtime access.
 */
export function buildCadEvidenceTools(options: {
  projectRoot: string
  /** Awaited: the allowlist is filled from evidence.md while the parent turn is already running. */
  isAllowedPath: (relativePath: string) => boolean | Promise<boolean>
}): AgentTool<any, CadEvidenceImageDetails>[] {
  const imageTool: AgentTool<any, CadEvidenceImageDetails> = {
    name: 'cad_evidence_image',
    label: 'Inspect CAD Evidence Image',
    description: [
      'Read one project-local CAD image cited by a completed cadsubagent evidence.md.',
      'Pass the exact relative .xiaoliang/cad path from the evidence pack.',
      'Use image observations only for visual facts; exact engineering values must come from entity/file evidence.',
    ].join('\n'),
    parameters: Type.Object({
      path: Type.String({
        minLength: 1,
        maxLength: 4_096,
        description: 'Exact project-relative image path cited by evidence.md.',
      }),
    }, { additionalProperties: false }),
    execute: async (_toolCallId, raw, signal) => {
      const path = typeof (raw as { path?: unknown }).path === 'string'
        ? (raw as { path: string }).path.trim().replace(/\\/gu, '/')
        : ''
      if (!(await options.isAllowedPath(path))) {
        throw new Error('CAD evidence image must be explicitly cited by an evidence.md read in this conversation.')
      }
      const image = await loadCadArtifactImage(options.projectRoot, path, signal)
      return {
        content: [
          { type: 'text', text: `CAD evidence image: ${path}` },
          image,
        ],
        details: {
          operation: 'read_evidence_image',
          relative_path: path,
        },
      }
    },
  }

  return [imageTool]
}
