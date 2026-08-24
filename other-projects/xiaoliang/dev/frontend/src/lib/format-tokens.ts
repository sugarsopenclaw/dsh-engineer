/** 1.2K / 45.6K / 1.0M 风格的 token 计数格式化，圆环与用量小字共用。 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}
