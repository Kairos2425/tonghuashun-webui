import { randomUUID } from 'node:crypto'

export const DEFAULT_RISK_CONFIG = Object.freeze({
  maxOrderValue: 1_000,
  maxDailyValue: 3_000,
  maxPositionRatio: 0.3,
  maxPriceDeviationPct: 3,
  hardPriceDeviationPct: 5,
  previewTtlMs: 5 * 60_000,
  commissionRate: 0.0003,
  minimumCommission: 5,
  transferFeeRate: 0.00001,
  stampDutyRate: 0.0005,
})

const SYMBOL_RE = /^\d{6}\.(SH|SZ|BJ)$/

function finiteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function normalizeOrder(input) {
  return {
    symbol: String(input?.symbol ?? '').trim().toUpperCase(),
    name: String(input?.name ?? '').trim().slice(0, 40),
    side: String(input?.side ?? '').trim().toUpperCase(),
    price: finiteNumber(input?.price),
    quantity: finiteNumber(input?.quantity),
    mode: input?.mode === 'live' ? 'live' : input?.mode === 'manual_live' ? 'manual_live' : 'paper',
    broker: String(input?.broker ?? 'paper').trim(),
  }
}

export function estimateFees(order, config = DEFAULT_RISK_CONFIG) {
  const amount = order.price * order.quantity
  const commission = Math.max(config.minimumCommission, amount * config.commissionRate)
  const transfer = amount * config.transferFeeRate
  const stampDuty = order.side === 'SELL' ? amount * config.stampDutyRate : 0
  return {
    commission: roundMoney(commission),
    transfer: roundMoney(transfer),
    stampDuty: roundMoney(stampDuty),
    total: roundMoney(commission + transfer + stampDuty),
  }
}

