import { AlertTriangle, Check, CheckCircle2, Clipboard, ExternalLink, LoaderCircle, LockKeyhole, Minus, Plus, ShieldCheck, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { money, price, sideLabel } from '../format'
import type { Connector, LiveAccountSnapshot, OrderPreview, OrderRecord, Portfolio, QuantityRule, Quote, RiskConfig, Side } from '../types'

interface Props {
  quote?: Quote
  portfolio?: Portfolio
  liveAccount?: LiveAccountSnapshot
  connectors: Connector[]
  broker: string
  riskConfig?: RiskConfig
  onBrokerChange: (broker: string) => void
  onChanged: () => Promise<void>
}

export function OrderTicket({ quote, portfolio, liveAccount, connectors, broker, riskConfig, onBrokerChange, onChanged }: Props) {
  const [side, setSide] = useState<Side>('BUY')
  const [limitPrice, setLimitPrice] = useState(0)
  const [quantity, setQuantity] = useState(100)
  const [preview, setPreview] = useState<OrderPreview | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<OrderRecord | null>(null)

  useEffect(() => {
    if (quote) setLimitPrice(quote.price)
    setQuantity(quote?.quantityRule?.buyMin ?? quote?.lotSize ?? 100)
    setPreview(null)
    setSubmitted(null)
  }, [quote?.symbol])

  const connector = connectors.find((item) => item.id === broker) ?? connectors[0]
  const position = portfolio?.positions.find((item) => item.symbol === quote?.symbol)
  const mirroredPosition = liveAccount?.fresh ? liveAccount.positions.find((item) => item.symbol === quote?.symbol) : undefined
  const estimated = limitPrice * quantity
  const priceTick = quote?.priceTick ?? (quote?.kind.includes('ETF') ? 0.001 : 0.01)
  const quantityRule = quote?.quantityRule ?? defaultQuantityRule()
  const quantityMinimum = side === 'BUY' ? quantityRule.buyMin : quantityRule.sellMin
  const quantityStep = side === 'BUY' ? quantityRule.buyStep : quantityRule.sellStep
  const manualLive = connector?.kind === 'manual_live'
  const apiLive = connector?.kind === 'live_api'
  const brokerOptions = connectors.filter((item) => ['paper', 'gtja-manual', 'gtja-api', 'supermind'].includes(item.id))
  const canPreview = Boolean(quote && limitPrice > 0 && quantity > 0 && !busy)

  const chooseSide = (next: Side) => {
    setSide(next)
    setQuantity(next === 'BUY' ? quantityRule.buyMin : quantityRule.sellMin)
    setPreview(null)
    setSubmitted(null)
  }

  const createPreview = async () => {
    if (!quote || !canPreview) return
    setBusy(true)
    setError('')
    setSubmitted(null)
    try {
      const next = await api.previewOrder({ symbol: quote.symbol, side, price: limitPrice, quantity, broker })
      setPreview(next)
      setConfirmation('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '订单预览失败')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const order = await api.submitOrder(preview.id, confirmation)
      setSubmitted(order)
      setPreview(null)
      setConfirmation('')
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  const launchGtja = async () => {
    try {
      await api.launchGtja()
    } catch (reason) {
      if (reason instanceof ApiError && reason.downloadUrl) window.open(reason.downloadUrl, '_blank', 'noopener,noreferrer')
      setError(reason instanceof Error ? reason.message : '无法启动君弘富易')
    }
  }

  const copyOrder = async () => {
    if (!submitted) return
    await navigator.clipboard.writeText(`${sideLabel(submitted.side)} ${submitted.name} ${submitted.symbol}\n限价 ${price(submitted.price)}\n数量 ${submitted.quantity}\n请在君弘核对代码、方向、价格和数量后再确认。`)
  }

  return (
    <section className="panel order-panel" aria-label="订单草稿">
      <div className="panel-heading inline-heading">
        <div>
          <span className="eyebrow">订单草稿</span>
          <h2>{quote ? `${quote.name} ${quote.symbol}` : '请选择标的'}</h2>
        </div>
        <span className={`mode-badge ${manualLive || apiLive ? 'live' : 'paper'}`}>
          {manualLive || apiLive ? <LockKeyhole size={13} /> : <ShieldCheck size={13} />}
          {manualLive ? '真实资金 · 君弘确认' : apiLive ? '真实资金 · API' : '模拟资金'}
        </span>
      </div>

      <div className="broker-segments" role="group" aria-label="交易通道">
        {brokerOptions.map((item) => (
          <button key={item.id} type="button" className={broker === item.id ? 'active' : ''} onClick={() => { onBrokerChange(item.id); setPreview(null); setSubmitted(null) }} disabled={item.kind === 'live_api' && !item.canSubmit} title={item.description}>
            {brokerLabel(item.id)}
          </button>
        ))}
      </div>

      {apiLive && !connector?.canSubmit && <div className="inline-warning"><AlertTriangle size={15} />账户尚未开通官方程序化交易权限</div>}

      <div className="ticket-grid">
        <div className="side-control segmented" role="group" aria-label="买卖方向">
          <button type="button" className={side === 'BUY' ? 'active buy' : ''} onClick={() => chooseSide('BUY')}>买入</button>
          <button type="button" className={side === 'SELL' ? 'active sell' : ''} onClick={() => chooseSide('SELL')}>卖出</button>
        </div>
        <label className="field">
          <span>限价</span>
          <div className="number-input">
            <button type="button" title="降低一档" onClick={() => setLimitPrice((value) => adjustPrice(value, -priceTick, priceTick))}><Minus size={14} /></button>
            <input type="number" min={priceTick} step={priceTick} value={limitPrice || ''} onChange={(event) => setLimitPrice(Number(event.target.value))} />
            <button type="button" title="提高一档" onClick={() => setLimitPrice((value) => adjustPrice(value, priceTick, priceTick))}><Plus size={14} /></button>
          </div>
          <small>参考价 {quote ? price(quote.price) : '--'}，实盘以君弘为准</small>
        </label>
        <label className="field">
          <span>数量</span>
          <div className="number-input">
            <button type="button" title="减少一个递增单位" onClick={() => setQuantity((value) => Math.max(quantityMinimum, value - quantityStep))}><Minus size={14} /></button>
            <input type="number" min={quantityMinimum} step={quantityStep} value={quantity} onChange={(event) => setQuantity(Math.max(0, Number(event.target.value)))} />
            <button type="button" title="增加一个递增单位" onClick={() => setQuantity((value) => value + quantityStep)}><Plus size={14} /></button>
          </div>
          <small>{side === 'SELL'
            ? (connector?.kind === 'paper' ? `模拟可卖 ${position?.availableQuantity ?? 0}` : liveAccount?.fresh ? `今日镜像可卖 ${mirroredPosition?.availableQuantity ?? 0}` : '真实可卖数量需在券商端核对')
            : quantityRuleLabel(quantityRule)}</small>
        </label>
        <div className="ticket-estimate">
          <span>估算金额</span>
          <strong>{money(estimated)}</strong>
          <small>未含实际佣金，以君弘交割单为准</small>
        </div>
      </div>

      {error && <div className="inline-error"><XCircle size={15} />{error}</div>}
      {submitted && (
        <div className="submit-result">
          <CheckCircle2 size={19} />
          <div>
            <strong>{submitted.status === 'filled' ? '模拟成交完成' : '订单草稿已锁定，等待君弘确认'}</strong>
            <p>{sideLabel(submitted.side)} {submitted.symbol} · {submitted.quantity} · {price(submitted.price)}</p>
          </div>
          {submitted.status !== 'filled' && (
            <div className="result-actions">
              <button className="icon-button" type="button" title="复制订单" onClick={() => void copyOrder()}><Clipboard size={16} /></button>
              <button className="button secondary" type="button" onClick={() => void launchGtja()}><ExternalLink size={15} />打开君弘</button>
            </div>
          )}
        </div>
      )}

      <button className={`button submit-order ${side === 'BUY' ? 'buy' : 'sell'}`} type="button" onClick={() => void createPreview()} disabled={!canPreview}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
        风控预览
      </button>

      <div className="ticket-guardrails">
        <span><Check size={13} />单笔 {money(riskConfig?.maxOrderValue ?? 1_000, 0)}</span>
        <span><Check size={13} />日累计 {money(riskConfig?.maxDailyValue ?? 3_000, 0)}</span>
        <span><Check size={13} />逐单人工确认</span>
      </div>

      {preview && (
        <OrderConfirmDialog
          preview={preview}
          confirmation={confirmation}
          onConfirmation={setConfirmation}
          busy={busy}
          onClose={() => setPreview(null)}
          onSubmit={() => void submit()}
        />
      )}
    </section>
  )
}

function OrderConfirmDialog({ preview, confirmation, onConfirmation, busy, onClose, onSubmit }: { preview: OrderPreview; confirmation: string; onConfirmation: (value: string) => void; busy: boolean; onClose: () => void; onSubmit: () => void }) {
  const seconds = usePreviewCountdown(preview.expiresAt)
  const isLive = preview.order.mode !== 'paper'
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="dialog-head">
          <div><span className="eyebrow">{isLive ? '真实资金确认' : '模拟订单确认'}</span><h2 id="confirm-title">核对订单四要素</h2></div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭"><X size={18} /></button>
        </div>
        <div className="order-summary-grid">
          <div><span>代码</span><strong>{preview.order.symbol}</strong></div>
          <div><span>方向</span><strong className={preview.order.side === 'BUY' ? 'is-up' : 'is-down'}>{sideLabel(preview.order.side)}</strong></div>
          <div><span>限价</span><strong>{price(preview.order.price)}</strong></div>
          <div><span>数量</span><strong>{preview.order.quantity}</strong></div>
          <div><span>金额</span><strong>{money(preview.amount)}</strong></div>
          <div><span>费用估算</span><strong>{money(preview.fees.total)}</strong></div>
        </div>
        <div className="risk-checks">
          {preview.checks.map((check) => (
            <div key={check.code} className={`risk-check ${check.level}`}>
              {check.level === 'pass' ? <CheckCircle2 size={15} /> : check.level === 'warn' ? <AlertTriangle size={15} /> : <XCircle size={15} />}
              <span>{check.message}</span>
            </div>
          ))}
        </div>
        <label className="confirmation-field">
          <span>输入确认文本</span>
          <code>{preview.confirmationText}</code>
          <input value={confirmation} onChange={(event) => onConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        {isLive && <div className="live-warning"><LockKeyhole size={17} />提交后仍需在君弘官方客户端核对并点击最终确认。</div>}
        <div className="dialog-actions">
          <span className={seconds < 10 ? 'expires danger' : 'expires'}>{seconds > 0 ? `${seconds} 秒后过期` : '已过期'}</span>
          <button className="button secondary" type="button" onClick={onClose}>返回修改</button>
          <button className={`button ${isLive ? 'danger' : 'primary'}`} type="button" onClick={onSubmit} disabled={!preview.ok || confirmation !== preview.confirmationText || busy || seconds <= 0}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
            {isLive ? '锁定实盘草稿' : '确认模拟订单'}
          </button>
        </div>
      </div>
    </div>
  )
}

function usePreviewCountdown(expiresAt: number) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)))
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))), 250)
    return () => window.clearInterval(timer)
  }, [expiresAt])
  return seconds
}

function adjustPrice(value: number, delta: number, tick: number) {
  const digits = tick < 0.01 ? 3 : 2
  return Math.max(tick, Number((value + delta).toFixed(digits)))
}

function brokerLabel(id: string) {
  if (id === 'paper') return '模拟账户'
  if (id === 'gtja-manual') return '君弘人工'
  if (id === 'gtja-api') return '君弘 API'
  if (id === 'supermind') return '同花顺'
  return id
}

function defaultQuantityRule(): QuantityRule {
  return { buyMin: 100, buyStep: 100, sellMin: 100, sellStep: 100, oddLotThreshold: 100 }
}

function quantityRuleLabel(rule: QuantityRule) {
  return rule.buyStep === 1 ? `最低 ${rule.buyMin}，按 1 递增` : `${rule.buyMin} 股（份）一手`
}
