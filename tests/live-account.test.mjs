import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LiveAccountStore } from '../server/core/live-account.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stock-workbench-live-account-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let current = new Date('2026-08-24T10:00:00+08:00')
  const file = join(dir, 'account.dpapi')
  const store = new LiveAccountStore(file, {
    protect: async (value) => Buffer.from(value, 'utf8').toString('base64'),
    unprotect: async (value) => Buffer.from(value, 'base64').toString('utf8'),
    now: () => current,
  })
  return { store, file, advanceDay: () => { current = new Date('2026-08-25T10:00:00+08:00') } }
}

test('君弘账户镜像加密保存并仅在当日作为新鲜数据', async (t) => {
  const { store, file, advanceDay } = await fixture(t)
  const empty = await store.get()
  assert.equal(empty.configured, false)

  const saved = await store.set({
    cash: 1_000.12,
    totalAssets: 5_000,
    positions: [{ symbol: '510300', name: '沪深300ETF', quantity: 200, availableQuantity: 100, avgCost: 4.7 }],
  })
  assert.equal(saved.configured, true)
  assert.equal(saved.fresh, true)
  assert.equal(saved.positions[0].symbol, '510300.SH')
  assert.doesNotMatch(await readFile(file, 'utf8'), /510300|1000\.12/)

  advanceDay()
  assert.equal((await store.get()).fresh, false)
})

test('账户镜像拒绝重复代码和超过持仓的可卖数量', async (t) => {
  const { store } = await fixture(t)
  await assert.rejects(() => store.set({
    cash: 100,
    totalAssets: 100,
    positions: [
      { symbol: '510300', quantity: 100, availableQuantity: 100, avgCost: 4.7 },
      { symbol: '510300.SH', quantity: 100, availableQuantity: 100, avgCost: 4.7 },
    ],
  }), /重复录入/)

  await assert.rejects(() => store.set({
    cash: 100,
    totalAssets: 100,
    positions: [{ symbol: '510300', quantity: 100, availableQuantity: 200, avgCost: 4.7 }],
  }), /不能超过持仓数量/)
})
