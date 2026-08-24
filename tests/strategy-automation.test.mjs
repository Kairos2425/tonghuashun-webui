import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { StrategyAutomationStore } from '../server/core/strategy-automation.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stock-workbench-strategy-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return new StrategyAutomationStore(join(dir, 'automation.json'))
}

test('策略自动执行默认关闭且只允许模拟盘 ETF', async (t) => {
  const store = await fixture(t)
  assert.equal((await store.get()).enabled, false)
  const updated = await store.update({ enabled: true, mode: 'paper', symbol: '510300', maxOrderValue: 800 })
  assert.equal(updated.enabled, true)
  assert.equal(updated.mode, 'paper')
  assert.equal(updated.symbol, '510300.SH')
  assert.equal(updated.maxOrderValue, 800)

  await assert.rejects(() => store.update({ enabled: true, mode: 'live', symbol: '510300' }), /仅允许模拟盘/)
  await assert.rejects(() => store.update({ enabled: true, mode: 'paper', symbol: '600000' }), /仅允许场内 ETF/)
})

test('策略评估历史只保留最近记录并可追踪动作', async (t) => {
  const store = await fixture(t)
  await store.update({ enabled: true, symbol: '510300' })
  const recorded = await store.record({ signalDate: '2026-08-24', signal: 'BUY', action: 'BUY_EXECUTED', orderId: 'paper-1' })
  assert.equal(recorded.lastEvaluation.action, 'BUY_EXECUTED')
  assert.equal(recorded.history.length, 1)
  assert.equal(recorded.lastProcessedSignalDate, null)

  const processed = await store.record({ signalDate: '2026-08-25', signal: 'HOLD', action: 'NONE' }, { processed: true })
  assert.equal(processed.lastProcessedSignalDate, '2026-08-25')
})
