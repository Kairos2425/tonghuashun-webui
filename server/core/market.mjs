const WATCHLIST = [
  { symbol: '510300.SH', providerCode: 'sh510300', name: '沪深300ETF', kind: '宽基 ETF', exchange: '上海', risk: '中', priceTick: 0.001, lotSize: 100, tradable: true },
  { symbol: '159919.SZ', providerCode: 'sz159919', name: '沪深300ETF', kind: '宽基 ETF', exchange: '深圳', risk: '中', priceTick: 0.001, lotSize: 100, tradable: true },
  { symbol: '510500.SH', providerCode: 'sh510500', name: '中证500ETF', kind: '宽基 ETF', exchange: '上海', risk: '中高', priceTick: 0.001, lotSize: 100, tradable: true },
  { symbol: '159915.SZ', providerCode: 'sz159915', name: '创业板ETF', kind: '宽基 ETF', exchange: '深圳', risk: '高', priceTick: 0.001, lotSize: 100, tradable: true },
  { symbol: '600519.SH', providerCode: 'sh600519', name: '贵州茅台', kind: 'A 股', exchange: '上海', risk: '高', priceTick: 0.01, lotSize: 100, tradable: true },
  { symbol: '000001.SZ', providerCode: 'sz000001', name: '平安银行', kind: 'A 股', exchange: '深圳', risk: '高', priceTick: 0.01, lotSize: 100, tradable: true },
]

const INDICES = [
  { symbol: '000001.SH', providerCode: 'sh000001', name: '上证指数' },
  { symbol: '399001.SZ', providerCode: 'sz399001', name: '深证成指' },
  { symbol: '399006.SZ', providerCode: 'sz399006', name: '创业板指' },
]

let quoteCache = { expiresAt: 0, data: null }
const candleCache = new Map()
const securityQuoteCache = new Map()

function asNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function decodeTencent(buffer) {
  try {
    return new TextDecoder('gb18030').decode(buffer)
  } catch {
    return new TextDecoder().decode(buffer)
  }
}

function parseTencentLine(line, definitions) {
  const match = line.match(/^v_([^=]+)="(.*)";?$/)
  if (!match) return null
  const providerCode = match[1]
  const fields = match[2].split('~')
  const definition = definitions.find((item) => item.providerCode === providerCode)
  if (!definition || fields.length < 35) return null
  const price = asNumber(fields[3])
  const prevClose = asNumber(fields[4])
  return {
    ...definition,
    name: fields[1] || definition.name,
    price,
    prevClose,
    open: asNumber(fields[5], prevClose),
    high: asNumber(fields[33], price),
    low: asNumber(fields[34], price),
    change: asNumber(fields[31], price - prevClose),
    changePct: asNumber(fields[32], prevClose ? ((price - prevClose) / prevClose) * 100 : 0),
    volume: asNumber(fields[36], asNumber(fields[6])),
    turnoverWan: asNumber(fields[37]),
    quoteTime: parseQuoteTime(fields[30]),
  }
}

function parseQuoteTime(value) {
  if (!/^\d{14}$/.test(value ?? '')) return new Date().toISOString()
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+08:00`
}

async function fetchTencentDefinitions(definitions) {
  const codes = definitions.map((item) => item.providerCode).join(',')
  const response = await fetch(`https://qt.gtimg.cn/q=${codes}`, {
    headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0 StockWorkbench/1.0' },
    signal: AbortSignal.timeout(4_500),
  })
  if (!response.ok) throw new Error(`行情服务返回 HTTP ${response.status}`)
  const text = decodeTencent(await response.arrayBuffer())
  const parsed = text.split(/\r?\n/).map((line) => parseTencentLine(line.trim(), definitions)).filter(Boolean)
  if (parsed.length < Math.min(3, definitions.length)) throw new Error('行情字段不完整')
  return parsed
}

