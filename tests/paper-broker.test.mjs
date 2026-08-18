import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PaperBroker } from '../server/core/paper-broker.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stock-workbench-paper-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { broker: new PaperBroker(join(dir, 'paper.json')), file: join(dir, 'paper.json') }
}

test('模拟账户从一万元开始并完成买入成交', async (t) => {
  const { broker } = await fixture(t)
  const initial = await broker.portfolio([])
  assert.equal(initial.cash, 10_000)
  assert.equal(initial.positions.length, 0)

  const order = await broker.execute({
    symbol: '510300.SH',
    name: '沪深300ETF',
    side: 'BUY',
    price: 4.8,
    quantity: 200,
    mode: 'paper',
  })
  const portfolio = await broker.portfolio([{ symbol: '510300.SH', price: 4.9 }])

  assert.equal(order.status, 'filled')
  assert.equal(portfolio.positions[0].quantity, 200)
  assert.equal(portfolio.positions[0].availableQuantity, 0)
  assert.equal(portfolio.cash, 9_034.99)
  assert.equal(portfolio.positions[0].marketPrice, 4.9)
})

test('跨日旧持仓在当日加仓后仍保持旧份额可卖', async (t) => {
  const { broker, file } = await fixture(t)
  await broker.save({
    version: 1,
    initialCash: 10_000,
    cash: 9_000,
    positions: [{
      symbol: '510300.SH',
      name: '沪深300ETF',
      quantity: 100,
      availableQuantity: 0,
      avgCost: 5,
      lastPrice: 5,
      boughtOn: '2000-01-01',
    }],
    orders: [],
  })

  await broker.execute({
    symbol: '510300.SH',
    name: '沪深300ETF',
    side: 'BUY',
    price: 5,
    quantity: 100,
    mode: 'paper',
  })
  let state = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(state.positions[0].quantity, 200)
  assert.equal(state.positions[0].availableQuantity, 100)

  await broker.execute({
    symbol: '510300.SH',
    name: '沪深300ETF',
    side: 'SELL',
    price: 5,
    quantity: 100,
    mode: 'paper',
  })
  state = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(state.positions[0].quantity, 100)
  assert.equal(state.positions[0].availableQuantity, 0)
})

test('模拟账户拒绝超出现金和可卖数量的成交', async (t) => {
  const { broker } = await fixture(t)
  await assert.rejects(() => broker.execute({
    symbol: '600519.SH',
    name: '贵州茅台',
    side: 'BUY',
    price: 1_500,
    quantity: 100,
    mode: 'paper',
  }), /可用资金不足/)

  await assert.rejects(() => broker.execute({
    symbol: '510300.SH',
    name: '沪深300ETF',
    side: 'SELL',
    price: 5,
    quantity: 100,
    mode: 'paper',
  }), /可卖数量不足/)
})
