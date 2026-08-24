import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCandles, getInstrument, getMarketSnapshot, getSecurityQuote, listInstruments, normalizeSymbol } from './core/market.mjs'
import { PaperBroker } from './core/paper-broker.mjs'
import { ManualOrderStore } from './core/manual-orders.mjs'
import { LiveAccountStore } from './core/live-account.mjs'
import { SecretStore } from './core/secrets.mjs'
import { createOrderPreview, DEFAULT_RISK_CONFIG, validateOrder } from './core/risk.mjs'
import { analyzeWithDeepSeek } from './core/deepseek.mjs'
import { connectorStatuses, launchGtjaClient, submitOfficialOrder } from './core/connectors.mjs'
import { loadLocalEnv } from './core/env.mjs'

const serverDir = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(serverDir, '..')
loadLocalEnv(join(rootDir, '.env.local'))
const dataDir = resolve(process.env.WORKBENCH_DATA_DIR || join(rootDir, '.data'))
const distDir = join(rootDir, 'dist')
const host = process.env.WORKBENCH_HOST || '127.0.0.1'
const port = numberFromEnv('WORKBENCH_PORT', 4174)
const liveEnabled = process.env.LIVE_TRADING_ENABLED === 'true'
const riskConfig = {
  ...DEFAULT_RISK_CONFIG,
  maxOrderValue: numberFromEnv('MAX_ORDER_VALUE', DEFAULT_RISK_CONFIG.maxOrderValue),
  maxDailyValue: numberFromEnv('MAX_DAILY_VALUE', DEFAULT_RISK_CONFIG.maxDailyValue),
}

