export function money(value: number, digits = 2) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value || 0)
}

export function price(value: number) {
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: value >= 100 ? 2 : 3, maximumFractionDigits: value >= 100 ? 2 : 3 }).format(value || 0)
}

export function percent(value: number) {
  return `${value > 0 ? '+' : ''}${(value || 0).toFixed(2)}%`
}

export function compact(value: number) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0)
}

export function shortTime(value?: string) {
  if (!value) return '--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function changeClass(value: number) {
  return value > 0 ? 'is-up' : value < 0 ? 'is-down' : 'is-flat'
}

export function sideLabel(side: string) {
  return side === 'BUY' ? '买入' : '卖出'
}
