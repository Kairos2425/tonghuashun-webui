import { estimateFees, roundMoney } from './risk.mjs'

export const FEATURE_NAMES = Object.freeze([
  '1日收益',
  '5日动量',
  '20日动量',
  'MA5偏离',
  'MA20偏离',
  '10日波动',
  '日内强弱',
  '20日量能Z分数',
  'RSI14',
])

const DEFAULTS = Object.freeze({
  initialCapital: 10_000,
  trainWindow: 180,
  minTrainSamples: 80,
  testRatio: 0.3,
  refitEvery: 5,
  buyThreshold: 0.58,
  sellThreshold: 0.42,
  targetReturnThreshold: 0.001,
  slippageBps: 5,
  maxOrderValue: 1_000,
})

export function runMlBacktest(candles, options = {}) {
  const config = normalizeConfig(options)
  const rows = completedRows(normalizeCandles(candles), options.now)
  if (rows.length < 130) throw withStatus('有效日 K 少于 130 条，无法进行可信的走步回测', 400)

  const samples = buildSamples(rows, config.targetReturnThreshold)
  if (samples.length < config.minTrainSamples + 30) throw withStatus('特征样本不足，至少需要约 130 个交易日', 400)
  const firstTest = Math.max(config.minTrainSamples, Math.floor(samples.length * (1 - config.testRatio)))
  const predictions = []
  let model = null
  for (let cursor = firstTest; cursor < samples.length; cursor += 1) {
    if (!model || (cursor - firstTest) % config.refitEvery === 0) {
      const training = samples.slice(Math.max(0, cursor - config.trainWindow), cursor)
      model = fitLogistic(training)
    }
    const sample = samples[cursor]
    predictions.push({ ...sample, probability: predict(model, sample.features) })
  }

  const simulation = simulateLongOnly(rows, predictions, config, options.quantityRule)
  const latestFeatures = featuresAt(rows, rows.length - 1)
  const finalTraining = samples.slice(Math.max(0, samples.length - config.trainWindow))
  const finalModel = fitLogistic(finalTraining)
  const probability = latestFeatures ? predict(finalModel, latestFeatures) : 0.5
  const signal = signalFor(probability, config)
  const accuracy = predictions.length
    ? predictions.filter((item) => (item.probability >= 0.5) === (item.label === 1)).length / predictions.length
    : 0

  return {
    model: {
      id: 'walk-forward-logistic-v1',
      name: '走步正则化逻辑回归',
      purpose: '预测下一交易日收益是否覆盖最低目标阈值',
      featureNames: FEATURE_NAMES,
      featureWeights: FEATURE_NAMES.map((name, index) => ({ name, weight: round(finalModel.weights[index + 1] ?? 0, 4) })),
      trainingSamples: finalTraining.length,
      outOfSampleSamples: predictions.length,
      targetReturnThreshold: config.targetReturnThreshold,
      noLookahead: true,
    },
    config,
    current: {
      date: rows.at(-1).date,
      probability: round(probability, 4),
      signal,
      confidence: round(Math.abs(probability - 0.5) * 2, 4),
      explanation: signal === 'BUY'
        ? '模型认为下一交易日正收益概率超过买入阈值'
        : signal === 'SELL'
          ? '模型概率低于退出阈值，策略倾向降低风险敞口'
          : '信号处于中性区间，不执行交易',
    },
    metrics: {
      ...simulation.metrics,
      directionalAccuracy: round(accuracy * 100, 2),
    },
    equityCurve: simulation.equityCurve,
    trades: simulation.trades,
    warnings: [
      '仅使用日 K 量价特征，不含公告、财务、盘口、指数成分调整或真实券商成交回报。',
      '样本外结果不代表未来；多次调参会产生过拟合和数据窥探偏差。',
      '回测已计入估算佣金、过户费、印花税和滑点，但与本人君弘账户仍可能不同。',
    ],
  }
}

