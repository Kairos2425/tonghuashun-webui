import type { AiAnalysis, CandleResponse, HealthResponse, LiveAccountPosition, LiveAccountSnapshot, MarketResponse, OrderPreview, OrderRecord, Portfolio, QuantAutomation, QuantAutomationEvaluation, QuantBacktestResult, Quote, RelativeValueResult } from './types'

interface ErrorPayload {
  error?: string
  downloadUrl?: string
}

export class ApiError extends Error {
  status: number
  downloadUrl?: string

  constructor(message: string, status: number, downloadUrl?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.downloadUrl = downloadUrl
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isMutation = init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(isMutation ? { 'X-Workbench-Request': '1' } : {}),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => ({})) as T & ErrorPayload
  if (!response.ok) throw new ApiError(payload.error || `请求失败 (${response.status})`, response.status, payload.downloadUrl)
  return payload
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),
  market: (refresh = false) => request<MarketResponse>(`/api/market${refresh ? '?refresh=1' : ''}`),
  quote: (symbol: string) => request<{ ok: true; quote: Quote }>(`/api/market/quote?symbol=${encodeURIComponent(symbol)}`).then((value) => value.quote),
  candles: (symbol: string, limit = 80) => request<CandleResponse>(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&limit=${limit}`),
  portfolio: () => request<{ ok: true; portfolio: Portfolio }>('/api/portfolio').then((value) => value.portfolio),
  resetPortfolio: () => request<{ ok: true; portfolio: Portfolio }>('/api/portfolio/reset', { method: 'POST' }).then((value) => value.portfolio),
  liveAccount: () => request<{ ok: true; account: LiveAccountSnapshot }>('/api/live-account').then((value) => value.account),
  saveLiveAccount: (body: { cash: number; totalAssets: number; positions: LiveAccountPosition[] }) =>
    request<{ ok: true; account: LiveAccountSnapshot }>('/api/live-account', { method: 'PUT', body: JSON.stringify(body) }).then((value) => value.account),
  clearLiveAccount: () => request<{ ok: true; account: LiveAccountSnapshot }>('/api/live-account', { method: 'DELETE' }).then((value) => value.account),
  previewOrder: (body: { symbol: string; side: string; price: number; quantity: number; broker: string }) =>
    request<{ ok: true; preview: OrderPreview }>('/api/orders/preview', { method: 'POST', body: JSON.stringify(body) }).then((value) => value.preview),
  submitOrder: (previewId: string, confirmationText: string) =>
    request<{ ok: true; order: OrderRecord }>('/api/orders/submit', { method: 'POST', body: JSON.stringify({ previewId, confirmationText }) }).then((value) => value.order),
  manualOrders: () => request<{ ok: true; orders: OrderRecord[] }>('/api/manual-orders').then((value) => value.orders),
  reconcileManualOrder: (id: string, body: { status: string; fillPrice?: number; fillQuantity?: number; brokerOrderId?: string; note?: string }) =>
    request<{ ok: true; order: OrderRecord }>(`/api/manual-orders/${encodeURIComponent(id)}/reconcile`, { method: 'POST', body: JSON.stringify(body) }).then((value) => value.order),
  launchGtja: () => request<{ ok: true; launched: boolean; path: string }>('/api/connectors/gtja-manual/launch', { method: 'POST' }),
  saveDeepSeekKey: (apiKey: string) => request<{ ok: true; configured: boolean; source: string; protected: boolean }>('/api/settings/deepseek', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  clearDeepSeekKey: () => request<{ ok: true; configured: boolean; source: string; protected: boolean }>('/api/settings/deepseek', { method: 'DELETE' }),
  analyze: (symbol: string, question: string) => request<{ ok: true; analysis: AiAnalysis }>('/api/ai/analyze', { method: 'POST', body: JSON.stringify({ symbol, question }) }).then((value) => value.analysis),
  quantBacktest: (body: { symbol: string; buyThreshold: number; sellThreshold: number; maxOrderValue: number; slippageBps: number }) =>
    request<{ ok: true; symbol: string; source: string; fetchedAt: string; result: QuantBacktestResult }>('/api/quant/backtest', { method: 'POST', body: JSON.stringify(body) }),
  relativeValue: (left: string, right: string, window = 60, threshold = 2) =>
    request<{ ok: true; left: string; right: string; source: string; result: RelativeValueResult }>(`/api/quant/relative-value?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}&window=${window}&threshold=${threshold}`),
  quantAutomation: () => request<{ ok: true; automation: QuantAutomation; liveAutomationLocked: boolean }>('/api/quant/automation'),
  saveQuantAutomation: (body: { enabled: boolean; mode: 'paper'; symbol: string; buyThreshold: number; sellThreshold: number; maxOrderValue: number; evaluationIntervalMinutes: number }) =>
    request<{ ok: true; automation: QuantAutomation; liveAutomationLocked: boolean }>('/api/quant/automation', { method: 'PUT', body: JSON.stringify(body) }),
  runQuantAutomation: () => request<{ ok: true; evaluation: QuantAutomationEvaluation }>('/api/quant/automation/run', { method: 'POST' }).then((value) => value.evaluation),
}
