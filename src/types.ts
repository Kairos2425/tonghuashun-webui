export type Section = 'dashboard' | 'research' | 'trade' | 'account' | 'connections'
export type Side = 'BUY' | 'SELL'

export interface Instrument {
  symbol: string
  name: string
  kind: string
  exchange: string
  risk: string
  priceTick?: number
  lotSize?: number
  tradable?: boolean
}

export interface Quote extends Instrument {
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  change: number
  changePct: number
  volume: number
  turnoverWan: number
  quoteTime: string
}

export interface IndexQuote {
  symbol: string
  name: string
  price: number
  change: number
  changePct: number
  quoteTime: string
}

export interface MarketResponse {
  ok: boolean
  source: string
  sourceKind: 'public_reference' | 'demo'
  delayed: boolean
  fetchedAt: string
  warning?: string
  instruments: Instrument[]
  quotes: Quote[]
  indices: IndexQuote[]
}

export interface Candle {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

export interface CandleResponse {
  ok: boolean
  symbol: string
  source: string
  adjusted: string
  fetchedAt: string
  warning?: string
  candles: Candle[]
}

export interface Position {
  symbol: string
  name: string
  quantity: number
  availableQuantity: number
  avgCost: number
  marketPrice: number
  marketValue: number
  pnl: number
  pnlPct: number
}

export interface OrderRecord {
  id: string
  broker: string
  status: string
  symbol: string
  name: string
  side: Side
  price: number
  quantity: number
  amount: number
  submittedAt: string
  brokerOrderId?: string | null
  fillPrice?: number | null
  fillQuantity?: number
}

export interface Portfolio {
  initialCash: number
  cash: number
  marketValue: number
  totalAssets: number
  totalPnl: number
  totalPnlPct: number
  positions: Position[]
  orders: OrderRecord[]
  updatedAt: string
}

export interface Connector {
  id: string
  name: string
  kind: 'paper' | 'manual_live' | 'live_api'
  status: 'ready' | 'needs_client' | 'configured' | 'needs_permission'
  canSubmit: boolean
  description: string
  clientPath?: string | null
  downloadUrl?: string
  permissionUrl?: string
}

export interface HealthResponse {
  ok: boolean
  version: string
  localOnly: boolean
  liveEnabled: boolean
  riskConfig: RiskConfig
  market: { source: string; sourceKind: string; fetchedAt: string; warning?: string | null }
  deepseek: { configured: boolean; source: string; protected: boolean }
  harness: { installed: boolean; running: boolean; url: string }
  connectors: Connector[]
}

export interface RiskConfig {
  maxOrderValue: number
  maxDailyValue: number
  maxPositionRatio: number
  maxPriceDeviationPct: number
}

export interface RiskCheck {
  code: string
  level: 'pass' | 'warn' | 'block'
  message: string
}

export interface OrderPreview {
  id: string
  expiresAt: number
  confirmationText: string
  ok: boolean
  order: {
    symbol: string
    name: string
    side: Side
    price: number
    quantity: number
    mode: 'paper' | 'manual_live' | 'live'
    broker: string
  }
  amount: number
  fees: { commission: number; transfer: number; stampDuty: number; total: number }
  checks: RiskCheck[]
}

export interface AiResult {
  summary?: string
  whatChanged?: string[]
  bullCase?: string[]
  bearCase?: string[]
  risks?: string[]
  nextChecks?: string[]
  plan?: {
    action?: string
    trigger?: string
    invalidates?: string
    maxLossNote?: string
  }
}

export interface AiAnalysis {
  model: string
  generatedAt: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
  result: AiResult
}
