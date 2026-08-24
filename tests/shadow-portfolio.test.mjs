import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { calculateShadowOutcome, DEFAULT_ETF_UNIVERSE, ShadowPortfolioStore, validateUniverse } from '../server/core/shadow-portfolio.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stock-workbench-shadow-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return new ShadowPortfolioStore(join(dir, 'shadow.json'))
}

test('影子组合默认关闭并使用经过核验的六只 ETF', async (t) => {
  const store = await fixture(t)
  const state = await store.get()
  assert.equal(state.enabled, false)
  assert.deepEqual(state.universe, DEFAULT_ETF_UNIVERSE.map((item) => item.symbol))
  assert.equal(validateUniverse(state.universe).length, 6)
})

test('影子组合拒绝过小研究池和非 ETF', () => {
  assert.throws(() => validateUniverse(['510300', '510500', '588000']), /4–10/)
  assert.throws(() => validateUniverse(['510300', '510500', '588000', '600000']), /不是.*ETF/)
})

test('同一信号日期的影子快照会替换而不是重复累积', async (t) => {
  const store = await fixture(t)
  await store.update({ enabled: true })
  await store.record({ date: '2026-08-21', targets: [{ symbol: '510300.SH', weight: 0.3 }] })
  const state = await store.record({ date: '2026-08-21', targets: [{ symbol: '510500.SH', weight: 0.3 }] })
  assert.equal(state.history.length, 1)
  assert.equal(state.lastSnapshot.targets[0].symbol, '510500.SH')
})

test('影子快照结算后累计真实区间收益与命中率', async (t) => {
  const store = await fixture(t)
  await store.record({ date: '2026-08-20', targets: [{ symbol: '510300.SH', weight: 0.3 }] })
  const settled = await store.settle('2026-08-20', {
    toDate: '2026-08-21',
    portfolioReturnPct: 0.6,
    benchmarkReturnPct: 0.2,
    excessReturnPct: 0.4,
  })
  assert.equal(settled.history[0].outcome.excessReturnPct, 0.4)
  assert.equal(settled.performance.settledSnapshots, 1)
  assert.equal(settled.performance.hitRatePct, 100)
  assert.equal(settled.performance.status, 'INSUFFICIENT')
})

test('影子收益按目标权重与现金缓冲结算', () => {
  const snapshot = { date: '2026-08-20', targets: [{ symbol: 'A', weight: 0.3 }, { symbol: 'B', weight: 0.2 }], cashWeight: 0.5 }
  const datasets = [
    { symbol: 'A', candles: [{ date: '2026-08-20', close: 10 }, { date: '2026-08-21', close: 11 }] },
    { symbol: 'B', candles: [{ date: '2026-08-20', close: 20 }, { date: '2026-08-21', close: 18 }] },
  ]
  const outcome = calculateShadowOutcome(snapshot, datasets, '2026-08-21')
  assert.equal(outcome.portfolioReturnPct, 1)
  assert.equal(outcome.benchmarkReturnPct, 0)
  assert.equal(outcome.excessReturnPct, 1)
})
