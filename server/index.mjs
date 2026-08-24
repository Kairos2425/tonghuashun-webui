import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getCandles, getInstrument, getMarketSnapshot, getSecurityQuote, listInstruments, normalizeSymbol } from './core/market.mjs'
import { PaperBroker } from './core/paper-broker.mjs'
import { ManualOrderStore } from './core/manual-orders.mjs'
import { LiveAccountStore } from './core/live-account.mjs'
import { SecretStore } from './core/secrets.mjs'
import { createOrderPreview, DEFAULT_RISK_CONFIG, estimateFees, validateOrder } from './core/risk.mjs'
import { analyzeWithDeepSeek } from './core/deepseek.mjs'
import { connectorStatuses, launchGtjaClient, submitOfficialOrder } from './core/connectors.mjs'
import { loadLocalEnv } from './core/env.mjs'
import { analyzeRelativeValue, onlyCompletedDailyCandles, runCrossSectionalBacktest, runCrossSectionalRobustness, runMlBacktest } from './core/quant-research.mjs'
import { StrategyAutomationStore } from './core/strategy-automation.mjs'
import { calculateShadowOutcome, DEFAULT_ETF_UNIVERSE, ShadowPortfolioStore, validateUniverse } from './core/shadow-portfolio.mjs'
import { ExperimentRegistryStore } from './core/experiment-registry.mjs'

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
const strategyAutomation = new StrategyAutomationStore(join(dataDir, 'strategy-automation.json'))
const shadowPortfolio = new ShadowPortfolioStore(join(dataDir, 'quant-shadow.json'))
const experimentRegistry = new ExperimentRegistryStore(join(dataDir, 'quant-experiments.json'))
const secrets = new SecretStore(join(dataDir, 'deepseek-key.dpapi'))
const previews = new Map()
let automationRunPromise = null

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

const automationTimer = setInterval(() => {
  void runStrategyAutomation().catch((error) => console.error(`[quant] 自动评估失败：${error?.message || error}`))
}, 60_000)
automationTimer.unref()
setTimeout(() => void runStrategyAutomation().catch(() => {}), 5_000).unref()