async function fetchTencentQuotes() {
  const definitions = [...WATCHLIST, ...INDICES]
  const parsed = await fetchTencentDefinitions(definitions)
  return {
    source: '腾讯公开行情',
    sourceKind: 'public_reference',
    delayed: true,
    fetchedAt: new Date().toISOString(),
    quotes: parsed.filter((item) => WATCHLIST.some((watch) => watch.symbol === item.symbol)),
    indices: parsed.filter((item) => INDICES.some((index) => index.symbol === item.symbol)),
  }
}

function fallbackQuotes(error) {
  const minute = Math.floor(Date.now() / 60_000)
  const quotes = WATCHLIST.map((item, index) => {
    const base = [4.756, 4.966, 7.186, 2.712, 1_457.3, 11.82][index]
    const wave = Math.sin((minute + index * 13) / 17) * base * 0.006
    const price = round(base + wave, base > 100 ? 2 : 3)
    return {
      ...item,
      price,
      prevClose: base,
      open: round(base * (1 + (index % 2 ? 0.002 : -0.001)), base > 100 ? 2 : 3),
      high: round(Math.max(base, price) * 1.006, base > 100 ? 2 : 3),
      low: round(Math.min(base, price) * 0.994, base > 100 ? 2 : 3),
      change: round(price - base, base > 100 ? 2 : 3),
      changePct: round(((price - base) / base) * 100, 2),
      volume: 0,
      turnoverWan: 0,
      quoteTime: new Date().toISOString(),
    }
  })
  return {
    source: '本地演示行情',
    sourceKind: 'demo',
    delayed: true,
    fetchedAt: new Date().toISOString(),
    warning: error ? `公开行情不可用，已回退演示数据：${error.message}` : '演示数据',
    quotes,
    indices: [],
  }
}

export async function getMarketSnapshot({ force = false } = {}) {
  if (!force && quoteCache.data && quoteCache.expiresAt > Date.now()) return quoteCache.data
  let data
  if ((process.env.MARKET_DATA_PROVIDER ?? 'tencent') === 'demo') {
    data = fallbackQuotes()
  } else {
    try {
      data = await fetchTencentQuotes()
    } catch (error) {
      data = fallbackQuotes(error)
    }
  }
  quoteCache = { data, expiresAt: Date.now() + 10_000 }
  return data
}

