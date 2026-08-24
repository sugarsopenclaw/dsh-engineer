import { requestApi } from '@/api/client'
import type { SkillReleaseCheckData } from '@/shared/backend-api'

export interface CheckSkillReleaseInput {
  releaseChannel?: string
  electronVersion: string
  currentSkillPackVersion: string
  currentSkillPackChecksum: string
}

export function checkSkillRelease(input: CheckSkillReleaseInput) {
  const params = new URLSearchParams({
    release_channel: input.releaseChannel || 'stable',
    electron_version: input.electronVersion,
    current_skill_pack_version: input.currentSkillPackVersion,
    current_skill_pack_checksum: input.currentSkillPackChecksum,
  })
  return requestApi<SkillReleaseCheckData>(`/skills/releases/check?${params.toString()}`, {
    auth: false,
  })
}