const shadowTimer = setInterval(() => {
  void captureShadowPortfolio().catch((error) => console.error(`[quant] 影子组合更新失败：${error?.message || error}`))
}, 5 * 60_000)
shadowTimer.unref()
setTimeout(() => void captureShadowPortfolio().catch(() => {}), 8_000).unref()

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

  if (request.method === 'POST' && url.pathname === '/api/quant/backtest') {
    const body = await readJsonBody(request)
    const symbol = normalizeSymbol(body.symbol)
    const instrument = getInstrument(symbol)
    if (!symbol || !instrument?.tradable) throw withStatus('量化研究仅支持已识别的 A 股或场内基金', 400)
    const candleResult = await getCandles(symbol, 500)
    if (candleResult.source !== '腾讯公开行情') throw withStatus('公开历史行情不可用，拒绝使用演示数据生成量化结论', 503)
    const result = runMlBacktest(candleResult.candles, { ...body, quantityRule: instrument.quantityRule })
    await manualOrders.audit('quant_backtest_created', {
      symbol,
      model: result.model.id,
      outOfSampleSamples: result.model.outOfSampleSamples,
      completedTrades: result.metrics.completedTrades,
    })
    return sendJson(response, 200, { ok: true, symbol, source: candleResult.source, fetchedAt: candleResult.fetchedAt, result })
  }

  if (request.method === 'GET' && url.pathname === '/api/quant/relative-value') {
    const left = normalizeSymbol(url.searchParams.get('left'))
    const right = normalizeSymbol(url.searchParams.get('right'))
    if (!left || !right || left === right) throw withStatus('请输入两个不同的证券代码', 400)
    const pairInstruments = [getInstrument(left), getInstrument(right)]
    if (pairInstruments.some((item) => !item?.tradable || !String(item.kind).includes('ETF'))) throw withStatus('相对价值监控第一阶段仅支持两个场内 ETF', 400)
    const [leftCandles, rightCandles] = await Promise.all([getCandles(left, 500), getCandles(right, 500)])
    if ([leftCandles, rightCandles].some((item) => item.source !== '腾讯公开行情')) throw withStatus('公开历史行情不可用，拒绝使用演示数据计算价差', 503)
    return sendJson(response, 200, {
      ok: true,
      left,
      right,
      source: '腾讯公开行情',
      result: analyzeRelativeValue(leftCandles.candles, rightCandles.candles, {
        window: url.searchParams.get('window'),
        threshold: url.searchParams.get('threshold'),
      }),
    })
  }

  if (request.method === 'GET' && url.pathname === '/api/quant/universe') {
    return sendJson(response, 200, { ok: true, universe: DEFAULT_ETF_UNIVERSE })
  }

  if (request.method === 'POST' && url.pathname === '/api/quant/cross-sectional') {
    const body = await readJsonBody(request)
    const research = await loadCrossSectionalResearch(body.symbols, body)
    await manualOrders.audit('quant_cross_sectional_backtest_created', {
      universe: research.symbols,
      model: research.result.model.id,
      outOfSampleDates: research.result.model.outOfSampleDates,
      rebalanceCount: research.result.metrics.rebalanceCount,
    })
    return sendJson(response, 200, { ok: true, source: '腾讯公开行情', symbols: research.symbols, result: research.result })
  }

  if (request.method === 'POST' && url.pathname === '/api/quant/robustness') {
    const body = await readJsonBody(request)
    const research = await loadCrossSectionalResearch(body.symbols, body)
    const robustness = runCrossSectionalRobustness(research.datasets, {
      topK: body.topK,
      maxWeight: body.maxWeight,
    })
    const saved = await experimentRegistry.record({
      modelId: robustness.modelId,
      dataFingerprint: fingerprintDatasets(research.datasets),
      universe: research.symbols,
      signalDate: robustness.base.current.date,
      verdict: robustness.verdict,
      knownTrialCount: robustness.knownTrialCount,
      selectionBiasNotice: robustness.selectionBiasNotice,
      summary: robustness.summary,
      checks: robustness.checks,
      baseMetrics: robustness.base.metrics,
    })
    await manualOrders.audit('quant_robustness_experiment_recorded', {
      experimentId: saved.experiment.id,
      verdict: saved.experiment.verdict,
      knownTrialCount: saved.experiment.knownTrialCount,
      dataFingerprint: saved.experiment.dataFingerprint,
    })
    return sendJson(response, 200, { ok: true, source: '腾讯公开行情', robustness, experiment: saved.experiment, registryCount: saved.registry.experiments.length })
  }

  if (request.method === 'GET' && url.pathname === '/api/quant/experiments') {
    return sendJson(response, 200, { ok: true, ...(await experimentRegistry.get()) })
  }

  if (request.method === 'GET' && url.pathname === '/api/quant/shadow') {
    return sendJson(response, 200, { ok: true, shadow: await shadowPortfolio.get(), tradingLocked: true })
  }

  if (request.method === 'PUT' && url.pathname === '/api/quant/shadow') {
    const shadow = await shadowPortfolio.update(await readJsonBody(request))
    await manualOrders.audit('quant_shadow_updated', { enabled: shadow.enabled, universe: shadow.universe })
    return sendJson(response, 200, { ok: true, shadow, tradingLocked: true })
  }

  if (request.method === 'POST' && url.pathname === '/api/quant/shadow/capture') {
    return sendJson(response, 200, { ok: true, capture: await captureShadowPortfolio({ force: true }), shadow: await shadowPortfolio.get(), tradingLocked: true })
  }

  if (request.method === 'GET' && url.pathname === '/api/quant/automation') {
    return sendJson(response, 200, { ok: true, automation: await strategyAutomation.get(), liveAutomationLocked: true })
  }

  if (request.method === 'PUT' && url.pathname === '/api/quant/automation') {
    const automation = await strategyAutomation.update(await readJsonBody(request))
    await manualOrders.audit('quant_automation_updated', {
      enabled: automation.enabled,
      mode: automation.mode,
      symbol: automation.symbol,
      strategyId: automation.strategyId,
    })
    return sendJson(response, 200, { ok: true, automation, liveAutomationLocked: true })
  }

  if (request.method === 'POST' && url.pathname === '/api/quant/automation/run') {
    return sendJson(response, 200, { ok: true, evaluation: await runStrategyAutomation({ force: true }) })
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

async function runStrategyAutomation({ force = false } = {}) {
  if (automationRunPromise) return automationRunPromise
  automationRunPromise = runStrategyAutomationUnlocked({ force }).finally(() => { automationRunPromise = null })
  return automationRunPromise
}

async function runStrategyAutomationUnlocked({ force }) {
  const config = await strategyAutomation.get()
  if (!config.enabled) return { status: 'disabled', message: '模拟盘自动执行未启用' }
  if (config.mode !== 'paper') throw withStatus('实盘自动执行保持锁定', 423)
  const window = paperExecutionWindow()
  if (!window.open && !force) return { status: 'sleeping', message: window.message, executionWindow: window.label }
  if (!force && config.lastEvaluation?.at) {
    const elapsed = Date.now() - new Date(config.lastEvaluation.at).getTime()
    if (Number.isFinite(elapsed) && elapsed < config.evaluationIntervalMinutes * 60_000) {
      return { status: 'waiting', message: '尚未到下一次评估时间', nextInMs: config.evaluationIntervalMinutes * 60_000 - elapsed }
    }
  }

  const instrument = getInstrument(config.symbol)
  const candleResult = await getCandles(config.symbol, 500)
  if (candleResult.source !== '腾讯公开行情') {
    const evaluation = { status: 'blocked', signalDate: null, signal: 'HOLD', reason: '公开历史行情不可用' }
    await strategyAutomation.record(evaluation)
    return evaluation
  }
  const research = runMlBacktest(candleResult.candles, {
    buyThreshold: config.buyThreshold,
    sellThreshold: config.sellThreshold,
    maxOrderValue: Math.min(config.maxOrderValue, riskConfig.maxOrderValue),
    quantityRule: instrument.quantityRule,
  })
  if (config.lastProcessedSignalDate === research.current.date) {
    return { status: 'already_evaluated', message: '该信号日期已经处理，不重复下单', ...config.lastEvaluation }
  }
  if (!window.open) {
    return {
      status: 'preview',
      signalDate: research.current.date,
      signal: research.current.signal,
      probability: research.current.probability,
      action: 'WINDOW_CLOSED',
      reason: window.message,
      executionWindow: window.label,
    }
  }

  const market = await getMarketSnapshot({ force: true })
  if (market.sourceKind !== 'public_reference') {
    const evaluation = { status: 'blocked', signalDate: research.current.date, signal: research.current.signal, probability: research.current.probability, reason: '实时公开行情不可用' }
    await strategyAutomation.record(evaluation)
    return evaluation
  }
  const quote = market.quotes.find((item) => item.symbol === config.symbol) ?? await getSecurityQuote(config.symbol, { force: true, allowDemo: false })
  if (tradingDate(quote.quoteTime) !== tradingDate()) {
    const evaluation = { status: 'blocked', signalDate: research.current.date, signal: research.current.signal, probability: research.current.probability, action: 'BLOCKED', reason: '实时行情日期不是今日，可能为休市日或行情停更' }
    await strategyAutomation.record(evaluation)
    return evaluation
  }
  const portfolio = await paperBroker.portfolio(market.quotes)
  const position = portfolio.positions.find((item) => item.symbol === config.symbol)
  let action = 'NONE'
  let reason = research.current.explanation
  let order = null

  if (research.current.signal === 'BUY' && !position) {
    const budget = Math.min(config.maxOrderValue, riskConfig.maxOrderValue, portfolio.cash)
    const quantity = automationBuyQuantity(budget, quote.price, instrument.quantityRule)
    if (quantity > 0) {
      const candidate = { symbol: config.symbol, name: quote.name, side: 'BUY', price: roundToTick(quote.price, instrument.priceTick), quantity, mode: 'paper', broker: 'paper' }
      const validation = validateOrder(candidate, await buildRiskContext(candidate, market, { canSubmit: true }), riskConfig)
      if (validation.ok) {
        order = await paperBroker.execute(validation.order)
        action = 'BUY_EXECUTED'
      } else {
        action = 'BLOCKED'
        reason = validation.checks.find((item) => item.level === 'block')?.message || '模拟盘风控未通过'
      }
    } else {
      action = 'BLOCKED'
      reason = '单笔上限与可用资金不足以满足最低申报数量'
    }
  } else if (research.current.signal === 'SELL' && position) {
    if (position.availableQuantity > 0) {
      const candidate = { symbol: config.symbol, name: quote.name, side: 'SELL', price: roundToTick(quote.price, instrument.priceTick), quantity: position.availableQuantity, mode: 'paper', broker: 'paper' }
      const validation = validateOrder(candidate, await buildRiskContext(candidate, market, { canSubmit: true }), riskConfig)
      if (validation.ok) {
        order = await paperBroker.execute(validation.order)
        action = 'SELL_EXECUTED'
      } else {
        action = 'BLOCKED'
        reason = validation.checks.find((item) => item.level === 'block')?.message || '模拟盘风控未通过'
      }
    } else {
      action = 'WAIT_T1'
      reason = '持仓当日不可卖，等待 T+1'
    }
  } else if (research.current.signal === 'BUY' && position) {
    action = 'HOLD_POSITION'
    reason = '已有该 ETF 持仓，不重复加仓'
  } else if (research.current.signal === 'SELL' && !position) {
    action = 'NO_POSITION'
    reason = '当前没有该 ETF 持仓，无需卖出'
  }

  const evaluation = {
    status: 'evaluated',
    signalDate: research.current.date,
    signal: research.current.signal,
    probability: research.current.probability,
    action,
    reason,
    orderId: order?.id ?? null,
  }
  await strategyAutomation.record(evaluation, { processed: true })
  await manualOrders.audit('quant_paper_automation_evaluated', evaluation)
  return evaluation
}

function automationBuyQuantity(budget, price, rule = {}) {
  const minimum = Math.max(1, Number(rule.buyMin) || 100)
  const step = Math.max(1, Number(rule.buyStep) || 100)
  const maximum = Math.floor((budget - estimateFees({ side: 'BUY', price, quantity: minimum }).total) / price)
  if (maximum < minimum) return 0
  return minimum + Math.floor((maximum - minimum) / step) * step
}

function roundToTick(value, tick = 0.01) {
  const units = Math.round(value / tick)
  const digits = tick < 0.01 ? 3 : 2
  return Number((units * tick).toFixed(digits))
}

function paperExecutionWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekday = values.weekday
  const minutes = Number(values.hour) * 60 + Number(values.minute)
  const weekdayOpen = !['Sat', 'Sun'].includes(weekday)
  const open = weekdayOpen && minutes >= 9 * 60 + 35 && minutes <= 9 * 60 + 50
  return {
    open,
    label: '交易日 09:35–09:50（北京时间）',
    message: weekdayOpen ? '当前不在模拟盘自动执行窗口，仅返回信号预览' : '周末不执行策略，仅返回信号预览',
  }
}