const paperBroker = new PaperBroker(join(dataDir, 'paper-account.json'))
const manualOrders = new ManualOrderStore(join(dataDir, 'manual-orders.json'), join(dataDir, 'audit.jsonl'))
const liveAccount = new LiveAccountStore(join(dataDir, 'live-account.dpapi'))
const secrets = new SecretStore(join(dataDir, 'deepseek-key.dpapi'))
const previews = new Map()

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const server = createServer(async (request, response) => {
  try {
    enforceLocalRequest(request)
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`)
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url)
      return
    }
    await serveStatic(response, url.pathname)
  } catch (error) {
    const status = Number(error?.statusCode) || 500
    if (status >= 500) console.error(`[workbench] ${error?.stack || error}`)
    sendJson(response, status, { ok: false, error: error?.message || '服务器错误', ...(error?.downloadUrl ? { downloadUrl: error.downloadUrl } : {}) })
  }
})

server.listen(port, host, () => {
  console.log(`[workbench] http://${host}:${port}`)
  console.log(`[workbench] 实盘 API: ${liveEnabled ? '已启用' : '已锁定'} · 单笔上限 ¥${riskConfig.maxOrderValue}`)
})

async function handleApi(request, response, url) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) enforceMutationRequest(request)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const [market, connectors, deepseek, harness] = await Promise.all([
      getMarketSnapshot(),
      connectorStatuses(),
      secrets.status(),
      harnessStatus(),
    ])
    return sendJson(response, 200, {
      ok: true,
      version: '1.0.0',
      localOnly: host === '127.0.0.1',
      liveEnabled,
      riskConfig,
      market: { source: market.source, sourceKind: market.sourceKind, fetchedAt: market.fetchedAt, warning: market.warning ?? null },
      deepseek,
      harness,
      connectors,
    })
  }

  if (request.method === 'GET' && url.pathname === '/api/market') {
    const market = await getMarketSnapshot({ force: url.searchParams.get('refresh') === '1' })
    return sendJson(response, 200, { ok: true, instruments: listInstruments(), ...market })
  }

  if (request.method === 'GET' && url.pathname === '/api/market/candles') {
    const symbol = normalizeSymbol(url.searchParams.get('symbol'))
    if (!symbol) throw withStatus('证券代码格式无效', 400)
    const limit = Math.min(240, Math.max(20, Number(url.searchParams.get('limit')) || 80))
    return sendJson(response, 200, { ok: true, ...(await getCandles(symbol, limit)) })
  }

  if (request.method === 'GET' && url.pathname === '/api/market/quote') {
    const quote = await getSecurityQuote(url.searchParams.get('symbol'))
    return sendJson(response, 200, { ok: true, quote })
  }

  if (request.method === 'GET' && url.pathname === '/api/portfolio') {
    const market = await getMarketSnapshot()
    const portfolio = await paperBroker.portfolio(market.quotes)
    return sendJson(response, 200, { ok: true, portfolio })
  }

  if (request.method === 'GET' && url.pathname === '/api/live-account') {
    return sendJson(response, 200, { ok: true, account: await liveAccount.get() })
  }

  if (request.method === 'PUT' && url.pathname === '/api/live-account') {
    const account = await liveAccount.set(await readJsonBody(request))
    await manualOrders.audit('live_account_snapshot_updated', {
      tradingDate: account.tradingDate,
      positionsCount: account.positions.length,
      protected: true,
    })
    return sendJson(response, 200, { ok: true, account })
  }

  if (request.method === 'DELETE' && url.pathname === '/api/live-account') {
    const account = await liveAccount.clear()
    await manualOrders.audit('live_account_snapshot_cleared', { protected: true })
    return sendJson(response, 200, { ok: true, account })
  }

  if (request.method === 'POST' && url.pathname === '/api/portfolio/reset') {
    await paperBroker.reset()
    const market = await getMarketSnapshot()
    return sendJson(response, 200, { ok: true, portfolio: await paperBroker.portfolio(market.quotes) })
  }

  if (request.method === 'GET' && url.pathname === '/api/manual-orders') {
    return sendJson(response, 200, { ok: true, orders: await manualOrders.list() })
  }

  if (request.method === 'POST' && url.pathname.match(/^\/api\/manual-orders\/[^/]+\/reconcile$/)) {
    const id = decodeURIComponent(url.pathname.split('/')[3])
    const record = await manualOrders.reconcile(id, await readJsonBody(request))
    return sendJson(response, 200, { ok: true, order: record })
  }

  if (request.method === 'POST' && url.pathname === '/api/orders/preview') {
    const body = await readJsonBody(request)
    const market = await getMarketSnapshot({ force: true })
    const symbol = normalizeSymbol(body.symbol)
    const definition = getInstrument(symbol)
    let quote = market.quotes.find((item) => item.symbol === symbol) ?? market.indices.find((item) => item.symbol === symbol)
    if (!quote && definition?.tradable !== false) quote = await getSecurityQuote(symbol, { force: true })
    const instrument = definition ? { ...definition, name: quote?.name || definition.name } : null
    if (!instrument) throw withStatus('不支持的证券代码', 400)
    const connectors = await connectorStatuses()
    const connector = connectors.find((item) => item.id === body.broker)
    if (!connector) throw withStatus('交易通道无效', 400)
    const mode = connector.kind === 'paper' ? 'paper' : connector.kind === 'manual_live' ? 'manual_live' : 'live'
    const order = {
      ...body,
      symbol: instrument.symbol,
      name: instrument.name,
      broker: connector.id,
      mode,
    }
    const preview = createOrderPreview(order, await buildRiskContext(order, market, connector), riskConfig)
    previews.set(preview.id, { ...preview, used: false })
    await manualOrders.audit('order_previewed', { id: preview.id, order: preview.order, ok: preview.ok, checks: preview.checks })
    cleanupPreviews()
    return sendJson(response, 200, { ok: true, preview })
  }

  if (request.method === 'POST' && url.pathname === '/api/orders/submit') {
    const body = await readJsonBody(request)
    const preview = previews.get(String(body.previewId ?? ''))
    if (!preview) throw withStatus('订单预览不存在或服务已重启，请重新预览', 404)
    if (preview.used) throw withStatus('该订单预览已经使用', 409)
    if (preview.expiresAt < Date.now()) throw withStatus('订单预览已过期，请重新核价', 410)
    if (!preview.ok) throw withStatus('订单仍有阻断项，不能提交', 400)
    if (String(body.confirmationText ?? '') !== preview.confirmationText) throw withStatus('确认文本不匹配', 400)
    const market = await getMarketSnapshot({ force: true })
    const connector = (await connectorStatuses()).find((item) => item.id === preview.order.broker)
    if (!connector) throw withStatus('交易通道已不可用，请重新预览', 409)
    const latestValidation = validateOrder(preview.order, await buildRiskContext(preview.order, market, connector), riskConfig)
    const latestBlock = latestValidation.checks.find((item) => item.level === 'block')
    if (!latestValidation.ok) throw withStatus(`提交前复核未通过：${latestBlock?.message || '风险条件已变化'}`, 409)
    preview.used = true
    let result
    if (preview.order.mode === 'paper') {
      result = await paperBroker.execute(preview.order)
    } else if (preview.order.mode === 'manual_live') {
      result = await manualOrders.create(preview.order, preview)
    } else {
      result = await submitOfficialOrder(preview.order.broker, preview.order, body.confirmationText)
      await manualOrders.audit('official_order_submitted', { previewId: preview.id, order: preview.order, brokerResult: result })
    }
    return sendJson(response, 200, { ok: true, order: result })
  }

  if (request.method === 'POST' && url.pathname === '/api/connectors/gtja-manual/launch') {
    return sendJson(response, 200, { ok: true, ...(await launchGtjaClient()) })
  }

  if (request.method === 'GET' && url.pathname === '/api/settings/deepseek') {
    return sendJson(response, 200, { ok: true, ...(await secrets.status()) })
  }

  if (request.method === 'POST' && url.pathname === '/api/settings/deepseek') {
    const body = await readJsonBody(request)
    return sendJson(response, 200, { ok: true, ...(await secrets.set(body.apiKey)) })
  }

  if (request.method === 'DELETE' && url.pathname === '/api/settings/deepseek') {
    return sendJson(response, 200, { ok: true, ...(await secrets.clear()) })
  }

  if (request.method === 'POST' && url.pathname === '/api/ai/analyze') {
    const body = await readJsonBody(request)
    const market = await getMarketSnapshot()
    const symbol = normalizeSymbol(body.symbol)
    if (!symbol) throw withStatus('证券代码格式无效', 400)
    const definition = getInstrument(symbol)
    const quote = market.quotes.find((item) => item.symbol === symbol) ?? await getSecurityQuote(symbol)
    const instrument = definition ? { ...definition, name: quote.name || definition.name } : null
    const portfolio = await paperBroker.portfolio(market.quotes)
    const position = portfolio.positions.find((item) => item.symbol === symbol) ?? null
    const analysis = await analyzeWithDeepSeek({ key: await secrets.get(), question: body.question, instrument, quote, position, model: body.model })
    await manualOrders.audit('ai_analysis_created', { symbol, questionLength: String(body.question ?? '').length, model: analysis.model, usage: analysis.usage })
    return sendJson(response, 200, { ok: true, analysis })
  }

  throw withStatus('API 路径不存在', 404)
}

