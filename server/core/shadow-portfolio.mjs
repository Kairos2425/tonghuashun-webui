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
      return { ...DEFAULT_STATE, ...value }
    } catch (error) {
      if (error?.code === 'ENOENT') return { ...DEFAULT_STATE, universe: [...DEFAULT_STATE.universe], history: [] }
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
      const entry = { ...snapshot, capturedAt: new Date().toISOString() }
      const history = [entry, ...current.history.filter((item) => item.date !== entry.date)].slice(0, 120)
      const next = { ...current, lastSnapshot: entry, history, updatedAt: new Date().toISOString() }
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

export function validateUniverse(input) {
  const symbols = [...new Set((Array.isArray(input) ? input : []).map(normalizeSymbol).filter(Boolean))]
  if (symbols.length < 4 || symbols.length > 10) throw withStatus('影子研究池需要 4–10 个不同的场内 ETF', 400)
  for (const symbol of symbols) {
    const instrument = getInstrument(symbol)
    if (!instrument?.tradable || !String(instrument.kind).includes('ETF')) throw withStatus(`${symbol} 不是工作台支持的场内 ETF`, 400)
  }
  return symbols
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
