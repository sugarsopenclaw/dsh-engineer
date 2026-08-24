import { BackendAuthPanel } from '@/components/runtime/backend-auth-panel'

export function LoginShell() {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-[radial-gradient(circle_at_50%_20%,rgba(15,23,42,0.06),transparent_42%),linear-gradient(180deg,#f8fafc_0%,#fffaf5_100%)] px-4 py-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/4 h-64 w-64 -translate-x-1/2 rounded-full bg-[rgba(14,165,233,0.08)] blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <BackendAuthPanel />
      </div>
    </div>
  )
}