export function analyzeRelativeValue(leftCandles, rightCandles, options = {}) {
  const window = integerInRange(options.window, 20, 120, 60)
  const threshold = numberInRange(options.threshold, 1, 4, 2)
  const left = completedRows(normalizeCandles(leftCandles), options.now)
  const right = completedRows(normalizeCandles(rightCandles), options.now)
  const rightMap = new Map(right.map((row) => [row.date, row]))
  const aligned = left
    .filter((row) => rightMap.has(row.date))
    .map((row) => ({ date: row.date, left: row.close, right: rightMap.get(row.date).close, spread: Math.log(row.close / rightMap.get(row.date).close) }))
  if (aligned.length < window + 20) throw withStatus(`配对交易日不足，至少需要 ${window + 20} 天`, 400)

  const current = aligned.at(-1)
  const history = aligned.slice(-(window + 1), -1).map((row) => row.spread)
  const center = mean(history)
  const sigma = standardDeviation(history)
  const zScore = sigma > 1e-9 ? (current.spread - center) / sigma : 0
  const divergencePct = (Math.exp(Math.abs(current.spread - center)) - 1) * 100
  const signal = zScore >= threshold
    ? 'LEFT_RICH'
    : zScore <= -threshold
      ? 'RIGHT_RICH'
      : 'NEUTRAL'

  return {
    date: current.date,
    window,
    threshold,
    zScore: round(zScore, 3),
    divergencePct: round(divergencePct, 3),
    signal,
    interpretation: signal === 'LEFT_RICH'
      ? '左侧相对偏贵、右侧相对偏便宜；仅适合作为换仓观察，不能视为无风险套利。'
      : signal === 'RIGHT_RICH'
        ? '右侧相对偏贵、左侧相对偏便宜；仅适合作为换仓观察，不能视为无风险套利。'
        : '价差仍在历史常态范围内。',
    series: aligned.slice(-Math.min(180, aligned.length)).map((row) => ({
      date: row.date,
      zScore: round(sigma > 1e-9 ? (row.spread - center) / sigma : 0, 3),
    })),
    warnings: [
      '同指数 ETF 仍可能因费率、分红、申赎、跟踪误差和流动性产生长期价差。',
      '普通现金账户通常不能完成对称做空，本信号不是市场中性套利。',
    ],
  }
}

