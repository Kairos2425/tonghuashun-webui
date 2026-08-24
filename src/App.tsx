import {
  Bot,
  BriefcaseBusiness,
  CircleDollarSign,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  Menu,
  RefreshCw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  WalletCards,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import { AiAssistant } from './components/AiAssistant'
import { ConnectionCenter } from './components/ConnectionCenter'
import { ManualOrders } from './components/ManualOrders'
import { LiveAccountPanel } from './components/LiveAccountPanel'
import { MarketChart } from './components/MarketChart'
import { OrderTicket } from './components/OrderTicket'
import { PortfolioPanel } from './components/PortfolioPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { Watchlist } from './components/Watchlist'
import { changeClass, compact, money, percent, price, shortTime } from './format'
import type { Candle, HealthResponse, LiveAccountSnapshot, MarketResponse, OrderRecord, Portfolio, Quote, Section } from './types'

const NAV_ITEMS = [
  { id: 'dashboard' as const, label: '总览', icon: LayoutDashboard },
  { id: 'research' as const, label: '研究', icon: Bot },
  { id: 'trade' as const, label: '交易', icon: WalletCards },
  { id: 'account' as const, label: '账户', icon: BriefcaseBusiness },
  { id: 'connections' as const, label: '连接', icon: Link2 },
]

export function App() {
  const [section, setSection] = useState<Section>('dashboard')
  const [market, setMarket] = useState<MarketResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [manualOrders, setManualOrders] = useState<OrderRecord[]>([])
  const [liveAccount, setLiveAccount] = useState<LiveAccountSnapshot | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [selected, setSelected] = useState('510300.SH')
  const [customSymbols, setCustomSymbols] = useState<string[]>(readCustomSymbols)
  const [broker, setBroker] = useState('paper')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(true)
  const [error, setError] = useState('')

  const refreshAccount = useCallback(async () => {
    const [nextPortfolio, nextManual, nextLiveAccount] = await Promise.all([api.portfolio(), api.manualOrders(), api.liveAccount()])
    setPortfolio(nextPortfolio)
    setManualOrders(nextManual)
    setLiveAccount(nextLiveAccount)
  }, [])

  const refreshHealth = useCallback(async () => {
    setHealth(await api.health())
  }, [])

  const refreshMarket = useCallback(async (force = false) => {
    const next = await marketWithCustomSymbols(customSymbols, force)
    setMarket(next)
    if (!next.quotes.some((item) => item.symbol === selected) && next.quotes[0]) setSelected(next.quotes[0].symbol)
  }, [customSymbols, selected])

  useEffect(() => {
    let active = true
    Promise.all([api.health(), marketWithCustomSymbols(customSymbols), api.portfolio(), api.manualOrders(), api.liveAccount()])
      .then(([nextHealth, nextMarket, nextPortfolio, nextManual, nextLiveAccount]) => {
        if (!active) return
        setHealth(nextHealth)
        setMarket(nextMarket)
        setPortfolio(nextPortfolio)
        setManualOrders(nextManual)
        setLiveAccount(nextLiveAccount)
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : '本地服务连接失败'))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setChartLoading(true)
    api.candles(selected)
      .then((value) => active && setCandles(value.candles))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'K 线读取失败'))
      .finally(() => active && setChartLoading(false))
    return () => { active = false }
  }, [selected])

  useEffect(() => {
    const marketTimer = window.setInterval(() => {
      void Promise.all([refreshMarket(true), refreshAccount()]).catch(() => {})
    }, 15_000)
    const healthTimer = window.setInterval(() => void refreshHealth().catch(() => {}), 30_000)
    return () => {
      window.clearInterval(marketTimer)
      window.clearInterval(healthTimer)
    }
  }, [refreshAccount, refreshHealth, refreshMarket])

  const quote = useMemo(() => market?.quotes.find((item) => item.symbol === selected) ?? market?.quotes[0], [market, selected])
  const activeBroker = health?.connectors.find((item) => item.id === broker)
  const realMode = activeBroker?.kind !== 'paper'

  const navigate = (next: Section) => {
    setSection(next)
    setSidebarOpen(false)
  }

  const addSymbol = async (input: string) => {
    const nextQuote = await api.quote(input)
    setMarket((current) => current ? { ...current, quotes: mergeQuotes(current.quotes, [nextQuote]) } : current)
    setCustomSymbols((current) => {
      if (current.includes(nextQuote.symbol)) return current
      const next = [...current, nextQuote.symbol].slice(-20)
      window.localStorage.setItem('stock-workbench.custom-symbols', JSON.stringify(next))
      return next
    })
    setSelected(nextQuote.symbol)
  }

  const resetPortfolio = async () => {
    if (!window.confirm('重置后会清空全部模拟持仓和模拟成交，是否继续？')) return
    setPortfolio(await api.resetPortfolio())
  }

  if (loading) {
    return <div className="boot-screen"><div className="brand-mark">知</div><LoaderCircle className="spin" size={22} /><span>正在启动本地工作台</span></div>
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button menu-button" type="button" onClick={() => setSidebarOpen(true)} title="打开导航"><Menu size={19} /></button>
        <button className="brand" type="button" onClick={() => navigate('dashboard')}>
          <span className="brand-mark">知</span>
          <span><strong>知行台</strong><small>AI 股票辅助工作台</small></span>
        </button>
        <div className="index-strip">
          {market?.indices.slice(0, 3).map((index) => (
            <div className="index-ticker" key={index.symbol}>
              <span>{index.name}</span>
              <strong>{price(index.price)}</strong>
              <small className={changeClass(index.changePct)}>{percent(index.changePct)}</small>
            </div>
          ))}
        </div>
        <div className="topbar-actions">
          <span className={`market-source ${market?.sourceKind === 'public_reference' ? 'online' : 'demo'}`} title="公开行情不是券商交易报价">
            <span />{market?.source || '行情未连接'} · {shortTime(market?.fetchedAt)}
          </span>
          <a className={`harness-link${health?.harness.running ? ' online' : ''}`} href={health?.harness.url || 'http://127.0.0.1:3080'} target="_blank" rel="noreferrer" title="打开 DeepSeek Harness">
            <Bot size={16} />Harness
          </a>
          <button className="icon-button" type="button" title="刷新数据" onClick={() => void Promise.all([refreshMarket(true), refreshAccount(), refreshHealth()])}><RefreshCw size={17} /></button>
          <button className="icon-button" type="button" title="设置" onClick={() => setSettingsOpen(true)}><Settings size={17} /></button>
        </div>
      </header>

      <aside className={`sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="sidebar-mobile-head"><strong>工作区</strong><button className="icon-button" type="button" onClick={() => setSidebarOpen(false)} title="关闭"><X size={18} /></button></div>
        <nav className="primary-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return <button key={item.id} type="button" className={section === item.id ? 'active' : ''} onClick={() => navigate(item.id)} title={item.label}><Icon size={19} /><span>{item.label}</span></button>
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="mode-switcher">
          <span>当前通道</span>
          <button type="button" className={realMode ? 'live' : 'paper'} onClick={() => navigate('trade')}>
            {realMode ? <CircleDollarSign size={16} /> : <ShieldCheck size={16} />}
            <span><strong>{realMode ? activeBroker?.name || '实盘通道' : '模拟账户'}</strong><small>{realMode ? (activeBroker?.kind === 'manual_live' ? '真实资金 · 人工确认' : '真实资金 · 官方接口') : '默认安全模式'}</small></span>
          </button>
        </div>
        <div className="sidebar-disclaimer"><ShieldAlert size={14} />AI 不可下单<br />实盘逐单由你确认</div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} />}

      <main className="workspace">
        {error && <div className="global-error"><ShieldAlert size={16} /><span>{error}</span><button type="button" onClick={() => setError('')}><X size={15} /></button></div>}

        {section === 'dashboard' && (
          <>
            <div className="summary-strip">
              <SummaryItem label="模拟总资产" value={money(portfolio?.totalAssets ?? 0)} detail={percent(portfolio?.totalPnlPct ?? 0)} tone={changeClass(portfolio?.totalPnl ?? 0)} icon={<BriefcaseBusiness size={17} />} />
              <SummaryItem label="可用资金" value={money(portfolio?.cash ?? 0)} detail="本地模拟账户" icon={<CircleDollarSign size={17} />} />
              <SummaryItem label="实盘通道" value="国泰海通君弘" detail={health?.connectors.find((item) => item.id === 'gtja-manual')?.status === 'ready' ? '桌面端已检测' : '可用手机 APP 确认'} icon={<WalletCards size={17} />} />
              <SummaryItem label="风险护栏" value={`${money(health?.riskConfig.maxOrderValue ?? 1_000, 0)} / 单`} detail={`${money(health?.riskConfig.maxDailyValue ?? 3_000, 0)} / 日`} icon={<ShieldCheck size={17} />} />
            </div>
            <div className="dashboard-grid">
              <Watchlist quotes={market?.quotes ?? []} selected={quote?.symbol ?? selected} onSelect={setSelected} onAdd={addSymbol} />
              <MarketPanel quote={quote} candles={candles} chartLoading={chartLoading} market={market} />
              <AiAssistant quote={quote} configured={Boolean(health?.deepseek.configured)} onOpenSettings={() => setSettingsOpen(true)} />
              <OrderTicket quote={quote} portfolio={portfolio ?? undefined} liveAccount={liveAccount ?? undefined} connectors={health?.connectors ?? []} broker={broker} riskConfig={health?.riskConfig} onBrokerChange={setBroker} onChanged={refreshAccount} />
              <PortfolioPanel portfolio={portfolio ?? undefined} />
            </div>
          </>
        )}

        {section === 'research' && (
          <div className="research-view">
            <div className="research-market-column">
              <Watchlist quotes={market?.quotes ?? []} selected={quote?.symbol ?? selected} onSelect={setSelected} onAdd={addSymbol} />
              <MarketPanel quote={quote} candles={candles} chartLoading={chartLoading} market={market} expanded />
            </div>
            <AiAssistant quote={quote} configured={Boolean(health?.deepseek.configured)} onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        )}

        {section === 'trade' && (
          <div className="trade-view">
            <div className="trade-main">
              <div className="trade-context">
                <span className="eyebrow">当前标的</span>
                <strong>{quote?.name} {quote?.symbol}</strong>
                <span className={changeClass(quote?.changePct ?? 0)}>{quote ? `${price(quote.price)} · ${percent(quote.changePct)}` : '--'}</span>
              </div>
              <LiveAccountPanel account={liveAccount ?? undefined} onChanged={refreshAccount} />
              <OrderTicket quote={quote} portfolio={portfolio ?? undefined} liveAccount={liveAccount ?? undefined} connectors={health?.connectors ?? []} broker={broker} riskConfig={health?.riskConfig} onBrokerChange={setBroker} onChanged={refreshAccount} />
              <ManualOrders orders={manualOrders} onChanged={refreshAccount} />
            </div>
            <TradeReadiness health={health ?? undefined} portfolio={portfolio ?? undefined} liveAccount={liveAccount ?? undefined} onOpenSettings={() => setSettingsOpen(true)} />
          </div>
        )}

        {section === 'account' && (
          <div className="account-view">
            <LiveAccountPanel account={liveAccount ?? undefined} expanded onChanged={refreshAccount} />
            <PortfolioPanel portfolio={portfolio ?? undefined} expanded onReset={() => void resetPortfolio()} />
            <ManualOrders orders={manualOrders} onChanged={refreshAccount} />
          </div>
        )}

        {section === 'connections' && <ConnectionCenter health={health ?? undefined} onOpenSettings={() => setSettingsOpen(true)} />}
      </main>

      <footer className="statusbar">
        <span><span className="status-led online" />本地服务</span>
        <span><span className={`status-led${market?.sourceKind === 'public_reference' ? ' online' : ' warning'}`} />{market?.source}</span>
        <span><span className={`status-led${health?.deepseek.configured ? ' online' : ''}`} />DeepSeek {health?.deepseek.configured ? '已配置' : '未配置'}</span>
        <span className="status-spacer" />
        <span>公开行情仅供参考 · 实盘以君弘为准</span>
      </footer>

      {settingsOpen && <SettingsDialog configured={Boolean(health?.deepseek.configured)} source={health?.deepseek.source || 'none'} onClose={() => setSettingsOpen(false)} onChanged={refreshHealth} />}
    </div>
  )
}

async function marketWithCustomSymbols(symbols: string[], force = false) {
  const base = await api.market(force)
  if (symbols.length === 0) return base
  const results = await Promise.allSettled(symbols.map((symbol) => api.quote(symbol)))
  const custom = results
    .filter((result): result is PromiseFulfilledResult<Quote> => result.status === 'fulfilled')
    .map((result) => result.value)
  return { ...base, quotes: mergeQuotes(base.quotes, custom) }
}

function mergeQuotes(base: Quote[], extra: Quote[]) {
  const merged = new Map(base.map((quote) => [quote.symbol, quote]))
  for (const quote of extra) merged.set(quote.symbol, quote)
  return [...merged.values()]
}

function readCustomSymbols() {
  try {
    const value = JSON.parse(window.localStorage.getItem('stock-workbench.custom-symbols') || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-20) : []
  } catch {
    return []
  }
}

function SummaryItem({ label, value, detail, tone = '', icon }: { label: string; value: string; detail: string; tone?: string; icon: ReactNode }) {
  return <div className="summary-item"><span className="summary-icon">{icon}</span><span><small>{label}</small><strong>{value}</strong></span><em className={tone}>{detail}</em></div>
}

function MarketPanel({ quote, candles, chartLoading, market, expanded = false }: { quote?: Quote; candles: Candle[]; chartLoading: boolean; market: MarketResponse | null; expanded?: boolean }) {
  if (!quote) return <section className="panel market-panel"><div className="empty-state">行情加载中</div></section>
  return (
    <section className={`panel market-panel${expanded ? ' expanded' : ''}`} aria-label={`${quote.name} 行情`}>
      <div className="market-heading">
        <div className="instrument-title">
          <span className="eyebrow">{quote.kind} · {quote.exchange}</span>
          <h1>{quote.name}<small>{quote.symbol}</small></h1>
        </div>
        <div className={`instrument-price ${changeClass(quote.change)}`}>
          <strong>{price(quote.price)}</strong>
          <span>{quote.change > 0 ? '+' : ''}{price(quote.change)} · {percent(quote.changePct)}</span>
        </div>
        <div className="quote-status"><span className={market?.sourceKind === 'public_reference' ? 'online' : ''} />{market?.source} · {shortTime(quote.quoteTime)}</div>
      </div>
      <div className="chart-tabs" role="tablist" aria-label="图表周期">
        <button type="button" className="active">日 K</button><button type="button" disabled>周 K</button><button type="button" disabled>月 K</button>
        <span>前复权</span>
      </div>
      <MarketChart candles={candles} loading={chartLoading} />
      <div className="quote-metrics">
        <Metric label="今开" value={price(quote.open)} />
        <Metric label="最高" value={price(quote.high)} tone="is-up" />
        <Metric label="最低" value={price(quote.low)} tone="is-down" />
        <Metric label="昨收" value={price(quote.prevClose)} />
        <Metric label="成交量" value={compact(quote.volume)} />
        <Metric label="风险标签" value={quote.risk} tone={quote.risk === '高' ? 'is-up' : ''} />
      </div>
      <div className="context-line"><ShieldAlert size={14} /><span>K 线反映过去价格，不代表未来；公开行情可能延迟，委托前到君弘复核。</span></div>
    </section>
  )
}

function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div><span>{label}</span><strong className={tone}>{value}</strong></div>
}

function TradeReadiness({ health, portfolio, liveAccount, onOpenSettings }: { health?: HealthResponse; portfolio?: Portfolio; liveAccount?: LiveAccountSnapshot; onOpenSettings: () => void }) {
  const gtja = health?.connectors.find((item) => item.id === 'gtja-manual')
  const checks = [
    { label: '本地风控服务', ok: Boolean(health?.localOnly), detail: '仅监听 127.0.0.1' },
    { label: '模拟盘验证', ok: Boolean(portfolio?.orders.length), detail: portfolio?.orders.length ? `已完成 ${portfolio.orders.length} 笔` : '建议先完成至少一笔' },
    { label: '君弘账户镜像', ok: Boolean(liveAccount?.fresh), detail: liveAccount?.fresh ? '今日余额与持仓已抄录' : liveAccount?.configured ? '不是今日数据，请更新' : '建议实盘前抄录' },
    { label: '国泰海通君弘', ok: gtja?.status === 'ready', detail: gtja?.status === 'ready' ? '已检测桌面端' : '可先使用手机 APP' },
    { label: 'DeepSeek', ok: Boolean(health?.deepseek.configured), detail: health?.deepseek.configured ? '密钥已配置，调用时验证' : '不影响手动交易' },
    { label: 'API 实盘', ok: Boolean(health?.liveEnabled), detail: health?.liveEnabled ? '官方通道已解锁' : '保持锁定' },
  ]
  return (
    <aside className="panel readiness-panel">
      <div className="panel-heading"><div><span className="eyebrow">实盘准备度</span><h2>君弘账户链路</h2></div><ShieldCheck size={18} /></div>
      <div className="readiness-list">
        {checks.map((check) => <div key={check.label}><span className={check.ok ? 'check-dot ok' : 'check-dot'}>{check.ok ? '✓' : '!'}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}
      </div>
      {!health?.deepseek.configured && <button className="button secondary full" type="button" onClick={onOpenSettings}><KeyRound size={15} />配置 DeepSeek</button>}
      <a className="button secondary full" href="https://open.gtja.com/" target="_blank" rel="noreferrer"><ExternalLink size={15} />STS / 程序化申请</a>
      <div className="readiness-note"><ShieldAlert size={14} />未获得官方 API 权限前，工作台只生成经过风控的订单草稿，不会模拟点击君弘。</div>
    </aside>
  )
}
