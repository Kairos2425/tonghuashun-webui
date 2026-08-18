import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ManualOrderStore } from '../server/core/manual-orders.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'stock-workbench-manual-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return new ManualOrderStore(join(dir, 'orders.json'), join(dir, 'audit.jsonl'))
}

const order = {
  symbol: '510300.SH',
  name: '沪深300ETF',
  side: 'BUY',
  price: 4.8,
  quantity: 200,
  mode: 'manual_live',
  broker: 'gtja-manual',
}

const preview = {
  id: 'preview-1',
  amount: 960,
  fees: { commission: 5, transfer: 0.01, stampDuty: 0, total: 5.01 },
}

test('君弘人工实盘草稿创建后保持待券商确认状态', async (t) => {
  const store = await fixture(t)
  const record = await store.create(order, preview)
  const records = await store.list()

  assert.equal(record.status, 'awaiting_broker_confirmation')
  assert.equal(records.length, 1)
  assert.equal(records[0].broker, 'gtja-manual')
})

test('成交回填拒绝超过委托数量或突破限价', async (t) => {
  const store = await fixture(t)
  const record = await store.create(order, preview)

  await assert.rejects(
    () => store.reconcile(record.id, { status: 'filled', fillPrice: 4.8, fillQuantity: 300 }),
    /不能超过/,
  )
  await assert.rejects(
    () => store.reconcile(record.id, { status: 'filled', fillPrice: 4.81, fillQuantity: 200 }),
    /不能高于/,
  )

  const sell = await store.create({ ...order, side: 'SELL' }, { ...preview, id: 'preview-2' })
  await assert.rejects(
    () => store.reconcile(sell.id, { status: 'filled', fillPrice: 4.79, fillQuantity: 200 }),
    /不能低于/,
  )
})

test('有效成交只允许回填一次并写入审计日志', async (t) => {
  const store = await fixture(t)
  const record = await store.create(order, preview)
  const filled = await store.reconcile(record.id, {
    status: 'filled',
    fillPrice: 4.79,
    fillQuantity: 200,
    brokerOrderId: 'GTJA-TEST-1',
  })

  assert.equal(filled.status, 'filled')
  assert.equal(filled.fillPrice, 4.79)
  assert.equal(filled.brokerOrderId, 'GTJA-TEST-1')
  await assert.rejects(
    () => store.reconcile(record.id, { status: 'cancelled' }),
    /不能重复修改/,
  )

  const audit = await readFile(store.auditPath, 'utf8')
  assert.match(audit, /manual_order_created/)
  assert.match(audit, /manual_order_reconciled/)
})

test('部分成交与全部成交使用不同状态', async (t) => {
  const store = await fixture(t)
  const partialRecord = await store.create(order, { ...preview, id: 'preview-partial' })
  const partial = await store.reconcile(partialRecord.id, {
    status: 'partially_filled',
    fillPrice: 4.79,
    fillQuantity: 100,
  })
  assert.equal(partial.status, 'partially_filled')
  assert.equal(partial.fillQuantity, 100)

  const fullRecord = await store.create(order, { ...preview, id: 'preview-full' })
  await assert.rejects(
    () => store.reconcile(fullRecord.id, { status: 'filled', fillPrice: 4.79, fillQuantity: 100 }),
    /请选择部分成交/,
  )
})