export function runCrossSectionalBacktest(universe, options = {}) {
  const config = {
    initialCapital: numberInRange(options.initialCapital, 5_000, 10_000_000, 10_000),
    trainWindow: integerInRange(options.trainWindow, 80, 500, 180),
    testRatio: numberInRange(options.testRatio, 0.2, 0.5, 0.3),
    refitEvery: integerInRange(options.refitEvery, 1, 20, 5),
    rebalanceEvery: integerInRange(options.rebalanceEvery, 2, 20, 5),
    topK: integerInRange(options.topK, 2, 5, 3),
    selectionThreshold: numberInRange(options.selectionThreshold, 0.5, 0.75, 0.55),
    maxWeight: numberInRange(options.maxWeight, 0.1, 0.4, 0.3),
    maxOrderValue: numberInRange(options.maxOrderValue, 100, 1_000_000, 1_000),
    slippageBps: numberInRange(options.slippageBps, 0, 100, 5),
    costMultiplier: numberInRange(options.costMultiplier, 1, 3, 1),
  }
  const assets = normalizeUniverse(universe, options.now)
  if (assets.length < 4) throw withStatus('横截面模型至少需要 4 个有效 ETF', 400)
  config.topK = Math.min(config.topK, assets.length - 1)

  const dateGroups = buildCrossSectionalGroups(assets)
  if (dateGroups.length < 130) throw withStatus('ETF 共同有效样本少于 130 个交易日', 400)
  const firstTest = Math.max(80, Math.floor(dateGroups.length * (1 - config.testRatio)))
  const predictions = []
  let model = null
  for (let cursor = firstTest; cursor < dateGroups.length; cursor += 1) {
    if (!model || (cursor - firstTest) % config.refitEvery === 0) {
      const trainingGroups = dateGroups.slice(Math.max(0, cursor - config.trainWindow), cursor)
      model = fitLogistic(trainingGroups.flatMap((group) => group.samples))
    }
    const group = dateGroups[cursor]
    const ranked = group.samples
      .map((sample) => ({ ...sample, probability: predict(model, sample.features) }))
      .sort((left, right) => right.probability - left.probability)
    predictions.push({ date: group.date, executionDate: group.executionDate, ranked })
  }

  const simulation = simulateCrossSectional(predictions, config, assets)
  const finalTraining = dateGroups.slice(Math.max(0, dateGroups.length - config.trainWindow)).flatMap((group) => group.samples)
  const finalModel = fitLogistic(finalTraining)
  const currentDate = commonLatestFeatureDate(assets)
  const currentRanking = assets
    .map((asset) => {
      const index = asset.rows.findIndex((row) => row.date === currentDate)
      const features = featuresAt(asset.rows, index)
      if (!features) return null
      return {
        symbol: asset.symbol,
        name: asset.name,
        probability: round(predict(finalModel, features), 4),
        volatility: round(features[5], 6),
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.probability - left.probability)
  const targets = targetPortfolio(currentRanking, config)

  return {
    model: {
      id: 'cross-sectional-logistic-v1',
      name: 'ETF 横截面走步逻辑回归',
      purpose: '预测下一交易日相对收益是否高于研究池中位数',
      universeSize: assets.length,
      featureNames: FEATURE_NAMES,
      featureWeights: FEATURE_NAMES.map((name, index) => ({ name, weight: round(finalModel.weights[index + 1] ?? 0, 4) })),
      trainingSamples: finalTraining.length,
      outOfSampleDates: predictions.length,
      noLookahead: true,
    },
    config,
    current: {
      date: currentDate,
      ranking: currentRanking.map((item, index) => ({ ...item, rank: index + 1, selected: targets.some((target) => target.symbol === item.symbol) })),
      targets,
      cashWeight: round(Math.max(0, 1 - targets.reduce((sum, target) => sum + target.weight, 0)), 4),
    },
    metrics: simulation.metrics,
    equityCurve: simulation.equityCurve,
    rebalances: simulation.rebalances,
    warnings: [
      '研究池只有少量宽基/风格 ETF，横截面样本远小于专业机构，不应据此推断稳定 Alpha。',
      '基金跟踪误差、规模、费率、分红与流动性差异可能被模型误识别为可交易信号。',
      '55% 置信门槛是保守设计参数；看到回测后再修改门槛会引入数据窥探，必须重新做嵌套样本外验证。',
      '目标权重用于影子组合研究，不会自动转换为君弘真实委托。',
    ],
  }
}

function normalizeUniverse(universe, now) {
  const seen = new Set()
  return (Array.isArray(universe) ? universe : []).map((asset) => {
    const symbol = String(asset?.symbol ?? '').trim().toUpperCase()
    if (!symbol || seen.has(symbol)) return null
    seen.add(symbol)
    const rows = completedRows(normalizeCandles(asset?.candles), now)
    if (rows.length < 130) return null
    return {
      symbol,
      name: String(asset?.name ?? symbol).trim().slice(0, 40) || symbol,
      quantityRule: asset?.quantityRule ?? { buyMin: 100, buyStep: 100 },
      rows,
    }
  }).filter(Boolean)
}

function buildCrossSectionalGroups(assets) {
  const panel = new Map()
  for (const asset of assets) {
    for (let index = 20; index < asset.rows.length - 1; index += 1) {
      const features = featuresAt(asset.rows, index)
      if (!features) continue
      const current = asset.rows[index]
      const next = asset.rows[index + 1]
      const sample = {
        symbol: asset.symbol,
        name: asset.name,
        date: current.date,
        executionDate: next.date,
        features,
        currentClose: current.close,
        nextOpen: next.open,
        nextClose: next.close,
        targetReturn: next.close / current.close - 1,
        quantityRule: asset.quantityRule,
      }
      const group = panel.get(current.date) ?? []
      group.push(sample)
      panel.set(current.date, group)
    }
  }
  return [...panel.entries()]
    .filter(([, samples]) => samples.length === assets.length)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, samples]) => {
      const center = median(samples.map((sample) => sample.targetReturn))
      return {
        date,
        executionDate: samples[0].executionDate,
        samples: samples.map((sample) => ({ ...sample, label: sample.targetReturn > center ? 1 : 0 })),
      }
    })
}

