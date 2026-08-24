import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { SecretStore } from '../server/core/secrets.mjs'

test('环境变量中的 DeepSeek 密钥是只读且优先的', async (t) => {
  const previous = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = `sk-${'x'.repeat(32)}`
  t.after(() => {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
  })

  const store = new SecretStore(join(tmpdir(), `unused-deepseek-key-${process.pid}`))
  assert.deepEqual(await store.status(), { configured: true, source: 'environment', protected: true })
  assert.equal(await store.get(), process.env.DEEPSEEK_API_KEY)
  await assert.rejects(() => store.set(`sk-${'y'.repeat(32)}`), /启动环境中替换/)
  await assert.rejects(() => store.clear(), /启动环境中移除/)
})

test('Windows DPAPI 可以实际往返保存测试密钥', { skip: process.platform !== 'win32' }, async (t) => {
  const previous = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  const dir = await mkdtemp(join(tmpdir(), 'stock-workbench-dpapi-'))
  const file = join(dir, 'key.dpapi')
  t.after(async () => {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previous
    await rm(dir, { recursive: true, force: true })
  })

  const value = `sk-${'z'.repeat(32)}`
  const store = new SecretStore(file)
  await store.set(value)
  assert.equal(await store.get(), value)
  assert.doesNotMatch(await readFile(file, 'utf8'), /zzzzzz/)
  assert.equal((await store.status()).source, 'windows_dpapi')
})
