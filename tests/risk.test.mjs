import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrderPreview, estimateFees, validateOrder } from '../server/core/risk.mjs'

const paperBuy = {
  symbol: '510300.SH',
  name: '沪深300ETF',
  side: 'BUY',
  price: 4.8,
  quantity: 200,
  mode: 'paper',
  broker: 'paper',
}

test('模拟买入在额度、资金和价格范围内时通过', () => {
  const result = validateOrder(paperBuy, {
    quotePrice: 4.79,
    availableCash: 10_000,
    dailyValue: 0,
    totalAssets: 10_000,
    currentPositionValue: 0,
  })

  assert.equal(result.ok, true)
  assert.equal(result.amount, 960)
  assert.equal(result.fees.total, 5.01)
  assert.equal(result.checks.some((check) => check.code === 'paper_mode' && check.level === 'pass'), true)
})

test('人工实盘未知余额和资产时只能警告，不能伪装成校验通过', () => {
  const result = validateOrder({ ...paperBuy, mode: 'manual_live', broker: 'gtja-manual' }, {
    quotePrice: 4.8,
    dailyValue: 0,
  })

  assert.equal(result.ok, true)
  assert.equal(result.checks.some((check) => check.code === 'cash_unknown' && check.level === 'warn'), true)
  assert.equal(result.checks.some((check) => check.code === 'concentration_unknown' && check.level === 'warn'), true)
  assert.equal(result.checks.some((check) => check.code === 'cash' && check.level === 'pass'), false)
})

test('人工实盘卖出未知持仓时要求到君弘核对 T+1', () => {
  const result = validateOrder({
    ...paperBuy,
    side: 'SELL',
    mode: 'manual_live',
    broker: 'gtja-manual',
  }, { quotePrice: 4.8, dailyValue: 0 })

  assert.equal(result.ok, true)
  assert.equal(result.checks.some((check) => check.code === 'position_unknown' && check.level === 'warn'), true)
})

test('单笔、每日、整手和硬价格偏离均能阻断', () => {
  const amountBlocked = validateOrder({ ...paperBuy, quantity: 300 }, {
    quotePrice: 4.8,
    availableCash: 10_000,
    dailyValue: 2_500,
    totalAssets: 10_000,
    currentPositionValue: 0,
  })
  assert.equal(amountBlocked.ok, false)
  assert.equal(amountBlocked.checks.some((check) => check.code === 'order_value' && check.level === 'block'), true)
  assert.equal(amountBlocked.checks.some((check) => check.code === 'daily_value' && check.level === 'block'), true)

  const lotBlocked = validateOrder({ ...paperBuy, quantity: 150 }, { quotePrice: 4.8 })
  assert.equal(lotBlocked.checks.some((check) => check.code === 'lot' && check.level === 'block'), true)

  const deviationBlocked = validateOrder({ ...paperBuy, price: 5.2, quantity: 100 }, { quotePrice: 4.8 })
  assert.equal(deviationBlocked.checks.some((check) => check.code === 'price_deviation' && check.level === 'block'), true)
})

test('接口实盘在总开关和券商桥接未就绪时双重锁定', () => {
  const result = validateOrder({ ...paperBuy, mode: 'live', broker: 'gtja-api' }, {
    quotePrice: 4.8,
    liveEnabled: false,
    brokerConnected: false,
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks.some((check) => check.code === 'live_lock'), true)
  assert.equal(result.checks.some((check) => check.code === 'broker'), true)
})

test('接口实盘没有真实参考价时阻断', () => {
  const result = validateOrder({ ...paperBuy, mode: 'live', broker: 'gtja-api' }, {
    liveEnabled: true,
    brokerConnected: true,
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks.some((check) => check.code === 'quote_missing' && check.level === 'block'), true)
})

test('指数和未知品种只能观察，不能生成订单', () => {
  const result = validateOrder({ ...paperBuy, symbol: '000001.SH' }, {
    quotePrice: 3_500,
    tradable: false,
    availableCash: 10_000,
    dailyValue: 0,
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks.some((check) => check.code === 'instrument_not_tradable'), true)
})

test('股票和 ETF 的最小价格档位会在服务端校验', () => {
  const stockInvalid = validateOrder({ ...paperBuy, symbol: '000001.SZ', price: 11.051, quantity: 100 }, {
    quotePrice: 11.05,
    priceTick: 0.01,
    availableCash: 10_000,
    dailyValue: 0,
  })
  assert.equal(stockInvalid.checks.some((check) => check.code === 'price_tick' && check.level === 'block'), true)

  const etfValid = validateOrder({ ...paperBuy, price: 4.781, quantity: 100 }, {
    quotePrice: 4.78,
    priceTick: 0.001,
    availableCash: 10_000,
    dailyValue: 0,
  })
  assert.equal(etfValid.checks.some((check) => check.code === 'price_tick' && check.level === 'pass'), true)
})

test('预览包含短时效和逐单确认文本', () => {
  const before = Date.now()
  const preview = createOrderPreview(paperBuy, {
    quotePrice: 4.8,
    availableCash: 10_000,
    dailyValue: 0,
    totalAssets: 10_000,
    currentPositionValue: 0,
  })

  assert.match(preview.id, /^[0-9a-f-]{36}$/)
  assert.equal(preview.confirmationText, 'PAPER-510300.SH-200')
  assert.ok(preview.expiresAt >= before + 299_000)
  assert.deepEqual(estimateFees(paperBuy), preview.fees)
})