function simulateCrossSectional(predictions, config, assets) {
  let cash = config.initialCapital
  const holdings = new Map()
  const equityCurve = []
  const rebalances = []
  const dailyReturns = []
  let previousEquity = config.initialCapital
  let totalCosts = 0
  let totalNotional = 0
  let selectedCorrect = 0
  let selectedCount = 0
  const firstPrices = new Map(predictions[0].ranked.map((item) => [item.symbol, item.currentClose]))

  predictions.forEach((prediction, predictionIndex) => {
    const prices = new Map(prediction.ranked.map((item) => [item.symbol, item]))
    const beforeEquity = cash + [...holdings.entries()].reduce((sum, [symbol, quantity]) => sum + quantity * (prices.get(symbol)?.nextOpen ?? 0), 0)
    if (predictionIndex % config.rebalanceEvery === 0) {
      const selected = prediction.ranked.filter((item) => item.probability >= config.selectionThreshold).slice(0, config.topK)
      const selectedSymbols = new Set(selected.map((item) => item.symbol))
      const actions = []
      for (const [symbol, quantity] of [...holdings.entries()]) {
        if (selectedSymbols.has(symbol)) continue
        const sample = prices.get(symbol)
        const executionPrice = sample.nextOpen * (1 - config.slippageBps / 10_000)
        const fees = estimateFees({ side: 'SELL', price: executionPrice, quantity })
        const chargedFees = fees.total * config.costMultiplier
        const credit = executionPrice * quantity - chargedFees
        cash += credit
        holdings.delete(symbol)
        totalCosts += chargedFees + (sample.nextOpen - executionPrice) * quantity
        totalNotional += executionPrice * quantity
        actions.push({ side: 'SELL', symbol, quantity, price: round(executionPrice, 4) })
      }
      for (const sample of selected) {
        selectedCorrect += sample.label
        selectedCount += 1
        if (holdings.has(sample.symbol)) continue
        const executionPrice = sample.nextOpen * (1 + config.slippageBps / 10_000)
        const budget = Math.min(config.maxOrderValue, beforeEquity * config.maxWeight, cash)
        const quantity = affordableQuantity(budget, executionPrice, sample.quantityRule)
        if (quantity <= 0) continue
        const fees = estimateFees({ side: 'BUY', price: executionPrice, quantity })
        const chargedFees = fees.total * config.costMultiplier
        const debit = executionPrice * quantity + chargedFees
        if (debit > cash) continue
        cash -= debit
        holdings.set(sample.symbol, quantity)
        totalCosts += chargedFees + (executionPrice - sample.nextOpen) * quantity
        totalNotional += executionPrice * quantity
        actions.push({ side: 'BUY', symbol: sample.symbol, quantity, price: round(executionPrice, 4) })
      }
      rebalances.push({ signalDate: prediction.date, executionDate: prediction.executionDate, selected: selected.map((item) => item.symbol), actions })
    }

    const equity = cash + [...holdings.entries()].reduce((sum, [symbol, quantity]) => sum + quantity * (prices.get(symbol)?.nextClose ?? 0), 0)
    const benchmarkRatios = prediction.ranked.map((item) => item.nextClose / firstPrices.get(item.symbol))
    const benchmark = config.initialCapital * mean(benchmarkRatios)
    dailyReturns.push(previousEquity > 0 ? equity / previousEquity - 1 : 0)
    previousEquity = equity
    equityCurve.push({ date: prediction.executionDate, equity: roundMoney(equity), benchmark: roundMoney(benchmark), positions: holdings.size })
  })

  const finalEquity = equityCurve.at(-1)?.equity ?? config.initialCapital
  const totalReturn = finalEquity / config.initialCapital - 1
  const benchmarkReturn = (equityCurve.at(-1)?.benchmark ?? config.initialCapital) / config.initialCapital - 1
  const averageEquity = mean(equityCurve.map((point) => point.equity))
  return {
    equityCurve,
    rebalances,
    metrics: {
      initialCapital: config.initialCapital,
      finalEquity: roundMoney(finalEquity),
      totalReturnPct: round(totalReturn * 100, 2),
      annualizedReturnPct: round((Math.pow(Math.max(0.0001, 1 + totalReturn), 252 / Math.max(1, equityCurve.length)) - 1) * 100, 2),
      benchmarkReturnPct: round(benchmarkReturn * 100, 2),
      excessReturnPct: round((totalReturn - benchmarkReturn) * 100, 2),
      maxDrawdownPct: round(maxDrawdown(equityCurve.map((point) => point.equity)) * 100, 2),
      sharpe: round(sharpe(dailyReturns), 2),
      rankHitRatePct: round((selectedCorrect / Math.max(1, selectedCount)) * 100, 2),
      rebalanceCount: rebalances.length,
      turnoverPct: round((totalNotional / Math.max(1, averageEquity)) * 100, 2),
      estimatedCosts: roundMoney(totalCosts),
      currentPositions: holdings.size,
    },
  }
}

