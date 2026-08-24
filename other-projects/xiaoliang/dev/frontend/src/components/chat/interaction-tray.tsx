import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UI,
  useA2UIError,
  type A2UIClientEventMessage,
} from '@copilotkit/a2ui-renderer'
import { AlertCircle, Loader2 } from 'lucide-react'
import type {
  AgentInteractionResponseInput,
  AgentPendingInteraction,
} from '@/shared/local-agent'

type InteractionResponse = Omit<AgentInteractionResponseInput, 'conversationId'>

interface InteractionTrayProps {
  interaction: AgentPendingInteraction
  submitting: boolean
  error: string | null
  onRespond: (response: InteractionResponse) => void | Promise<void>
}

function InteractionSurface({
  interaction,
}: {
  interaction: AgentPendingInteraction
}) {
  const { processMessages, clearSurfaces } = useA2UI()
  const rendererError = useA2UIError()

  useEffect(() => {
    processMessages(interaction.a2uiMessages)
    return () => clearSurfaces()
  }, [clearSurfaces, interaction.a2uiMessages, processMessages])

  return (
    <>
      <A2UIRenderer
        surfaceId={interaction.surfaceId}
        className="interaction-tray__surface w-full"
        fallback={<div className="py-2 text-xs text-slate-500">正在准备确认卡…</div>}
        loadingFallback={<div className="py-2 text-xs text-slate-500">正在加载确认卡…</div>}
      />
      {rendererError ? (
        <p role="alert" className="pt-2 text-xs text-rose-700">
          确认卡渲染失败：{rendererError}
        </p>
      ) : null}
    </>
  )
}

export function InteractionTray({
  interaction,
  submitting,
  error,
  onRespond,
}: InteractionTrayProps) {
  const [protocolError, setProtocolError] = useState<string | null>(null)
  const handleAction = useCallback((message: A2UIClientEventMessage) => {
    if (submitting) return
    const action = message.userAction
    const context = action?.context ?? {}
    const interactionId = typeof context.interactionId === 'string'
      ? context.interactionId
      : ''
    const responseToken = typeof context.responseToken === 'string'
      ? context.responseToken
      : ''
    if (
      !action
      || action.surfaceId !== interaction.surfaceId
      || interactionId !== interaction.id
      || !responseToken
    ) {
      setProtocolError('确认卡响应无效，请重新打开当前对话后再试。')
      return
    }

    const data = Object.fromEntries(
      Object.entries(context).filter(([key]) => (
        key !== 'interactionId' && key !== 'responseToken'
      )),
    )
    setProtocolError(null)
    void onRespond({
      interactionId,
      responseToken,
      actionId: action.name,
      ...(Object.keys(data).length > 0 ? { data } : {}),
    })
  }, [interaction.id, interaction.surfaceId, onRespond, submitting])

  const frameClass = interaction.risk === 'high'
    ? 'border-rose-200/90 bg-rose-50/35'
    : 'border-violet-200/80 bg-white/95'
  const themeStyle = {
    '--a2ui-primary-color': interaction.risk === 'high' ? '#e11d48' : '#7c3aed',
  } as CSSProperties

  return (
    <section
      role="region"
      aria-label={interaction.title}
      aria-live="polite"
      aria-busy={submitting}
      data-interaction-kind={interaction.kind}
      data-interaction-risk={interaction.risk}
      className={`interaction-tray mx-auto mb-2 max-h-[min(38vh,320px)] w-[calc(100%_-_1.5rem)] max-w-[640px] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border px-3 py-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.08)] ${frameClass}`}
      style={themeStyle}
    >
      <A2UIProvider key={interaction.id} onAction={handleAction}>
        <div
          className={submitting ? 'pointer-events-none opacity-70' : undefined}
          inert={submitting ? true : undefined}
        >
          <InteractionSurface interaction={interaction} />
        </div>
      </A2UIProvider>

      {submitting ? (
        <div className="mt-2 flex items-center gap-2 border-t border-slate-200/70 pt-2 text-xs text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          正在提交您的选择…
        </div>
      ) : null}
      {protocolError || error ? (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 border-t border-rose-200/80 pt-2 text-xs text-rose-800"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{protocolError || error}</span>
        </div>
      ) : null}
    </section>
  )
}