export function validateOrder(input, context = {}, config = DEFAULT_RISK_CONFIG) {
  const order = normalizeOrder(input)
  const checks = []
  const block = (code, message) => checks.push({ code, level: 'block', message })
  const warn = (code, message) => checks.push({ code, level: 'warn', message })
  const pass = (code, message) => checks.push({ code, level: 'pass', message })

  if (!SYMBOL_RE.test(order.symbol)) block('symbol', '证券代码格式应为 6 位代码加交易所，例如 510300.SH')
  else pass('symbol', '证券代码格式有效')

  if (context.tradable === false) block('instrument_not_tradable', '该代码属于指数或未识别品种，工作台只允许观察，不能生成订单')

  if (!['BUY', 'SELL'].includes(order.side)) block('side', '买卖方向无效')
  else pass('side', order.side === 'BUY' ? '买入委托' : '卖出委托')

  if (!Number.isFinite(order.price) || order.price <= 0) block('price', '限价必须大于 0')
  const priceTick = finiteNumber(context.priceTick)
  if (Number.isFinite(order.price) && order.price > 0 && Number.isFinite(priceTick) && priceTick > 0) {
    const tickUnits = order.price / priceTick
    if (Math.abs(tickUnits - Math.round(tickUnits)) > 1e-7) block('price_tick', `限价必须按 ${priceTick.toFixed(priceTick < 0.01 ? 3 : 2)} 元一档输入`)
    else pass('price_tick', `价格档位 ${priceTick.toFixed(priceTick < 0.01 ? 3 : 2)} 元`)
  }
  const lotSize = Number.isInteger(context.lotSize) && context.lotSize > 0 ? context.lotSize : 100
  if (!Number.isInteger(order.quantity) || order.quantity <= 0) block('quantity', '数量必须是正整数')
  else if (order.side === 'BUY' && order.quantity % lotSize !== 0) block('lot', `买入数量必须是 ${lotSize} 的整数倍`)
  else if (order.side === 'SELL' && order.quantity % lotSize !== 0) {
    const availableQuantity = finiteNumber(context.availableQuantity)
    if (Number.isFinite(availableQuantity) && order.quantity !== availableQuantity) block('odd_lot', '零股卖出需一次性卖出全部可卖余量')
    else warn('odd_lot', '零股卖出规则因品种而异，请在君弘确认必须一次性卖出全部余量')
  } else pass('lot', `${order.quantity / lotSize} 手`)

  const amount = Number.isFinite(order.price * order.quantity) ? order.price * order.quantity : 0
  if (amount > config.maxOrderValue) block('order_value', `单笔金额超过新手保护上限 ¥${config.maxOrderValue.toLocaleString('zh-CN')}`)
  else if (amount > 0) pass('order_value', `委托金额 ¥${amount.toFixed(2)}`)

  const dailyValue = finiteNumber(context.dailyValue)
  if (Number.isFinite(dailyValue) && dailyValue + amount > config.maxDailyValue) {
    block('daily_value', `今日累计委托将超过 ¥${config.maxDailyValue.toLocaleString('zh-CN')} 上限`)
  } else {
    pass('daily_value', '未触及今日金额上限')
  }

  const quotePrice = finiteNumber(context.quotePrice)
  if (Number.isFinite(quotePrice) && quotePrice > 0 && Number.isFinite(order.price)) {
    const deviation = Math.abs(order.price / quotePrice - 1) * 100
    if (deviation > config.hardPriceDeviationPct) block('price_deviation', `限价偏离参考价 ${deviation.toFixed(2)}%，已阻止`)
    else if (deviation > config.maxPriceDeviationPct) warn('price_deviation', `限价偏离参考价 ${deviation.toFixed(2)}%，请在君弘重新核对`)
    else pass('price_deviation', `限价偏离参考价 ${deviation.toFixed(2)}%`)
  } else if (order.mode === 'live') {
    block('quote_missing', '没有真实公开参考价，接口实盘已阻止')
  } else {
    warn('quote_missing', '没有真实公开参考价，必须在君弘委托页重新核价')
  }

  if (order.side === 'BUY') {
    const cash = finiteNumber(context.availableCash)
    const fees = estimateFees(order, config)
    if (!Number.isFinite(cash)) warn('cash_unknown', '工作台未读取君弘余额，请在券商委托页核对可用资金')
    else if (amount + fees.total > cash) block('cash', '可用资金不足（已计入估算费用）')
    else pass('cash', '可用资金校验通过')
  } else if (order.side === 'SELL') {
    const availableQuantity = finiteNumber(context.availableQuantity)
    if (!Number.isFinite(availableQuantity)) warn('position_unknown', '工作台未读取君弘持仓，请在券商委托页核对可卖数量与 T+1')
    else if (order.quantity > availableQuantity) block('position', '可卖数量不足，可能包含当日买入的 T+1 锁定份额')
    else pass('position', '可卖数量校验通过')
  }

  const totalAssets = finiteNumber(context.totalAssets)
  const currentPositionValue = finiteNumber(context.currentPositionValue)
  if (order.side === 'BUY' && totalAssets > 0 && Number.isFinite(currentPositionValue)) {
    const ratio = (currentPositionValue + amount) / totalAssets
    if (ratio > config.maxPositionRatio) warn('concentration', `成交后单一标的约占总资产 ${(ratio * 100).toFixed(1)}%，高于新手参考线 ${(config.maxPositionRatio * 100).toFixed(0)}%`)
    else pass('concentration', `成交后单一标的约占总资产 ${(ratio * 100).toFixed(1)}%`)
  } else if (order.side === 'BUY' && order.mode !== 'paper') {
    warn('concentration_unknown', '工作台未读取君弘总资产，请在券商端复核本单占账户资产比例')
  }

  if (order.mode === 'live' && !context.liveEnabled) block('live_lock', '接口实盘总开关未启用')
  if (order.mode === 'live' && !context.brokerConnected) block('broker', '券商官方 API 尚未连接')
  if (order.mode === 'manual_live') warn('manual_execution', '本单将交给君弘官方客户端，由你本人最终确认')
  if (order.mode === 'paper') pass('paper_mode', '模拟账户，不会触碰真实资金')

  return {
    ok: !checks.some((item) => item.level === 'block'),
    order,
    amount: roundMoney(amount),
    fees: amount > 0 ? estimateFees(order, config) : { commission: 0, transfer: 0, stampDuty: 0, total: 0 },
    checks,
  }
}

export function createOrderPreview(input, context = {}, config = DEFAULT_RISK_CONFIG) {
  const validation = validateOrder(input, context, config)
  const id = randomUUID()
  const expiresAt = Date.now() + config.previewTtlMs
  const confirmationText = validation.order.mode === 'paper'
    ? `PAPER-${validation.order.symbol}-${validation.order.quantity}`
    : `LIVE-${validation.order.symbol}-${validation.order.quantity}`
  return { id, expiresAt, confirmationText, ...validation }
}

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
