import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getInstrument, normalizeSymbol } from './market.mjs'

export const DEFAULT_ETF_UNIVERSE = Object.freeze([
  { symbol: '510300.SH', name: '沪深300ETF华泰柏瑞', style: '大盘核心' },
  { symbol: '510500.SH', name: '中证500ETF南方', style: '中盘' },
  { symbol: '512100.SH', name: '中证1000ETF南方', style: '小盘' },
  { symbol: '588000.SH', name: '科创50ETF华夏', style: '科创成长' },
  { symbol: '159915.SZ', name: '创业板ETF易方达', style: '创业成长' },
  { symbol: '510880.SH', name: '红利ETF华泰柏瑞', style: '红利价值' },
])

const DEFAULT_STATE = Object.freeze({
  version: 1,
  enabled: false,
  universe: DEFAULT_ETF_UNIVERSE.map((item) => item.symbol),
  lastSnapshot: null,
  history: [],
  performance: emptyPerformance(),
  updatedAt: null,
})

export class ShadowPortfolioStore {
  constructor(filePath) {
    this.filePath = filePath
    this.pendingMutation = Promise.resolve()
  }

  async get() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'))
      const history = Array.isArray(value?.history) ? value.history : []
      return { ...DEFAULT_STATE, ...value, history, performance: summarizePerformance(history) }
    } catch (error) {
      if (error?.code === 'ENOENT') return { ...DEFAULT_STATE, universe: [...DEFAULT_STATE.universe], history: [], performance: emptyPerformance() }
      throw error
    }
  }

  async update(input) {
    return this.mutate(async () => {
      const current = await this.get()
      const universe = validateUniverse(input?.universe ?? current.universe)
      const changed = JSON.stringify(universe) !== JSON.stringify(current.universe)
      const next = {
        ...current,
        enabled: Boolean(input?.enabled),
        universe,
        lastSnapshot: changed ? null : current.lastSnapshot,
        updatedAt: new Date().toISOString(),
      }
      await this.save(next)
      return next
    })
  }

  async record(snapshot) {
    return this.mutate(async () => {
      const current = await this.get()
      const existing = current.history.find((item) => item.date === snapshot.date)
      const entry = { ...snapshot, ...(existing?.outcome && !snapshot.outcome ? { outcome: existing.outcome } : {}), capturedAt: new Date().toISOString() }
      const history = [entry, ...current.history.filter((item) => item.date !== entry.date)].slice(0, 120)
      const next = { ...current, lastSnapshot: entry, history, performance: summarizePerformance(history), updatedAt: new Date().toISOString() }
      await this.save(next)
      return next
    })
  }

  async settle(date, outcome) {
    return this.mutate(async () => {
      const current = await this.get()
      const history = current.history.map((item) => item.date === date ? { ...item, outcome } : item)
      const lastSnapshot = current.lastSnapshot?.date === date ? { ...current.lastSnapshot, outcome } : current.lastSnapshot
      const next = { ...current, lastSnapshot, history, performance: summarizePerformance(history), updatedAt: new Date().toISOString() }
      await this.save(next)
      return next
    })
  }

  async save(value) {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
  }

  mutate(operation) {
    const result = this.pendingMutation.then(operation, operation)
    this.pendingMutation = result.catch(() => {})
    return result
  }
}

function summarizePerformance(history) {
  const settled = history.filter((item) => item?.outcome && Number.isFinite(Number(item.outcome.portfolioReturnPct)))
  if (settled.length === 0) return emptyPerformance()
  const portfolioGrowth = settled.reduce((value, item) => value * (1 + Number(item.outcome.portfolioReturnPct) / 100), 1)
  const benchmarkGrowth = settled.reduce((value, item) => value * (1 + Number(item.outcome.benchmarkReturnPct) / 100), 1)
  const hits = settled.filter((item) => Number(item.outcome.excessReturnPct) > 0).length
  const averageExcess = settled.reduce((sum, item) => sum + Number(item.outcome.excessReturnPct), 0) / settled.length
  const status = settled.length < 20
    ? 'INSUFFICIENT'
    : portfolioGrowth > benchmarkGrowth && hits / settled.length >= 0.5
      ? 'HEALTHY'
      : 'DRIFT_WARNING'
  return {
    settledSnapshots: settled.length,
    cumulativeReturnPct: round((portfolioGrowth - 1) * 100, 2),
    benchmarkReturnPct: round((benchmarkGrowth - 1) * 100, 2),
    cumulativeExcessPct: round((portfolioGrowth - benchmarkGrowth) * 100, 2),
    hitRatePct: round((hits / settled.length) * 100, 2),
    averageExcessPct: round(averageExcess, 3),
    status,
  }
}

function emptyPerformance() {
  return { settledSnapshots: 0, cumulativeReturnPct: 0, benchmarkReturnPct: 0, cumulativeExcessPct: 0, hitRatePct: 0, averageExcessPct: 0, status: 'INSUFFICIENT' }
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function validateUniverse(input) {
  const symbols = [...new Set((Array.isArray(input) ? input : []).map(normalizeSymbol).filter(Boolean))]
  if (symbols.length < 4 || symbols.length > 10) throw withStatus('影子研究池需要 4–10 个不同的场内 ETF', 400)
  for (const symbol of symbols) {
    const instrument = getInstrument(symbol)
    if (!instrument?.tradable || !String(instrument.kind).includes('ETF')) throw withStatus(`${symbol} 不是工作台支持的场内 ETF`, 400)
  }
  return symbols
}

export function calculateShadowOutcome(snapshot, datasets, toDate) {
  const returns = new Map()
  for (const dataset of Array.isArray(datasets) ? datasets : []) {
    const start = dataset?.candles?.find((row) => row.date === snapshot?.date)
    const end = dataset?.candles?.find((row) => row.date === toDate)
    if (!start || !end || Number(start.close) <= 0) return null
    returns.set(dataset.symbol, Number(end.close) / Number(start.close) - 1)
  }
  if (returns.size === 0) return null
  const portfolioReturn = (snapshot?.targets ?? []).reduce((sum, target) => sum + Number(target.weight || 0) * Number(returns.get(target.symbol) || 0), 0)
  const benchmarkReturn = [...returns.values()].reduce((sum, value) => sum + value, 0) / returns.size
  return {
    toDate,
    portfolioReturnPct: round(portfolioReturn * 100, 3),
    benchmarkReturnPct: round(benchmarkReturn * 100, 3),
    excessReturnPct: round((portfolioReturn - benchmarkReturn) * 100, 3),
  }
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