async function harnessStatus() {
  const packagePath = join(rootDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const installed = await stat(packagePath).then(() => true).catch(() => false)
  if (!installed) return { installed: false, running: false, url: 'http://127.0.0.1:3080' }
  try {
    const response = await fetch('http://127.0.0.1:3080/', { signal: AbortSignal.timeout(700), redirect: 'manual' })
    return { installed, running: response.status < 500, url: 'http://127.0.0.1:3080' }
  } catch {
    return { installed, running: false, url: 'http://127.0.0.1:3080' }
  }
}

async function serveStatic(response, pathname) {
  let relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
  relative = normalize(relative).replace(/^([/\\])+/, '')
  let target = resolve(distDir, relative)
  const targetRelative = relativePath(distDir, target)
  if (targetRelative.startsWith('..') || isAbsolute(targetRelative)) throw withStatus('无效路径', 400)
  try {
    if ((await stat(target)).isDirectory()) target = join(target, 'index.html')
    const content = await readFile(target)
    response.writeHead(200, securityHeaders({ 'Content-Type': mimeTypes[extname(target)] || 'application/octet-stream' }))
    response.end(content)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    const index = await readFile(join(distDir, 'index.html')).catch(() => null)
    if (!index) throw withStatus('前端尚未构建，请先运行 npm run build', 503)
    response.writeHead(200, securityHeaders({ 'Content-Type': mimeTypes['.html'] }))
    response.end(index)
  }
}

function enforceLocalRequest(request) {
  const remote = request.socket.remoteAddress
  if (remote && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) throw withStatus('只允许本机访问', 403)
  const hostHeader = String(request.headers.host ?? '').split(':')[0].toLowerCase()
  if (hostHeader && !['127.0.0.1', 'localhost', '[::1]'].includes(hostHeader)) throw withStatus('Host 不受信任', 403)
}

function enforceMutationRequest(request) {
  if (request.headers['x-workbench-request'] !== '1') throw withStatus('写操作缺少本机工作台标记', 403)
  const origin = String(request.headers.origin ?? '')
  if (!origin) return
  let hostname
  try {
    hostname = new URL(origin).hostname.toLowerCase()
  } catch {
    throw withStatus('Origin 无效', 403)
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) throw withStatus('拒绝来自外部网页的写操作', 403)
}

async function buildRiskContext(order, market, connector) {
  let quote = market.quotes.find((item) => item.symbol === order.symbol) ?? null
  if (!quote || (order.mode !== 'paper' && market.sourceKind !== 'public_reference')) {
    quote = await getSecurityQuote(order.symbol, { force: true, allowDemo: order.mode === 'paper' }).catch(() => null)
  }
  const instrument = getInstrument(order.symbol)
  const base = {
    quotePrice: quote?.price,
    priceTick: instrument?.priceTick,
    lotSize: instrument?.lotSize,
    quantityRule: instrument?.quantityRule,
    tradable: instrument?.tradable,
    liveEnabled,
    brokerConnected: connector.canSubmit,
  }
  if (order.mode === 'paper') {
    const portfolio = await paperBroker.portfolio(market.quotes)
    const position = portfolio.positions.find((item) => item.symbol === order.symbol)
    return {
      ...base,
      availableCash: portfolio.cash,
      availableQuantity: position?.availableQuantity ?? 0,
      totalAssets: portfolio.totalAssets,
      currentPositionValue: position?.marketValue ?? 0,
      dailyValue: portfolio.orders
        .filter((item) => tradingDate(item.submittedAt) === tradingDate())
        .reduce((sum, item) => sum + Number(item.amount || 0), 0),
    }
  }
  const records = await manualOrders.list()
  const liveSnapshot = order.mode === 'manual_live' ? await liveAccount.get() : null
  const mirroredPosition = liveSnapshot?.fresh
    ? liveSnapshot.positions.find((item) => item.symbol === order.symbol)
    : null
  return {
    ...base,
    accountSnapshotConfigured: Boolean(liveSnapshot?.configured),
    accountSnapshotFresh: Boolean(liveSnapshot?.fresh),
    ...(liveSnapshot?.fresh ? {
      accountSource: 'manual_gtja',
      availableCash: liveSnapshot.cash,
      availableQuantity: mirroredPosition?.availableQuantity ?? 0,
      totalAssets: liveSnapshot.totalAssets,
      currentPositionValue: mirroredPosition
        ? mirroredPosition.quantity * (quote?.price ?? mirroredPosition.avgCost)
        : 0,
    } : {}),
    dailyValue: records
      .filter((item) => item.broker === order.broker)
      .filter((item) => !['cancelled', 'rejected'].includes(item.status))
      .filter((item) => tradingDate(item.submittedAt) === tradingDate())
      .reduce((sum, item) => sum + (item.status === 'partially_filled_cancelled'
        ? Number(item.fillPrice || 0) * Number(item.fillQuantity || 0)
        : Number(item.amount || 0)), 0),
  }
}

function tradingDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date)
}

function relativePath(from, to) {
  return relative(from, to)
}

async function readJsonBody(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 256 * 1024) throw withStatus('请求内容过大', 413)
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw withStatus('JSON 格式无效', 400)
  }
}

function sendJson(response, status, payload) {
  if (response.headersSent) return
  response.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }))
  response.end(JSON.stringify(payload))
}

function securityHeaders(extra = {}) {
  return {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:*; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra,
  }
}

function cleanupPreviews() {
  for (const [id, preview] of previews) {
    if (preview.expiresAt < Date.now() - 60_000 || preview.used) previews.delete(id)
  }
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
