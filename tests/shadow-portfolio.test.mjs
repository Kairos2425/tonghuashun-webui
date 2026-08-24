import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_ETF_UNIVERSE, ShadowPortfolioStore, validateUniverse } from '../server/core/shadow-portfolio.mjs'

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
