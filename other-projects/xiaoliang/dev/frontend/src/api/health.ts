import type { ApiResponse } from '@/types/render'

import { getErrorMessage, requestRaw } from '@/api/client'

export async function fetchHealthPing(): Promise<ApiResponse<{ ok: boolean }>> {
  try {
    const data = await requestRaw<{ ok: boolean }>('/health', {
      auth: false,
      allowRefresh: false,
    })

    return {
      success: true,
      data,
    }
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    }
  }
}