async function loadCrossSectionalResearch(inputSymbols, options = {}) {
  const symbols = validateUniverse(inputSymbols?.length ? inputSymbols : DEFAULT_ETF_UNIVERSE.map((item) => item.symbol))
  const defaults = new Map(DEFAULT_ETF_UNIVERSE.map((item) => [item.symbol, item]))
  const datasets = []
  for (const symbol of symbols) {
    const instrument = getInstrument(symbol)
    let candles = await getCandles(symbol, 500, { force: true })
    if (candles.source !== '腾讯公开行情') candles = await getCandles(symbol, 500, { force: true })
    if (candles.source !== '腾讯公开行情') throw withStatus(`${symbol} 的公开历史行情不可用，拒绝使用演示数据`, 503)
    datasets.push({
      symbol,
      name: defaults.get(symbol)?.name ?? instrument.name,
      quantityRule: instrument.quantityRule,
      candles: candles.candles,
    })
  }
  return {
    symbols,
    datasets,
    result: runCrossSectionalBacktest(datasets, {
      topK: options.topK,
      rebalanceEvery: options.rebalanceEvery,
      maxWeight: options.maxWeight,
      maxOrderValue: Math.min(Number(options.maxOrderValue) || riskConfig.maxOrderValue, riskConfig.maxOrderValue),
      slippageBps: options.slippageBps,
    }),
  }
}

