import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { estimateFees, roundMoney } from './risk.mjs'

function initialState() {
  return {
    version: 1,
    initialCash: 10_000,
    cash: 10_000,
    positions: [],
    orders: [],
    updatedAt: new Date().toISOString(),
  }
}

export class PaperBroker {
  constructor(filePath) {
    this.filePath = filePath
    this.pendingMutation = Promise.resolve()
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const state = initialState()
      await this.save(state)
      return state
    }
  }

  async save(state) {
    await mkdir(dirname(this.filePath), { recursive: true })
    const next = { ...state, updatedAt: new Date().toISOString() }
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
    return next
  }

  async portfolio(quotes = []) {
    const state = await this.load()
    const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]))
    const positions = state.positions.map((position) => {
      const quote = quoteMap.get(position.symbol)
      const marketPrice = quote?.price ?? position.lastPrice ?? position.avgCost
      const marketValue = marketPrice * position.quantity
      return {
        ...position,
        marketPrice,
        marketValue: roundMoney(marketValue),
        pnl: roundMoney((marketPrice - position.avgCost) * position.quantity),
        pnlPct: position.avgCost ? roundMoney(((marketPrice / position.avgCost) - 1) * 100) : 0,
      }
    })
    const marketValue = positions.reduce((sum, item) => sum + item.marketValue, 0)
    const totalAssets = roundMoney(state.cash + marketValue)
    return {
      ...state,
      positions,
      marketValue: roundMoney(marketValue),
      totalAssets,
      totalPnl: roundMoney(totalAssets - state.initialCash),
      totalPnlPct: roundMoney(((totalAssets / state.initialCash) - 1) * 100),
    }
  }

  async execute(order) {
    return this.mutate(() => this.executeUnlocked(order))
  }

  async executeUnlocked(order) {
    const state = await this.load()
    state.positions = state.positions.map(rollAvailable)
    const fees = estimateFees(order)
    const amount = roundMoney(order.price * order.quantity)
    const existing = state.positions.find((item) => item.symbol === order.symbol)

    if (order.side === 'BUY') {
      const debit = roundMoney(amount + fees.total)
      if (debit > state.cash) throw new Error('模拟账户可用资金不足')
      state.cash = roundMoney(state.cash - debit)
      if (existing) {
        const previousCost = existing.avgCost * existing.quantity
        existing.quantity += order.quantity
        existing.avgCost = roundMoney((previousCost + amount + fees.total) / existing.quantity)
        existing.lastPrice = order.price
        existing.boughtOn = today()
      } else {
        state.positions.push({
          symbol: order.symbol,
          name: order.name,
          quantity: order.quantity,
          availableQuantity: 0,
          avgCost: roundMoney((amount + fees.total) / order.quantity),
          lastPrice: order.price,
          boughtOn: today(),
        })
      }
    } else {
      if (!existing || order.quantity > rollAvailable(existing).availableQuantity) throw new Error('模拟账户可卖数量不足')
      const credit = roundMoney(amount - fees.total)
      state.cash = roundMoney(state.cash + credit)
      existing.quantity -= order.quantity
      existing.availableQuantity -= order.quantity
      existing.lastPrice = order.price
      if (existing.quantity === 0) state.positions = state.positions.filter((item) => item.symbol !== order.symbol)
    }

    state.positions = state.positions.map(rollAvailable)
    const record = {
      id: randomUUID(),
      broker: 'paper',
      status: 'filled',
      ...order,
      amount,
      fees,
      submittedAt: new Date().toISOString(),
      filledAt: new Date().toISOString(),
    }
    state.orders.unshift(record)
    state.orders = state.orders.slice(0, 200)
    await this.save(state)
    return record
  }

  async reset() {
    return this.mutate(() => this.save(initialState()))
  }

  mutate(operation) {
    const result = this.pendingMutation.then(operation, operation)
    this.pendingMutation = result.catch(() => {})
    return result
  }
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

function rollAvailable(position) {
  if (position.boughtOn && position.boughtOn < today()) {
    return { ...position, availableQuantity: position.quantity }
  }
  return { ...position, availableQuantity: Math.min(position.availableQuantity ?? 0, position.quantity) }
}
