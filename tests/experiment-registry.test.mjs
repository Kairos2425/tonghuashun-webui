import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ExperimentRegistryStore } from '../server/core/experiment-registry.mjs'

test('稳健性实验登记会保留试验次数、数据指纹和判定', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'stock-workbench-experiments-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new ExperimentRegistryStore(join(dir, 'experiments.json'))
  const saved = await store.record({
    modelId: 'cross-sectional-logistic-v1',
    dataFingerprint: 'sha256:test',
    universe: ['510300.SH', '510500.SH', '512100.SH', '588000.SH'],
    signalDate: '2026-08-21',
    verdict: 'FRAGILE',
    knownTrialCount: 9,
    checks: [{ id: 'cost', pass: false }],
  })
  assert.match(saved.experiment.id, /^[0-9a-f-]{36}$/)
  assert.equal(saved.experiment.knownTrialCount, 9)
  assert.equal(saved.experiment.verdict, 'FRAGILE')
  assert.equal((await store.get()).experiments.length, 1)
})