export function runCrossSectionalRobustness(universe, options = {}) {
  const fixedScenarios = [
    { id: 'base', label: '基准：55%门槛/5日换仓', parameters: { selectionThreshold: 0.55, rebalanceEvery: 5, slippageBps: 5, costMultiplier: 1, maxOrderValue: 1_000 } },
    { id: 'threshold_52', label: '较弱门槛：52%', parameters: { selectionThreshold: 0.52, rebalanceEvery: 5, slippageBps: 5, costMultiplier: 1, maxOrderValue: 1_000 } },
    { id: 'threshold_58', label: '更严门槛：58%', parameters: { selectionThreshold: 0.58, rebalanceEvery: 5, slippageBps: 5, costMultiplier: 1, maxOrderValue: 1_000 } },
    { id: 'rebalance_10', label: '低频：10日换仓', parameters: { selectionThreshold: 0.55, rebalanceEvery: 10, slippageBps: 5, costMultiplier: 1, maxOrderValue: 1_000 } },
    { id: 'slippage_15', label: '滑点压力：15基点', parameters: { selectionThreshold: 0.55, rebalanceEvery: 5, slippageBps: 15, costMultiplier: 1, maxOrderValue: 1_000 } },
    { id: 'fees_2x', label: '费用压力：佣金规费2倍', parameters: { selectionThreshold: 0.55, rebalanceEvery: 5, slippageBps: 5, costMultiplier: 2, maxOrderValue: 1_000 } },
    { id: 'order_500', label: '更小资金：单笔500元', parameters: { selectionThreshold: 0.55, rebalanceEvery: 5, slippageBps: 5, costMultiplier: 1, maxOrderValue: 500 } },
  ]
  const scenarios = fixedScenarios.map((scenario) => {
    const result = runCrossSectionalBacktest(universe, { ...options, ...scenario.parameters })
    return { id: scenario.id, label: scenario.label, parameters: scenario.parameters, metrics: result.metrics }
  })
  const base = runCrossSectionalBacktest(universe, { ...options, ...fixedScenarios[0].parameters })
  const regimes = splitEquityRegimes(base.equityCurve, 3)
  const positiveScenarios = scenarios.filter((scenario) => scenario.metrics.excessReturnPct > 0).length
  const positiveRegimes = regimes.filter((regime) => regime.excessReturnPct > 0).length
  const worstRegimeExcess = Math.min(...regimes.map((regime) => regime.excessReturnPct))
  const costStress = scenarios.find((scenario) => scenario.id === 'fees_2x')
  const checks = [
    { id: 'base_excess', pass: base.metrics.excessReturnPct > 0, label: '基准样本外超额收益为正' },
    { id: 'scenario_majority', pass: positiveScenarios >= Math.ceil(scenarios.length * 0.6), label: '至少 60% 固定压力场景超额为正' },
    { id: 'regime_consistency', pass: positiveRegimes >= 2, label: '三个时间段中至少两个超额为正' },
    { id: 'regime_tail', pass: worstRegimeExcess >= -10, label: '任一时间段超额不低于 -10%' },
    { id: 'cost_survival', pass: Boolean(costStress?.metrics.excessReturnPct > 0), label: '费用翻倍后超额仍为正' },
    { id: 'drawdown', pass: Math.max(...scenarios.map((scenario) => scenario.metrics.maxDrawdownPct)) <= 10, label: '所有场景最大回撤不超过 10%' },
    { id: 'turnover', pass: base.metrics.turnoverPct <= 200, label: '基准年化外推前换手不超过 200%' },
  ]
  const failed = checks.filter((check) => !check.pass).length
  const criticalFailure = !checks.find((check) => check.id === 'base_excess')?.pass || !checks.find((check) => check.id === 'regime_tail')?.pass
  const verdict = failed === 0 ? 'SHADOW_ONLY' : criticalFailure ? 'REJECTED' : 'FRAGILE'
  return {
    modelId: base.model.id,
    generatedAt: new Date().toISOString(),
    knownTrialCount: scenarios.length + 2,
    selectionBiasNotice: '本项目此前已观察 50% 与 55% 门槛结果，当前验证不再是完全独立的首次检验。',
    verdict,
    checks,
    summary: {
      scenarios: scenarios.length,
      positiveScenarios,
      positiveScenarioPct: round((positiveScenarios / scenarios.length) * 100, 2),
      positiveRegimes,
      worstRegimeExcessPct: round(worstRegimeExcess, 2),
      medianExcessReturnPct: round(median(scenarios.map((scenario) => scenario.metrics.excessReturnPct)), 2),
      worstExcessReturnPct: round(Math.min(...scenarios.map((scenario) => scenario.metrics.excessReturnPct)), 2),
      worstDrawdownPct: round(Math.max(...scenarios.map((scenario) => scenario.metrics.maxDrawdownPct)), 2),
      baseTurnoverPct: base.metrics.turnoverPct,
    },
    scenarios,
    regimes,
    base: { metrics: base.metrics, current: base.current, model: base.model },
    warnings: [
      '场景集合在运行前固定，界面不会自动挑选收益最高的参数。',
      '本审计不能消除模型选择偏差；真正独立的证据只能来自未来影子数据或冻结后的新时间段。',
      '即使全部检查通过，结论仍只允许进入影子观察，不自动升级为模拟或实盘交易。',
    ],
  }
}

