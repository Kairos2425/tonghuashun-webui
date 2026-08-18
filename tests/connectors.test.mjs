import test from 'node:test'
import assert from 'node:assert/strict'
import { connectorStatuses } from '../server/core/connectors.mjs'

test('未安装富易时仍允许生成君弘 APP 人工确认草稿', async () => {
  const connectors = await connectorStatuses({ clientPathResolver: async () => null })
  const connector = connectors.find((item) => item.id === 'gtja-manual')

  assert.equal(connector.status, 'needs_client')
  assert.equal(connector.canSubmit, true)
  assert.match(connector.downloadUrl, /^https:\/\/fy\.gtht\.com\//)
  assert.match(connector.description, /君弘 APP/)
})

test('检测到富易后暴露客户端路径', async () => {
  const path = 'C:\\new_fuyi\\TdxW.exe'
  const connectors = await connectorStatuses({ clientPathResolver: async () => path })
  const connector = connectors.find((item) => item.id === 'gtja-manual')

  assert.equal(connector.status, 'ready')
  assert.equal(connector.clientPath, path)
})

test('官方桥接配置不能绕过实盘总开关', async (t) => {
  const previous = {
    url: process.env.GTJA_API_BRIDGE_URL,
    token: process.env.GTJA_API_BRIDGE_TOKEN,
    enabled: process.env.LIVE_TRADING_ENABLED,
  }
  t.after(() => {
    restoreEnv('GTJA_API_BRIDGE_URL', previous.url)
    restoreEnv('GTJA_API_BRIDGE_TOKEN', previous.token)
    restoreEnv('LIVE_TRADING_ENABLED', previous.enabled)
  })

  process.env.GTJA_API_BRIDGE_URL = 'http://127.0.0.1:9001'
  process.env.GTJA_API_BRIDGE_TOKEN = 'test-token'
  process.env.LIVE_TRADING_ENABLED = 'false'
  let connector = (await connectorStatuses({ clientPathResolver: async () => null })).find((item) => item.id === 'gtja-api')
  assert.equal(connector.status, 'configured')
  assert.equal(connector.canSubmit, false)

  process.env.LIVE_TRADING_ENABLED = 'true'
  connector = (await connectorStatuses({ clientPathResolver: async () => null })).find((item) => item.id === 'gtja-api')
  assert.equal(connector.canSubmit, true)
})

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
