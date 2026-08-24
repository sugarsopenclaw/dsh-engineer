import {
  getLlmReasoningChoices,
  LLM_REASONING_LEVEL_LABELS,
  type LlmReasoningLevel,
  type LlmReasoningMode,
} from '@/shared/local-agent'

interface ReasoningLevelControlProps {
  mode: LlmReasoningMode
  value: LlmReasoningLevel
  disabled?: boolean
  helperText?: string
  onChange: (level: LlmReasoningLevel) => void
}

function getOptionLabel(level: LlmReasoningLevel, mode: LlmReasoningMode) {
  if (mode === 'toggle' && level !== 'off') {
    return 'On'
  }
  return LLM_REASONING_LEVEL_LABELS[level]
}

export function ReasoningLevelControl({
  mode,
  value,
  disabled = false,
  helperText,
  onChange,
}: ReasoningLevelControlProps) {
  const options = getLlmReasoningChoices({
    mode,
    defaultLevel: 'medium',
  })

  return (
    <div className="grid gap-2">
      <select
        className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as LlmReasoningLevel)}
      >
        {options.map((level) => (
          <option key={level} value={level}>
            {getOptionLabel(level, mode)}
          </option>
        ))}
      </select>
      {helperText ? <p className="text-[11px] leading-5 text-slate-500">{helperText}</p> : null}
    </div>
  )
}