function splitEquityRegimes(curve, count) {
  const regimes = []
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * curve.length / count)
    const end = Math.floor((index + 1) * curve.length / count)
    const slice = curve.slice(start, end)
    if (slice.length < 2) continue
    const first = slice[0]
    const last = slice.at(-1)
    const portfolioReturn = last.equity / first.equity - 1
    const benchmarkReturn = last.benchmark / first.benchmark - 1
    regimes.push({
      id: `regime_${index + 1}`,
      start: first.date,
      end: last.date,
      totalReturnPct: round(portfolioReturn * 100, 2),
      benchmarkReturnPct: round(benchmarkReturn * 100, 2),
      excessReturnPct: round((portfolioReturn - benchmarkReturn) * 100, 2),
      maxDrawdownPct: round(maxDrawdown(slice.map((point) => point.equity)) * 100, 2),
    })
  }
  return regimes
}

function commonLatestFeatureDate(assets) {
  const dateSets = assets.map((asset) => new Set(asset.rows.slice(20).map((row) => row.date)))
  const candidates = [...dateSets[0]].filter((date) => dateSets.every((set) => set.has(date))).sort()
  return candidates.at(-1)
}

function targetPortfolio(ranking, config) {
  const selected = ranking.filter((item) => item.probability >= config.selectionThreshold).slice(0, config.topK)
  if (selected.length === 0) return []
  const inverseVolatility = selected.map((item) => 1 / Math.max(0.002, Number(item.volatility) || 0.002))
  const total = inverseVolatility.reduce((sum, value) => sum + value, 0)
  return selected.map((item, index) => ({
    symbol: item.symbol,
    name: item.name,
    probability: item.probability,
    weight: round(Math.min(config.maxWeight, 0.9 * inverseVolatility[index] / total), 4),
  }))
}

function buildSamples(rows, targetThreshold) {
  const samples = []
  for (let index = 20; index < rows.length - 1; index += 1) {
    const features = featuresAt(rows, index)
    if (!features) continue
    const targetReturn = rows[index + 1].close / rows[index].close - 1
    samples.push({
      index,
      date: rows[index].date,
      executionDate: rows[index + 1].date,
      features,
      targetReturn,
      label: targetReturn > targetThreshold ? 1 : 0,
    })
  }
  return samples
}

function featuresAt(rows, index) {
  if (index < 20 || !rows[index]) return null
  const current = rows[index]
  const previous = rows[index - 1]
  const closes5 = rows.slice(index - 4, index + 1).map((row) => row.close)
  const closes20 = rows.slice(index - 19, index + 1).map((row) => row.close)
  const returns10 = []
  for (let cursor = index - 9; cursor <= index; cursor += 1) {
    if (cursor <= 0) continue
    returns10.push(Math.log(rows[cursor].close / rows[cursor - 1].close))
  }
  const logVolumes = rows.slice(index - 19, index + 1).map((row) => Math.log(Math.max(1, row.volume)))
  const volumeSigma = standardDeviation(logVolumes)
  let gains = 0
  let losses = 0
  for (let cursor = index - 13; cursor <= index; cursor += 1) {
    const change = rows[cursor].close - rows[cursor - 1].close
    if (change >= 0) gains += change
    else losses -= change
  }
  const rsi = gains + losses > 0 ? gains / (gains + losses) : 0.5
  const values = [
    Math.log(current.close / previous.close),
    Math.log(current.close / rows[index - 5].close),
    Math.log(current.close / rows[index - 20].close),
    Math.log(current.close / mean(closes5)),
    Math.log(current.close / mean(closes20)),
    standardDeviation(returns10),
    (current.close - current.open) / current.open,
    volumeSigma > 1e-9 ? (logVolumes.at(-1) - mean(logVolumes)) / volumeSigma : 0,
    (rsi - 0.5) * 2,
  ]
  return values.map((value) => Number.isFinite(value) ? Math.max(-10, Math.min(10, value)) : 0)
}

