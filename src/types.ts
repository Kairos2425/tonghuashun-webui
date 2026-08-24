export type Section = 'dashboard' | 'research' | 'quant' | 'trade' | 'account' | 'connections'
export type Side = 'BUY' | 'SELL'

export interface QuantityRule {
  buyMin: number
  buyStep: number
  sellMin: number
  sellStep: number
  oddLotThreshold: number
}

export interface Instrument {
  symbol: string
  name: string
  kind: string
  exchange: string
  risk: string
  priceTick?: number
  lotSize?: number
  quantityRule?: QuantityRule
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
  note?: string
  reconciliationCount?: number
}

export interface LiveAccountPosition {
  symbol: string
  name: string
  quantity: number
  availableQuantity: number
  avgCost: number
}

export interface LiveAccountSnapshot {
  configured: boolean
  fresh: boolean
  protected: boolean
  source: 'manual_gtja'
  cash: number | null
  totalAssets: number | null
  positions: LiveAccountPosition[]
  updatedAt: string | null
  tradingDate: string | null
  ageMinutes: number | null
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

export type QuantSignal = 'BUY' | 'SELL' | 'HOLD'

export interface QuantBacktestResult {
  model: {
    id: string
    name: string
    purpose: string
    featureNames: string[]
    featureWeights: Array<{ name: string; weight: number }>
    trainingSamples: number
    outOfSampleSamples: number
    targetReturnThreshold: number
    noLookahead: boolean
  }
  config: {
    initialCapital: number
    trainWindow: number
    testRatio: number
    buyThreshold: number
    sellThreshold: number
    targetReturnThreshold: number
    slippageBps: number
    maxOrderValue: number
  }
  current: {
    date: string
    probability: number
    signal: QuantSignal
    confidence: number
    explanation: string
  }
  metrics: {
    initialCapital: number
    finalEquity: number
    totalReturnPct: number
    annualizedReturnPct: number
    buyHoldReturnPct: number
    maxDrawdownPct: number
    sharpe: number
    completedTrades: number
    winRatePct: number
    profitFactor: number | null
    estimatedCosts: number
    currentShares: number
    directionalAccuracy: number
  }
  equityCurve: Array<{ date: string; equity: number; buyHold: number; probability: number; signal: QuantSignal }>
  trades: Array<{ side: Side; date: string; price: number; quantity: number; probability: number; fees: number; pnl?: number; returnPct?: number }>
  warnings: string[]
}

export interface RelativeValueResult {
  date: string
  window: number
  threshold: number
  zScore: number
  divergencePct: number
  signal: 'LEFT_RICH' | 'RIGHT_RICH' | 'NEUTRAL'
  interpretation: string
  series: Array<{ date: string; zScore: number }>
  warnings: string[]
}

export interface QuantAutomationEvaluation {
  at?: string
  status: string
  message?: string
  signalDate?: string | null
  signal?: QuantSignal
  probability?: number
  action?: string
  reason?: string
  orderId?: string | null
}

export interface QuantAutomation {
  version: number
  enabled: boolean
  mode: 'paper'
  strategyId: string
  symbol: string
  buyThreshold: number
  sellThreshold: number
  maxOrderValue: number
  evaluationIntervalMinutes: number
  lastEvaluation: QuantAutomationEvaluation | null
  lastProcessedSignalDate: string | null
  history: QuantAutomationEvaluation[]
  updatedAt: string | null
}

export interface CrossSectionalResult {
  model: {
    id: string
    name: string
    purpose: string
    universeSize: number
    featureNames: string[]
    featureWeights: Array<{ name: string; weight: number }>
    trainingSamples: number
    outOfSampleDates: number
    noLookahead: boolean
  }
  config: {
    initialCapital: number
    trainWindow: number
    testRatio: number
    rebalanceEvery: number
    topK: number
    selectionThreshold: number
    maxWeight: number
    maxOrderValue: number
    slippageBps: number
  }
  current: {
    date: string
    ranking: Array<{ symbol: string; name: string; probability: number; volatility: number; rank: number; selected: boolean }>
    targets: Array<{ symbol: string; name: string; probability: number; weight: number }>
    cashWeight: number
  }
  metrics: {
    initialCapital: number
    finalEquity: number
    totalReturnPct: number
    annualizedReturnPct: number
    benchmarkReturnPct: number
    excessReturnPct: number
    maxDrawdownPct: number
    sharpe: number
    rankHitRatePct: number
    rebalanceCount: number
    turnoverPct: number
    estimatedCosts: number
    currentPositions: number
  }
  equityCurve: Array<{ date: string; equity: number; benchmark: number; positions: number }>
  rebalances: Array<{ signalDate: string; executionDate: string; selected: string[]; actions: Array<{ side: Side; symbol: string; quantity: number; price: number }> }>
  warnings: string[]
}

export interface ShadowSnapshot {
  status: string
  date: string
  capturedAt?: string
  modelId: string
  universe: string[]
  targets: Array<{ symbol: string; name: string; probability: number; weight: number }>
  cashWeight: number
  ranking: CrossSectionalResult['current']['ranking']
  metrics: Pick<CrossSectionalResult['metrics'], 'totalReturnPct' | 'excessReturnPct' | 'maxDrawdownPct' | 'turnoverPct' | 'estimatedCosts'>
}

export interface ShadowPortfolio {
  version: number
  enabled: boolean
  universe: string[]
  lastSnapshot: ShadowSnapshot | null
  history: ShadowSnapshot[]
  updatedAt: string | null
}
