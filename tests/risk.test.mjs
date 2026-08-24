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

test('主板、科创板和北交所使用各自的数量递增规则', () => {
  const mainBlocked = validateOrder({ ...paperBuy, symbol: '600000.SH', price: 3, quantity: 150 }, {
    quotePrice: 3,
    quantityRule: { buyMin: 100, buyStep: 100, sellMin: 100, sellStep: 100, oddLotThreshold: 100 },
    availableCash: 10_000,
  })
  assert.equal(mainBlocked.checks.some((check) => check.code === 'lot' && check.level === 'block'), true)

  const starValid = validateOrder({ ...paperBuy, symbol: '688001.SH', price: 3, quantity: 201 }, {
    quotePrice: 3,
    quantityRule: { buyMin: 200, buyStep: 1, sellMin: 200, sellStep: 1, oddLotThreshold: 200 },
    availableCash: 10_000,
  })
  assert.equal(starValid.checks.some((check) => check.code === 'lot' && check.level === 'pass'), true)

  const beijingValid = validateOrder({ ...paperBuy, symbol: '920001.BJ', price: 3, quantity: 101 }, {
    quotePrice: 3,
    quantityRule: { buyMin: 100, buyStep: 1, sellMin: 100, sellStep: 1, oddLotThreshold: 100 },
    availableCash: 10_000,
  })
  assert.equal(beijingValid.checks.some((check) => check.code === 'lot' && check.level === 'pass'), true)
})

test('卖出零股必须包含全部零股余量', () => {
  const rule = { buyMin: 100, buyStep: 100, sellMin: 100, sellStep: 100, oddLotThreshold: 100 }
  const valid = validateOrder({ ...paperBuy, side: 'SELL', quantity: 199 }, { quotePrice: 4.8, quantityRule: rule, availableQuantity: 299 })
  assert.equal(valid.checks.some((check) => check.code === 'odd_lot' && check.level === 'pass'), true)

  const invalid = validateOrder({ ...paperBuy, side: 'SELL', quantity: 198 }, { quotePrice: 4.8, quantityRule: rule, availableQuantity: 299 })
  assert.equal(invalid.checks.some((check) => check.code === 'odd_lot' && check.level === 'block'), true)
})

test('人工账户镜像只能提供保守校验，不能伪装成券商实时查询', () => {
  const enough = validateOrder({ ...paperBuy, mode: 'manual_live', broker: 'gtja-manual' }, {
    quotePrice: 4.8,
    availableCash: 2_000,
    totalAssets: 10_000,
    currentPositionValue: 0,
    accountSource: 'manual_gtja',
    accountSnapshotConfigured: true,
    accountSnapshotFresh: true,
  })
  assert.equal(enough.checks.some((check) => check.code === 'cash_snapshot' && check.level === 'warn'), true)
  assert.equal(enough.checks.some((check) => check.code === 'cash' && check.level === 'pass'), false)

  const insufficient = validateOrder({ ...paperBuy, mode: 'manual_live', broker: 'gtja-manual' }, {
    quotePrice: 4.8,
    availableCash: 900,
    accountSource: 'manual_gtja',
    accountSnapshotConfigured: true,
    accountSnapshotFresh: true,
  })
  assert.equal(insufficient.checks.some((check) => check.code === 'cash' && check.level === 'block'), true)

  const stale = validateOrder({ ...paperBuy, mode: 'manual_live', broker: 'gtja-manual' }, {
    quotePrice: 4.8,
    accountSnapshotConfigured: true,
    accountSnapshotFresh: false,
  })
  assert.equal(stale.checks.some((check) => check.code === 'account_snapshot_stale' && check.level === 'warn'), true)
})
