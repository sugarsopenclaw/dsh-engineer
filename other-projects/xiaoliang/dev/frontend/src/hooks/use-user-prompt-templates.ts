import { useCallback, useEffect, useState } from 'react'
import { electronBridge } from '@/services/electron-bridge'
import type {
  PromptTemplateView,
  PromptTemplateWriteInput,
} from '@/shared/backend-api'
import { useAuthStore } from '@/stores/auth-store'

interface PromptTemplateCacheEntry {
  templates: PromptTemplateView[]
  loadedAt: number
}

type PromptTemplateSubscriber = (templates: PromptTemplateView[]) => void

const CACHE_MAX_AGE_MS = 30_000
const LIFECYCLE_REFRESH_DEDUPE_MS = 2_000
const templateCache = new Map<string, PromptTemplateCacheEntry>()
const templateRequests = new Map<string, Promise<PromptTemplateView[]>>()
const templateSubscribers = new Map<string, Set<PromptTemplateSubscriber>>()
const lastLifecycleRefreshAt = new Map<string, number>()

function sortTemplates(templates: readonly PromptTemplateView[]) {
  return [...templates].sort((left, right) => {
    const updatedOrder = right.updated_at.localeCompare(left.updated_at)
    return updatedOrder || left.title.localeCompare(right.title, 'zh-CN')
  })
}

function publishTemplates(userId: string, templates: readonly PromptTemplateView[]) {
  const sorted = sortTemplates(templates)
  templateCache.set(userId, {
    templates: sorted,
    loadedAt: Date.now(),
  })
  for (const subscriber of templateSubscribers.get(userId) ?? []) {
    subscriber(sorted)
  }
  return sorted
}

function subscribeToTemplates(userId: string, subscriber: PromptTemplateSubscriber) {
  const subscribers = templateSubscribers.get(userId) ?? new Set<PromptTemplateSubscriber>()
  subscribers.add(subscriber)
  templateSubscribers.set(userId, subscribers)
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) templateSubscribers.delete(userId)
  }
}

async function loadTemplates(userId: string, force = false) {
  const cached = templateCache.get(userId)
  if (!force && cached && Date.now() - cached.loadedAt < CACHE_MAX_AGE_MS) {
    return cached.templates
  }

  const pending = templateRequests.get(userId)
  if (pending) return pending

  const request = electronBridge.listPromptTemplates()
    .then((templates) => publishTemplates(userId, templates))
  templateRequests.set(userId, request)
  try {
    return await request
  } finally {
    if (templateRequests.get(userId) === request) {
      templateRequests.delete(userId)
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useUserPromptTemplates(
  options: { enabled?: boolean; refreshOnEnable?: boolean } = {},
) {
  const userId = useAuthStore((state) => state.session?.user.id ?? null)
  const enabled = options.enabled === true
  const refreshOnEnable = options.refreshOnEnable === true
  const [templates, setTemplates] = useState<PromptTemplateView[]>(() => (
    userId ? templateCache.get(userId)?.templates ?? [] : []
  ))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTemplates(userId ? templateCache.get(userId)?.templates ?? [] : [])
    setError(null)
    if (!userId) return
    return subscribeToTemplates(userId, setTemplates)
  }, [userId])

  const refresh = useCallback(async (force = true) => {
    if (!userId) throw new Error('登录后才能管理提示词模板。')
    setLoading(true)
    setError(null)
    try {
      return await loadTemplates(userId, force)
    } catch (loadError) {
      setError(errorMessage(loadError))
      throw loadError
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!enabled || !userId) return
    let active = true
    setLoading(true)
    setError(null)
    lastLifecycleRefreshAt.set(userId, Date.now())
    void loadTemplates(userId, refreshOnEnable)
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [enabled, refreshOnEnable, userId])

  useEffect(() => {
    if (!enabled || !userId) return
    const activeUserId = userId

    function refreshAfterReturn() {
      const now = Date.now()
      const previous = lastLifecycleRefreshAt.get(activeUserId) ?? 0
      if (now - previous < LIFECYCLE_REFRESH_DEDUPE_MS) return
      lastLifecycleRefreshAt.set(activeUserId, now)
      void refresh(true).catch(() => undefined)
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') refreshAfterReturn()
    }

    window.addEventListener('focus', refreshAfterReturn)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', refreshAfterReturn)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, refresh, userId])

  const createTemplate = useCallback(async (payload: PromptTemplateWriteInput) => {
    if (!userId) throw new Error('登录后才能管理提示词模板。')
    setError(null)
    try {
      const created = await electronBridge.createPromptTemplate(payload)
      const current = templateCache.get(userId)?.templates ?? []
      publishTemplates(userId, [created, ...current.filter((item) => item.id !== created.id)])
      return created
    } catch (createError) {
      setError(errorMessage(createError))
      throw createError
    }
  }, [userId])

  const updateTemplate = useCallback(async (
    templateId: string,
    payload: PromptTemplateWriteInput,
  ) => {
    if (!userId) throw new Error('登录后才能管理提示词模板。')
    setError(null)
    try {
      const updated = await electronBridge.updatePromptTemplate(templateId, payload)
      const current = templateCache.get(userId)?.templates ?? []
      publishTemplates(userId, [updated, ...current.filter((item) => item.id !== updated.id)])
      return updated
    } catch (updateError) {
      setError(errorMessage(updateError))
      throw updateError
    }
  }, [userId])

  const deleteTemplate = useCallback(async (templateId: string) => {
    if (!userId) throw new Error('登录后才能管理提示词模板。')
    setError(null)
    try {
      await electronBridge.deletePromptTemplate(templateId)
      const current = templateCache.get(userId)?.templates ?? []
      publishTemplates(userId, current.filter((item) => item.id !== templateId))
    } catch (deleteError) {
      setError(errorMessage(deleteError))
      throw deleteError
    }
  }, [userId])

  return {
    authenticated: Boolean(userId),
    templates,
    loading,
    error,
    refresh,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    clearError: () => setError(null),
  }
}