async function captureShadowPortfolio({ force = false } = {}) {
  let state = await shadowPortfolio.get()
  if (!state.enabled && !force) return { status: 'disabled', message: '影子组合未启用' }
  const window = shadowCaptureWindow()
  if (!window.open && !force) return { status: 'sleeping', message: window.message }
  const research = await loadCrossSectionalResearch(state.universe)
  if (state.lastSnapshot?.date === research.result.current.date) {
    return { status: 'already_captured', message: '该信号日期已有影子快照', snapshot: state.lastSnapshot }
  }
  if (state.lastSnapshot && !state.lastSnapshot.outcome) {
    const outcome = calculateShadowOutcome(state.lastSnapshot, research.datasets, research.result.current.date)
    if (outcome) state = await shadowPortfolio.settle(state.lastSnapshot.date, outcome)
  }
  const snapshot = {
    status: 'captured',
    date: research.result.current.date,
    modelId: research.result.model.id,
    universe: research.symbols,
    targets: research.result.current.targets,
    cashWeight: research.result.current.cashWeight,
    ranking: research.result.current.ranking,
    metrics: {
      totalReturnPct: research.result.metrics.totalReturnPct,
      excessReturnPct: research.result.metrics.excessReturnPct,
      maxDrawdownPct: research.result.metrics.maxDrawdownPct,
      turnoverPct: research.result.metrics.turnoverPct,
      estimatedCosts: research.result.metrics.estimatedCosts,
    },
  }
  await shadowPortfolio.record(snapshot)
  await manualOrders.audit('quant_shadow_captured', {
    date: snapshot.date,
    modelId: snapshot.modelId,
    universe: snapshot.universe,
    targets: snapshot.targets.map((item) => ({ symbol: item.symbol, weight: item.weight })),
  })
  return snapshot
}

function fingerprintDatasets(datasets) {
  const payload = datasets.map((dataset) => ({
    symbol: dataset.symbol,
    candles: onlyCompletedDailyCandles(dataset.candles).map((row) => [row.date, row.open, row.close, row.high, row.low, row.volume]),
  }))
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`
}


function shadowCaptureWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const minutes = Number(values.hour) * 60 + Number(values.minute)
  const weekdayOpen = !['Sat', 'Sun'].includes(values.weekday)
  return {
    open: weekdayOpen && minutes >= 15 * 60 + 10,
    message: weekdayOpen ? '收盘后 15:10 才自动记录影子组合' : '周末不自动记录影子组合',
  }
}
