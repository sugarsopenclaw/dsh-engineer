import { useEffect, useState } from 'react'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import type { ConversationUsageChangedPayload } from '@/shared/billing-domain'

/**
 * 当前会话的权威用量（本轮 + 会话累计）。
 * 主进程在每次托管调用结算后去抖拉取 getRunUsage 并落库推送（billing:runUsageChanged）；
 * 切换会话时先读本地持久化的累计快照，保证重启后立即可见。
 */
export function useConversationUsage(conversationId: string | null) {
  const [usage, setUsage] = useState<ConversationUsageChangedPayload | null>(null)

  useEffect(() => {
    setUsage(null)
    if (!conversationId || !isElectronApp()) return
    let cancelled = false
    let receivedPush = false
    const unsubscribe = electronBridge.onBillingRunUsageChanged((payload) => {
      if (payload.conversationId !== conversationId) return
      receivedPush = true
      setUsage(payload)
    })

    void electronBridge
      .getConversationUsage(conversationId)
      .then((next) => {
        if (!cancelled && !receivedPush && next) setUsage(next)
      })
      .catch(() => {
        // 读取本地快照失败时保持空白，等待下一次推送。
      })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [conversationId])

  return usage
}
