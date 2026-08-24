import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeRelativeValue, FEATURE_NAMES, onlyCompletedDailyCandles, runCrossSectionalBacktest, runCrossSectionalRobustness, runMlBacktest } from '../server/core/quant-research.mjs'

function candles(count = 360, variant = 0) {
  const rows = []
  let price = 4.5 + variant
  const date = new Date('2024-01-02T00:00:00Z')
  while (rows.length < count) {
    if (![0, 6].includes(date.getUTCDay())) {
      const index = rows.length
      const cycle = Math.sin(index / 9 + variant) * 0.008
      const regime = Math.sin(index / 47) > 0 ? 0.0012 : -0.0005
      const open = price * (1 + Math.cos(index / 13) * 0.002)
      const close = Math.max(0.5, open * (1 + cycle + regime))
      rows.push({
        date: date.toISOString().slice(0, 10),
        open,
        close,
        high: Math.max(open, close) * 1.004,
        low: Math.min(open, close) * 0.996,
        volume: 1_000_000 * (1 + Math.sin(index / 7) * 0.3),
      })
      price = close
    }
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return rows
}

test('机器学习回测采用走步样本外预测并输出完整指标', () => {
  const result = runMlBacktest(candles(), {
    buyThreshold: 0.53,
    sellThreshold: 0.47,
    quantityRule: { buyMin: 100, buyStep: 100 },
  })
  assert.equal(result.model.noLookahead, true)
  assert.equal(result.model.featureNames.length, FEATURE_NAMES.length)
  assert.equal(result.model.featureWeights.length, FEATURE_NAMES.length)
  assert.ok(result.model.outOfSampleSamples >= 80)
  assert.equal(result.equityCurve.length, result.model.outOfSampleSamples)
  assert.ok(Number.isFinite(result.metrics.totalReturnPct))
  assert.ok(Number.isFinite(result.metrics.maxDrawdownPct))
  assert.match(result.current.signal, /BUY|SELL|HOLD/)
})

test('相同数据和参数生成确定性结果', () => {
  const input = candles()
  const left = runMlBacktest(input, { buyThreshold: 0.55, sellThreshold: 0.45 })
  const right = runMlBacktest(input, { buyThreshold: 0.55, sellThreshold: 0.45 })
  assert.deepEqual(left, right)
})

test('历史样本不足时拒绝生成貌似可靠的结论', () => {
  assert.throws(() => runMlBacktest(candles(100)), /少于 130/)
})

test('盘中未完成的当日日 K 不进入训练与信号', () => {
  const input = candles(150)
  const currentDate = input.at(-1).date
  const duringSession = new Date(`${currentDate}T10:00:00+08:00`)
  const afterClose = new Date(`${currentDate}T15:10:00+08:00`)
  assert.equal(onlyCompletedDailyCandles(input, duringSession).length, input.length - 1)
  assert.equal(onlyCompletedDailyCandles(input, afterClose).length, input.length)
})

test('相对价值模型识别同类资产的显著价差但不宣称无风险套利', () => {
  const left = candles(220)
  const right = candles(220, 0.15)
  for (let index = left.length - 4; index < left.length; index += 1) {
    left[index] = { ...left[index], close: left[index].close * 1.08, high: left[index].high * 1.08 }
  }
  const result = analyzeRelativeValue(left, right, { window: 60, threshold: 1.5 })
  assert.notEqual(result.signal, 'NEUTRAL')
  assert.ok(Math.abs(result.zScore) >= 1.5)
  assert.match(result.interpretation, /不能视为无风险套利/)
})

test('横截面模型按相对收益训练并生成受限目标组合', () => {
  const universe = Array.from({ length: 6 }, (_, index) => ({
    symbol: `51030${index}.SH`,
    name: `ETF-${index}`,
    candles: candles(360, index * 0.37),
    quantityRule: { buyMin: 100, buyStep: 100 },
  }))
  const result = runCrossSectionalBacktest(universe, { topK: 3, maxWeight: 0.3, maxOrderValue: 1_000 })
  assert.equal(result.model.noLookahead, true)
  assert.equal(result.model.universeSize, 6)
  assert.ok(result.model.outOfSampleDates >= 80)
  assert.equal(result.current.ranking.length, 6)
  assert.ok(result.current.targets.length <= 3)
  assert.equal(result.current.targets.every((target) => target.weight <= 0.3), true)
  assert.ok(result.current.cashWeight >= 0.1)
  assert.ok(Number.isFinite(result.metrics.excessReturnPct))
  assert.ok(result.rebalances.length > 0)
})

test('稳健性审计登记所有固定场景而不是只返回最好结果', () => {
  const universe = Array.from({ length: 6 }, (_, index) => ({
    symbol: `51030${index}.SH`,
    name: `ETF-${index}`,
    candles: candles(260, index * 0.29),
    quantityRule: { buyMin: 100, buyStep: 100 },
  }))
  const result = runCrossSectionalRobustness(universe)
  assert.equal(result.scenarios.length, 7)
  assert.equal(result.knownTrialCount, 9)
  assert.equal(result.regimes.length, 3)
  assert.equal(result.checks.length, 7)
  assert.match(result.verdict, /SHADOW_ONLY|FRAGILE|REJECTED/)
  assert.equal(result.scenarios.some((scenario) => scenario.id === 'fees_2x'), true)
})