export async function getCandles(symbol, limit = 80) {
  const definition = definitionForSymbol(symbol)
  if (!definition) throw new Error('不支持的证券代码')
  const isBuiltIn = WATCHLIST.some((item) => item.symbol === definition.symbol)
  const cacheKey = `${symbol}:${limit}`
  const cached = candleCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  try {
    const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${definition.providerCode},day,,,${Math.min(240, Math.max(20, limit))},qfq`, {
      headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0 StockWorkbench/1.0' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`K 线服务返回 HTTP ${response.status}`)
    const payload = await response.json()
    const rows = payload?.data?.[definition.providerCode]?.qfqday ?? payload?.data?.[definition.providerCode]?.day
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('K 线数据为空')
    const data = rows.map((row) => ({
      date: row[0],
      open: asNumber(row[1]),
      close: asNumber(row[2]),
      high: asNumber(row[3]),
      low: asNumber(row[4]),
      volume: asNumber(row[5]),
    }))
    const result = { symbol, source: '腾讯公开行情', adjusted: '前复权', fetchedAt: new Date().toISOString(), candles: data }
    candleCache.set(cacheKey, { data: result, expiresAt: Date.now() + 5 * 60_000 })
    return result
  } catch (error) {
    if (!isBuiltIn) throw withStatus(`无法取得 ${definition.symbol} 的公开 K 线，请稍后重试并以券商为准`, 503)
    const result = { symbol, source: '本地演示行情', adjusted: '演示', fetchedAt: new Date().toISOString(), warning: error.message, candles: generateFallbackCandles(symbol, limit) }
    candleCache.set(cacheKey, { data: result, expiresAt: Date.now() + 60_000 })
    return result
  }
}

export function getInstrument(symbol) {
  return definitionForSymbol(symbol)
}

export function listInstruments() {
  return WATCHLIST.map(({ providerCode: _providerCode, ...item }) => item)
}

export function normalizeSymbol(input) {
  const raw = String(input ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(raw)) return raw
  if (!/^\d{6}$/.test(raw)) return null
  if (/^(4|8|920)/.test(raw)) return `${raw}.BJ`
  if (/^(5|6|9)/.test(raw)) return `${raw}.SH`
  return `${raw}.SZ`
}

export async function getSecurityQuote(input, { force = false, allowDemo = true } = {}) {
  const symbol = normalizeSymbol(input)
  if (!symbol) throw withStatus('请输入 6 位证券代码，可选加 .SH、.SZ 或 .BJ', 400)
  const builtInSnapshot = quoteCache.data
  const builtIn = !force && quoteCache.expiresAt > Date.now()
    ? builtInSnapshot?.quotes?.find((item) => item.symbol === symbol)
    : null
  if (builtIn) return builtIn
  const cached = securityQuoteCache.get(symbol)
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data
  const definition = definitionForSymbol(symbol)
  if ((process.env.MARKET_DATA_PROVIDER ?? 'tencent') === 'demo') {
    if (!allowDemo) throw withStatus('当前只有演示行情，不能作为实盘核价依据', 503)
    const demo = fallbackQuotes().quotes.find((item) => item.symbol === symbol)
    if (demo) return demo
    throw withStatus('演示行情不为自定义证券生成虚假报价', 503)
  }
  try {
    const [quote] = await fetchTencentDefinitions([definition])
    if (!quote || quote.price <= 0) throw new Error('行情字段不完整')
    securityQuoteCache.set(symbol, { data: quote, expiresAt: Date.now() + 10_000 })
    return quote
  } catch (error) {
    throw withStatus(`无法取得 ${symbol} 的公开行情：${error.message}`, 503)
  }
}

function definitionForSymbol(input) {
  const symbol = normalizeSymbol(input)
  if (!symbol) return null
  const builtIn = WATCHLIST.find((item) => item.symbol === symbol)
  if (builtIn) return builtIn
  const index = INDICES.find((item) => item.symbol === symbol)
  if (index) {
    return {
      ...index,
      kind: '指数',
      exchange: symbol.endsWith('.SH') ? '上海' : '深圳',
      risk: '仅观察',
      priceTick: 0.01,
      lotSize: 0,
      tradable: false,
    }
  }
  const [code, market] = symbol.split('.')
  const isFund = (market === 'SH' && /^5/.test(code)) || (market === 'SZ' && /^(15|16|18)/.test(code))
  const isAshare = (market === 'SH' && /^(600|601|603|605|688|689)/.test(code))
    || (market === 'SZ' && /^(000|001|002|003|300|301)/.test(code))
    || (market === 'BJ' && /^(4|8|920)/.test(code))
  const tradable = isFund || isAshare
  return {
    symbol,
    providerCode: `${market.toLowerCase()}${code}`,
    name: symbol,
    kind: isFund ? 'ETF / 基金' : isAshare ? (market === 'BJ' ? '北交所证券' : 'A 股') : '仅观察',
    exchange: market === 'SH' ? '上海' : market === 'SZ' ? '深圳' : '北京',
    risk: isFund ? '中高' : isAshare ? '高' : '需识别',
    priceTick: isFund ? 0.001 : 0.01,
    lotSize: 100,
    tradable,
  }
}

function generateFallbackCandles(symbol, limit) {
  const index = WATCHLIST.findIndex((item) => item.symbol === symbol)
  let price = [4.5, 4.7, 6.8, 2.5, 1_300, 10.8][Math.max(0, index)]
  const rows = []
  const seed = symbol.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  for (let offset = limit - 1; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    const drift = Math.sin((seed + offset) * 0.7) * 0.012 + Math.cos((seed + offset) * 0.19) * 0.006
    const open = price
    const close = Math.max(0.01, open * (1 + drift))
    const high = Math.max(open, close) * 1.008
    const low = Math.min(open, close) * 0.992
    rows.push({ date: date.toISOString().slice(0, 10), open: round(open, 3), close: round(close, 3), high: round(high, 3), low: round(low, 3), volume: 2_000_000 + ((seed * offset) % 5_000_000) })
    price = close
  }
  return rows
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
