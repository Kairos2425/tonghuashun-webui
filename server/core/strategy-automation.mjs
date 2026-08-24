import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getInstrument, normalizeSymbol } from './market.mjs'

const DEFAULT_STATE = Object.freeze({
  version: 1,
  enabled: false,
  mode: 'paper',
  strategyId: 'ml-etf-timing-v1',
  symbol: '510300.SH',
  buyThreshold: 0.58,
  sellThreshold: 0.42,
  maxOrderValue: 1_000,
  evaluationIntervalMinutes: 15,
  lastEvaluation: null,
  lastProcessedSignalDate: null,
  history: [],
  updatedAt: null,
})

export class StrategyAutomationStore {
  constructor(filePath) {
    this.filePath = filePath
    this.pendingMutation = Promise.resolve()
  }

  async get() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'))
      return { ...DEFAULT_STATE, ...value, mode: 'paper' }
    } catch (error) {
      if (error?.code === 'ENOENT') return { ...DEFAULT_STATE }
      throw error
    }
  }

  async update(input) {
    return this.mutate(async () => {
      const current = await this.get()
      const candidate = {
        ...current,
        enabled: Boolean(input?.enabled),
        mode: validateMode(input?.mode),
        strategyId: 'ml-etf-timing-v1',
        symbol: validateSymbol(input?.symbol ?? current.symbol),
        buyThreshold: numberInRange(input?.buyThreshold, 0.51, 0.9, current.buyThreshold),
        sellThreshold: numberInRange(input?.sellThreshold, 0.1, 0.49, current.sellThreshold),
        maxOrderValue: numberInRange(input?.maxOrderValue, 100, 1_000, current.maxOrderValue),
        evaluationIntervalMinutes: integerInRange(input?.evaluationIntervalMinutes, 5, 120, current.evaluationIntervalMinutes),
        updatedAt: new Date().toISOString(),
      }
      if (candidate.sellThreshold >= candidate.buyThreshold) throw withStatus('卖出阈值必须低于买入阈值', 400)
      const changed = ['symbol', 'buyThreshold', 'sellThreshold', 'maxOrderValue'].some((key) => candidate[key] !== current[key])
      const next = {
        ...candidate,
        lastEvaluation: changed ? null : current.lastEvaluation,
        lastProcessedSignalDate: changed ? null : current.lastProcessedSignalDate,
      }
      await this.save(next)
      return next
    })
  }

  async record(evaluation, { processed = false } = {}) {
    return this.mutate(async () => {
      const current = await this.get()
      const entry = { ...evaluation, at: new Date().toISOString() }
      const next = {
        ...current,
        lastEvaluation: entry,
        lastProcessedSignalDate: processed ? evaluation.signalDate ?? current.lastProcessedSignalDate : current.lastProcessedSignalDate,
        history: [entry, ...(Array.isArray(current.history) ? current.history : [])].slice(0, 50),
        updatedAt: new Date().toISOString(),
      }
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

function validateMode(value) {
  if (value && value !== 'paper') throw withStatus('当前自动执行仅允许模拟盘；实盘必须等待券商官方 API 权限', 423)
  return 'paper'
}

function validateSymbol(input) {
  const symbol = normalizeSymbol(input)
  const instrument = getInstrument(symbol)
  if (!symbol || !instrument?.tradable || !String(instrument.kind).includes('ETF')) {
    throw withStatus('自动执行第一阶段仅允许场内 ETF', 400)
  }
  return symbol
}

function numberInRange(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

function integerInRange(value, minimum, maximum, fallback) {
  return Math.round(numberInRange(value, minimum, maximum, fallback))
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
