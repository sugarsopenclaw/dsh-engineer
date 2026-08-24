export function formatPublishedAt(iso: string | undefined): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatMicroRate(microPerToken: number, microPerCredit: number): string {
  if (microPerCredit <= 0) {
    return '—'
  }
  const creditsPerMillion = (microPerToken * 1_000_000) / microPerCredit
  return `${creditsPerMillion.toLocaleString('zh-CN')} Credits / 百万 token`
}
