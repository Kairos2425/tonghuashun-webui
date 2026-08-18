import assert from 'node:assert/strict'
import test from 'node:test'
import { getInstrument, getSecurityQuote, normalizeSymbol } from '../server/core/market.mjs'

test('六位代码可推断沪深北交易所，也接受显式后缀', () => {
  assert.equal(normalizeSymbol('600000'), '600000.SH')
  assert.equal(normalizeSymbol('000001'), '000001.SZ')
  assert.equal(normalizeSymbol('920001'), '920001.BJ')
  assert.equal(normalizeSymbol(' 510300.sh '), '510300.SH')
  assert.equal(normalizeSymbol('abc'), null)
})

test('动态证券定义区分 ETF 与股票价格档位', () => {
  const etf = getInstrument('512880')
  const stock = getInstrument('600000')
  const beijing = getInstrument('920001')

  assert.equal(etf.symbol, '512880.SH')
  assert.equal(etf.priceTick, 0.001)
  assert.equal(stock.priceTick, 0.01)
  assert.equal(stock.kind, 'A 股')
  assert.equal(stock.tradable, true)
  assert.equal(beijing.exchange, '北京')
})

test('指数、可转债等非目标品种只允许观察', () => {
  assert.equal(getInstrument('000001.SH').tradable, false)
  assert.equal(getInstrument('399006.SZ').kind, '指数')
  assert.equal(getInstrument('113001.SH').tradable, false)
})

test('演示模式拒绝为自定义代码伪造报价', async () => {
  const previous = process.env.MARKET_DATA_PROVIDER
  process.env.MARKET_DATA_PROVIDER = 'demo'
  try {
    await assert.rejects(() => getSecurityQuote('600000'), /不为自定义证券生成虚假报价/)
  } finally {
    if (previous === undefined) delete process.env.MARKET_DATA_PROVIDER
    else process.env.MARKET_DATA_PROVIDER = previous
  }
})

test('实盘核价明确拒绝演示报价', async () => {
  const previous = process.env.MARKET_DATA_PROVIDER
  process.env.MARKET_DATA_PROVIDER = 'demo'
  try {
    await assert.rejects(() => getSecurityQuote('510300', { allowDemo: false }), /不能作为实盘核价依据/)
  } finally {
    if (previous === undefined) delete process.env.MARKET_DATA_PROVIDER
    else process.env.MARKET_DATA_PROVIDER = previous
  }
})
