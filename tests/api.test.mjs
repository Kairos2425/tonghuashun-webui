import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const rootDir = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1)))

async function availablePort() {
  const probe = net.createServer()
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolveListen)
  })
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose) => probe.close(resolveClose))
  return port
}

async function startServer(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'stock-workbench-api-'))
  const port = await availablePort()
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: rootDir,
    env: {
      ...process.env,
      WORKBENCH_PORT: String(port),
      WORKBENCH_DATA_DIR: dataDir,
      MARKET_DATA_PROVIDER: 'demo',
      LIVE_TRADING_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })

  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`服务启动超时：${output}`)), 8_000)
    const check = (chunk) => {
      if (!String(chunk).includes(`127.0.0.1:${port}`)) return
      clearTimeout(timeout)
      child.stdout.off('data', check)
      resolveReady()
    }
    child.stdout.on('data', check)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`服务提前退出 ${code}：${output}`))
    })
  })

  t.after(async () => {
    if (!child.killed) child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ])
    await rm(dataDir, { recursive: true, force: true })
  })
  return { baseUrl: `http://127.0.0.1:${port}` }
}

function mutationHeaders(origin = 'http://127.0.0.1:4173') {
  return {
    'Content-Type': 'application/json',
    'X-Workbench-Request': '1',
    Origin: origin,
  }
}

test('本地 API 拒绝无工作台标记和外部 Origin 的写请求', async (t) => {
  const { baseUrl } = await startServer(t)
  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).localOnly, true)

  const missingMarker = await fetch(`${baseUrl}/api/portfolio/reset`, { method: 'POST' })
  assert.equal(missingMarker.status, 403)

  const externalOrigin = await fetch(`${baseUrl}/api/portfolio/reset`, {
    method: 'POST',
    headers: mutationHeaders('https://example.com'),
  })
  assert.equal(externalOrigin.status, 403)

  const localOrigin = await fetch(`${baseUrl}/api/portfolio/reset`, {
    method: 'POST',
    headers: mutationHeaders(),
  })
  assert.equal(localOrigin.status, 200)
})

test('君弘人工确认实盘完成预览、确认和审计回填链路', async (t) => {
  const { baseUrl } = await startServer(t)
  const previewResponse = await fetch(`${baseUrl}/api/orders/preview`, {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify({
      symbol: '510300.SH',
      side: 'BUY',
      price: 4.75,
      quantity: 100,
      broker: 'gtja-manual',
    }),
  })
  assert.equal(previewResponse.status, 200)
  const { preview } = await previewResponse.json()
  assert.equal(preview.ok, true)
  assert.equal(preview.order.mode, 'manual_live')
  assert.equal(preview.checks.some((check) => check.code === 'cash_unknown'), true)
  assert.equal(preview.checks.some((check) => check.code === 'quote_missing' && check.level === 'warn'), true)

  const submitResponse = await fetch(`${baseUrl}/api/orders/submit`, {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify({
      previewId: preview.id,
      confirmationText: preview.confirmationText,
    }),
  })
  assert.equal(submitResponse.status, 200)
  const { order } = await submitResponse.json()
  assert.equal(order.status, 'awaiting_broker_confirmation')

  const listed = await fetch(`${baseUrl}/api/manual-orders`).then((response) => response.json())
  assert.equal(listed.orders.length, 1)
  assert.equal(listed.orders[0].broker, 'gtja-manual')

  const reconcile = await fetch(`${baseUrl}/api/manual-orders/${order.id}/reconcile`, {
    method: 'POST',
    headers: mutationHeaders(),
    body: JSON.stringify({
      status: 'filled',
      fillPrice: 4.74,
      fillQuantity: 100,
      brokerOrderId: 'TEST-001',
    }),
  })
  assert.equal(reconcile.status, 200)
  assert.equal((await reconcile.json()).order.status, 'filled')
})
