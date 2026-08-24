import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { getErrorMessage } from '@/api/client'
import { loginWithEmailCode, sendEmailLoginCode } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { electronBridge, isElectronApp } from '@/services/electron-bridge'
import { useAuthStore } from '@/stores/auth-store'

const DEFAULT_COOLDOWN_SEC = 60

export function BackendAuthPanel() {
  const setSession = useAuthStore((state) => state.setSession)

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  async function handleSendCode() {
    const trimmed = email.trim()
    if (!trimmed) {
      setErrorMessage('请填写邮箱。')
      return
    }

    setSending(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const result = isElectronApp()
        ? await electronBridge.sendBackendEmailCode({ email: trimmed })
        : await sendEmailLoginCode({ email: trimmed })

      const next = Math.max(1, Math.floor(result?.cooldown_seconds ?? DEFAULT_COOLDOWN_SEC))
      setCooldown(next)
      setSuccessMessage('验证码已发送，请查收邮件。')
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedEmail = email.trim()
    const trimmedCode = code.trim()
    if (!trimmedEmail || !trimmedCode) {
      setErrorMessage('请填写邮箱与验证码。')
      return
    }

    setSubmitting(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const sessionData = isElectronApp()
        ? await electronBridge.loginBackendWithEmailCode({
            email: trimmedEmail,
            code: trimmedCode,
          })
        : await loginWithEmailCode({
            email: trimmedEmail,
            code: trimmedCode,
          })

      setSession(sessionData)
      setSuccessMessage('登录成功。')
      setCode('')
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.1)] backdrop-blur">
      <h1 className="text-lg font-semibold tracking-tight text-slate-950">登录</h1>
      <p className="mt-1 text-sm text-slate-500">使用邮箱验证码登录</p>

      <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
        <label className="grid gap-1.5 text-sm text-slate-700">
          邮箱
          <input
            type="email"
            autoComplete="email"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid min-w-0 flex-1 gap-1.5 text-sm text-slate-700">
            验证码
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="邮件中的验证码"
              required
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            className="h-[42px] shrink-0 rounded-xl px-4 sm:mb-0"
            disabled={sending || cooldown > 0}
            onClick={() => void handleSendCode()}
          >
            {sending ? '发送中…' : cooldown > 0 ? `${cooldown}s` : '获取验证码'}
          </Button>
        </div>

        <Button type="submit" className="mt-1 h-11 rounded-xl" disabled={submitting}>
          <ArrowRight className="mr-2 h-4 w-4" />
          {submitting ? '登录中…' : '进入应用'}
        </Button>
      </form>

      <div className="mt-3 grid gap-1 text-xs">
        {successMessage ? <p className="text-emerald-600">{successMessage}</p> : null}
        {errorMessage ? <p className="text-rose-600">{errorMessage}</p> : null}
      </div>
    </section>
  )
}
