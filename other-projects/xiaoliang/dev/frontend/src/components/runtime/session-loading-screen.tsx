export function SessionLoadingScreen() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_top,rgba(15,23,42,0.06),transparent_32%),linear-gradient(180deg,#f8fafc_0%,#fffaf5_100%)] px-5">
      <div className="w-full max-w-sm rounded-2xl border border-white/80 bg-white/90 px-6 py-8 text-center shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-slate-900" />
        <p className="mt-4 text-sm font-medium text-slate-900">正在恢复登录</p>
      </div>
    </div>
  )
}
