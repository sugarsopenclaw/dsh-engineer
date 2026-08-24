import { useCallback, useEffect, useState } from 'react'
import { electronBridge } from '@/services/electron-bridge'
import type { PiRuntimeResourceStatus } from '@/shared/local-agent'

type ResourceLoadMode = 'cache' | 'refresh'
type ResourceSubscriber = (status: PiRuntimeResourceStatus) => void

const resourceCache = new Map<string, PiRuntimeResourceStatus>()
const resourceRequests = new Map<string, {
  mode: ResourceLoadMode
  promise: Promise<PiRuntimeResourceStatus>
}>()
const resourceSubscribers = new Map<string, Set<ResourceSubscriber>>()

function publishResourceStatus(conversationId: string, status: PiRuntimeResourceStatus) {
  resourceCache.set(conversationId, status)
  for (const subscriber of resourceSubscribers.get(conversationId) ?? []) {
    subscriber(status)
  }
}

function subscribeToResourceStatus(
  conversationId: string,
  subscriber: ResourceSubscriber,
) {
  const subscribers = resourceSubscribers.get(conversationId) ?? new Set<ResourceSubscriber>()
  subscribers.add(subscriber)
  resourceSubscribers.set(conversationId, subscribers)
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) resourceSubscribers.delete(conversationId)
  }
}

async function loadResourceStatus(
  conversationId: string,
  mode: ResourceLoadMode,
): Promise<PiRuntimeResourceStatus> {
  if (mode === 'cache') {
    const cached = resourceCache.get(conversationId)
    if (cached) return cached
  }

  const pending = resourceRequests.get(conversationId)
  if (pending) return pending.promise

  const request = electronBridge.getConversationRuntimeResources(conversationId)
  resourceRequests.set(conversationId, { mode, promise: request })
  try {
    const status = await request
    publishResourceStatus(conversationId, status)
    return status
  } finally {
    if (resourceRequests.get(conversationId)?.promise === request) {
      resourceRequests.delete(conversationId)
    }
  }
}

export function useSessionRuntimeResources(
  conversationId: string | null,
  options: { enabled?: boolean; refreshOnEnable?: boolean } = {},
) {
  const enabled = options.enabled === true
  const refreshOnEnable = options.refreshOnEnable === true
  const [resources, setResources] = useState<PiRuntimeResourceStatus | null>(() => (
    conversationId ? resourceCache.get(conversationId) ?? null : null
  ))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setResources(conversationId ? resourceCache.get(conversationId) ?? null : null)
    setError(null)
    if (!conversationId) return
    return subscribeToResourceStatus(conversationId, setResources)
  }, [conversationId])

  useEffect(() => {
    if (!enabled || !conversationId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void loadResourceStatus(
      conversationId,
      refreshOnEnable ? 'refresh' : 'cache',
    )
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, enabled, refreshOnEnable])

  const refresh = useCallback(async () => {
    if (!conversationId) throw new Error('请先选择一个会话。')
    setLoading(true)
    setError(null)
    try {
      return await loadResourceStatus(conversationId, 'refresh')
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError)
      setError(message)
      throw loadError
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  return {
    resources,
    loading,
    error,
    refresh,
  }
}
