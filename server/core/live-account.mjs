import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getInstrument, normalizeSymbol } from './market.mjs'
import { protectText, unprotectText } from './secrets.mjs'

const MAX_POSITIONS = 100
const MAX_MONEY = 1_000_000_000_000

export class LiveAccountStore {
  constructor(filePath, { protect = protectText, unprotect = unprotectText, now = () => new Date() } = {}) {
    this.filePath = filePath
    this.protect = protect
    this.unprotect = unprotect
    this.now = now
    this.pendingMutation = Promise.resolve()
  }

  async get() {
    try {
      const encrypted = await readFile(this.filePath, 'utf8')
      const payload = JSON.parse(await this.unprotect(encrypted))
      return this.decorate(payload)
    } catch (error) {
      if (error?.code === 'ENOENT') return emptySnapshot()
      throw error
    }
  }

  async set(input) {
    return this.mutate(async () => {
      const snapshot = normalizeSnapshot(input, this.now())
      const encrypted = await this.protect(JSON.stringify(snapshot))
      await mkdir(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${process.pid}.tmp`
      await writeFile(temporary, encrypted, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.filePath)
      return this.decorate(snapshot)
    })
  }

  async clear() {
    return this.mutate(async () => {
      await rm(this.filePath, { force: true })
      return emptySnapshot()
    })
  }

  decorate(snapshot) {
    const current = this.now()
    const updatedAt = new Date(snapshot.updatedAt)
    const validDate = !Number.isNaN(updatedAt.getTime())
    const ageMinutes = validDate ? Math.max(0, Math.round((current.getTime() - updatedAt.getTime()) / 60_000)) : null
    return {
      ...snapshot,
      configured: true,
      fresh: snapshot.tradingDate === tradingDate(current),
      ageMinutes,
      protected: true,
    }
  }

  mutate(operation) {
    const result = this.pendingMutation.then(operation, operation)
    this.pendingMutation = result.catch(() => {})
    return result
  }
}

function normalizeSnapshot(input, now) {
  const cash = money(input?.cash, '可用资金')
  const totalAssets = money(input?.totalAssets, '总资产')
  const rawPositions = Array.isArray(input?.positions) ? input.positions : []
  if (rawPositions.length > MAX_POSITIONS) throw withStatus(`持仓最多录入 ${MAX_POSITIONS} 项`, 400)

  const seen = new Set()
  const positions = rawPositions.map((item, index) => {
    const symbol = normalizeSymbol(item?.symbol)
    if (!symbol) throw withStatus(`第 ${index + 1} 项持仓代码无效`, 400)
    const instrument = getInstrument(symbol)
    if (!instrument?.tradable) throw withStatus(`${symbol} 不是工作台支持的 A 股或场内基金`, 400)
    if (seen.has(symbol)) throw withStatus(`${symbol} 重复录入`, 400)
    seen.add(symbol)

    const quantity = nonNegativeInteger(item?.quantity, `${symbol} 持仓数量`)
    const availableQuantity = nonNegativeInteger(item?.availableQuantity, `${symbol} 可卖数量`)
    if (availableQuantity > quantity) throw withStatus(`${symbol} 可卖数量不能超过持仓数量`, 400)
    const avgCost = money(item?.avgCost, `${symbol} 成本价`)
    const providedName = String(item?.name ?? '').trim().slice(0, 40)
    return {
      symbol,
      name: providedName || (instrument.name === symbol ? symbol : instrument.name),
      quantity,
      availableQuantity,
      avgCost,
    }
  }).filter((item) => item.quantity > 0)

  return {
    version: 1,
    source: 'manual_gtja',
    cash,
    totalAssets,
    positions,
    updatedAt: now.toISOString(),
    tradingDate: tradingDate(now),
  }
}

function emptySnapshot() {
  return {
    configured: false,
    fresh: false,
    protected: true,
    source: 'manual_gtja',
    cash: null,
    totalAssets: null,
    positions: [],
    updatedAt: null,
    tradingDate: null,
    ageMinutes: null,
  }
}

function money(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > MAX_MONEY) throw withStatus(`${label}必须是有效的非负金额`, 400)
  return Math.round((number + Number.EPSILON) * 100) / 100
}

function nonNegativeInteger(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw withStatus(`${label}必须是非负整数`, 400)
  return number
}

function tradingDate(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(value)
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