function fitLogistic(samples) {
  const featureCount = FEATURE_NAMES.length
  const means = Array(featureCount).fill(0)
  const deviations = Array(featureCount).fill(1)
  for (let column = 0; column < featureCount; column += 1) {
    const values = samples.map((sample) => sample.features[column])
    means[column] = mean(values)
    deviations[column] = Math.max(1e-6, standardDeviation(values))
  }
  const weights = Array(featureCount + 1).fill(0)
  const positives = samples.reduce((sum, sample) => sum + sample.label, 0)
  const baseRate = Math.min(0.98, Math.max(0.02, positives / Math.max(1, samples.length)))
  weights[0] = Math.log(baseRate / (1 - baseRate))
  const l2 = 0.02
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const gradient = Array(featureCount + 1).fill(0)
    for (const sample of samples) {
      const normalized = sample.features.map((value, index) => (value - means[index]) / deviations[index])
      const probability = sigmoid(weights[0] + normalized.reduce((sum, value, index) => sum + value * weights[index + 1], 0))
      const error = probability - sample.label
      gradient[0] += error
      normalized.forEach((value, index) => { gradient[index + 1] += error * value })
    }
    const learningRate = 0.12 / Math.sqrt(1 + iteration / 20)
    weights[0] -= learningRate * gradient[0] / Math.max(1, samples.length)
    for (let index = 1; index < weights.length; index += 1) {
      weights[index] -= learningRate * ((gradient[index] / Math.max(1, samples.length)) + l2 * weights[index])
    }
  }
  return { means, deviations, weights }
}

function predict(model, features) {
  const normalized = features.map((value, index) => (value - model.means[index]) / model.deviations[index])
  return sigmoid(model.weights[0] + normalized.reduce((sum, value, index) => sum + value * model.weights[index + 1], 0))
}

function simulateLongOnly(rows, predictions, config, quantityRule) {
  const rule = quantityRule ?? { buyMin: 100, buyStep: 100 }
  let cash = config.initialCapital
  let shares = 0
  let entryCost = 0
  let totalCosts = 0
  const trades = []
  const equityCurve = []
  const dailyReturns = []
  let previousEquity = config.initialCapital
  const startClose = rows[predictions[0].index].close

  for (const prediction of predictions) {
    const execution = rows[prediction.index + 1]
    const desired = signalFor(prediction.probability, config)
    if (desired === 'BUY' && shares === 0) {
      const executionPrice = execution.open * (1 + config.slippageBps / 10_000)
      const budget = Math.min(config.maxOrderValue, cash)
      const quantity = affordableQuantity(budget, executionPrice, rule)
      if (quantity > 0) {
        const fees = estimateFees({ side: 'BUY', price: executionPrice, quantity })
        const debit = executionPrice * quantity + fees.total
        if (debit <= cash) {
          cash -= debit
          shares = quantity
          entryCost = debit
          totalCosts += fees.total + (executionPrice - execution.open) * quantity
          trades.push({ side: 'BUY', date: execution.date, price: round(executionPrice, 4), quantity, probability: round(prediction.probability, 4), fees: fees.total })
        }
      }
    } else if (desired === 'SELL' && shares > 0) {
      const executionPrice = execution.open * (1 - config.slippageBps / 10_000)
      const fees = estimateFees({ side: 'SELL', price: executionPrice, quantity: shares })
      const credit = executionPrice * shares - fees.total
      const pnl = credit - entryCost
      cash += credit
      totalCosts += fees.total + (execution.open - executionPrice) * shares
      trades.push({ side: 'SELL', date: execution.date, price: round(executionPrice, 4), quantity: shares, probability: round(prediction.probability, 4), fees: fees.total, pnl: roundMoney(pnl), returnPct: round((pnl / entryCost) * 100, 2) })
      shares = 0
      entryCost = 0
    }

    const equity = cash + shares * execution.close
    const dailyReturn = previousEquity > 0 ? equity / previousEquity - 1 : 0
    dailyReturns.push(dailyReturn)
    previousEquity = equity
    equityCurve.push({
      date: execution.date,
      equity: roundMoney(equity),
      buyHold: roundMoney(config.initialCapital * (execution.close / startClose)),
      probability: round(prediction.probability, 4),
      signal: desired,
    })
  }

  const finalEquity = equityCurve.at(-1)?.equity ?? config.initialCapital
  const completed = trades.filter((trade) => trade.side === 'SELL')
  const profitable = completed.filter((trade) => trade.pnl > 0)
  const grossProfit = profitable.reduce((sum, trade) => sum + trade.pnl, 0)
  const grossLoss = Math.abs(completed.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0))
  const totalReturn = finalEquity / config.initialCapital - 1
  const days = Math.max(1, equityCurve.length)
  return {
    equityCurve,
    trades,
    metrics: {
      initialCapital: config.initialCapital,
      finalEquity: roundMoney(finalEquity),
      totalReturnPct: round(totalReturn * 100, 2),
      annualizedReturnPct: round((Math.pow(Math.max(0.0001, 1 + totalReturn), 252 / days) - 1) * 100, 2),
      buyHoldReturnPct: round(((equityCurve.at(-1)?.buyHold ?? config.initialCapital) / config.initialCapital - 1) * 100, 2),
      maxDrawdownPct: round(maxDrawdown(equityCurve.map((point) => point.equity)) * 100, 2),
      sharpe: round(sharpe(dailyReturns), 2),
      completedTrades: completed.length,
      winRatePct: round((profitable.length / Math.max(1, completed.length)) * 100, 2),
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? null : 0,
      estimatedCosts: roundMoney(totalCosts),
      currentShares: shares,
    },
  }
}

function affordableQuantity(budget, price, rule) {
  const minimum = Math.max(1, Number(rule.buyMin) || 100)
  const step = Math.max(1, Number(rule.buyStep) || 100)
  const maximum = Math.floor((budget - 6) / price)
  if (maximum < minimum) return 0
  return minimum + Math.floor((maximum - minimum) / step) * step
}

function signalFor(probability, config) {
  if (probability >= config.buyThreshold) return 'BUY'
  if (probability <= config.sellThreshold) return 'SELL'
  return 'HOLD'
}

function normalizeCandles(candles) {
  const unique = new Map()
  for (const row of Array.isArray(candles) ? candles : []) {
    const normalized = {
      date: String(row?.date ?? ''),
      open: Number(row?.open),
      close: Number(row?.close),
      high: Number(row?.high),
      low: Number(row?.low),
      volume: Number(row?.volume),
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized.date)) continue
    if (![normalized.open, normalized.close, normalized.high, normalized.low].every((value) => Number.isFinite(value) && value > 0)) continue
    if (!Number.isFinite(normalized.volume) || normalized.volume < 0) normalized.volume = 0
    unique.set(normalized.date, normalized)
  }
  return [...unique.values()].sort((left, right) => left.date.localeCompare(right.date))
}

export function onlyCompletedDailyCandles(candles, now = new Date()) {
  return completedRows(normalizeCandles(candles), now)
}

function completedRows(rows, nowValue = new Date()) {
  if (rows.length === 0) return rows
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue)
  if (Number.isNaN(now.getTime())) return rows
  const clock = beijingClock(now)
  if (rows.at(-1).date === clock.date && clock.minutes < 15 * 60 + 5) return rows.slice(0, -1)
  return rows
}

function beijingClock(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute) }
}

function normalizeConfig(options) {
  const buyThreshold = numberInRange(options.buyThreshold, 0.51, 0.9, DEFAULTS.buyThreshold)
  const sellThreshold = numberInRange(options.sellThreshold, 0.1, 0.49, DEFAULTS.sellThreshold)
  if (sellThreshold >= buyThreshold) throw withStatus('卖出阈值必须低于买入阈值', 400)
  return {
    initialCapital: numberInRange(options.initialCapital, 1_000, 10_000_000, DEFAULTS.initialCapital),
    trainWindow: integerInRange(options.trainWindow, 80, 500, DEFAULTS.trainWindow),
    minTrainSamples: DEFAULTS.minTrainSamples,
    testRatio: numberInRange(options.testRatio, 0.2, 0.5, DEFAULTS.testRatio),
    refitEvery: integerInRange(options.refitEvery, 1, 20, DEFAULTS.refitEvery),
    buyThreshold,
    sellThreshold,
    targetReturnThreshold: numberInRange(options.targetReturnThreshold, 0, 0.03, DEFAULTS.targetReturnThreshold),
    slippageBps: numberInRange(options.slippageBps, 0, 100, DEFAULTS.slippageBps),
    maxOrderValue: numberInRange(options.maxOrderValue, 100, 1_000_000, DEFAULTS.maxOrderValue),
  }
}

function maxDrawdown(values) {
  let peak = values[0] ?? 1
  let worst = 0
  for (const value of values) {
    peak = Math.max(peak, value)
    worst = Math.max(worst, peak > 0 ? (peak - value) / peak : 0)
  }
  return worst
}

function sharpe(returns) {
  const average = mean(returns)
  const deviation = standardDeviation(returns)
  return deviation > 1e-12 ? (average / deviation) * Math.sqrt(252) : 0
}

function sigmoid(value) {
  const bounded = Math.max(-30, Math.min(30, value))
  return 1 / (1 + Math.exp(-bounded))
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const center = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - center) ** 2), 0) / values.length)
}

function numberInRange(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

function integerInRange(value, minimum, maximum, fallback) {
  return Math.round(numberInRange(value, minimum, maximum, fallback))
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
