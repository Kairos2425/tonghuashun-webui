import { BriefcaseBusiness, CheckCircle2, Clock3, LoaderCircle, Pencil, Plus, ShieldCheck, Trash2, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { money, price } from '../format'
import type { LiveAccountPosition, LiveAccountSnapshot } from '../types'

interface Props {
  account?: LiveAccountSnapshot
  expanded?: boolean
  onChanged: () => Promise<void>
}

interface DraftPosition extends LiveAccountPosition {
  rowId: string
}

export function LiveAccountPanel({ account, expanded = false, onChanged }: Props) {
  const [editing, setEditing] = useState(false)
  const [cash, setCash] = useState(0)
  const [totalAssets, setTotalAssets] = useState(0)
  const [positions, setPositions] = useState<DraftPosition[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const open = () => {
    setCash(account?.cash ?? 0)
    setTotalAssets(account?.totalAssets ?? 0)
    setPositions((account?.positions ?? []).map((item) => ({ ...item, rowId: rowId() })))
    setError('')
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api.saveLiveAccount({
        cash,
        totalAssets,
        positions: positions
          .filter((item) => item.symbol.trim())
          .map(({ rowId: _rowId, ...item }) => item),
      })
      setEditing(false)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '账户镜像保存失败')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (!window.confirm('清除本机加密的君弘账户镜像？不会影响君弘真实账户。')) return
    setBusy(true)
    setError('')
    try {
      await api.clearLiveAccount()
      setEditing(false)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  const updatePosition = (id: string, field: keyof LiveAccountPosition, value: string | number) => {
    setPositions((current) => current.map((item) => item.rowId === id ? { ...item, [field]: value } : item))
  }

  const configured = Boolean(account?.configured)
  return (
    <section className={`panel live-account-panel${expanded ? ' expanded' : ''}`} aria-label="君弘账户镜像">
      <div className="panel-heading inline-heading">
        <div><span className="eyebrow">国泰海通君弘</span><h2>账户镜像</h2></div>
        <span className={`mirror-status${account?.fresh ? ' fresh' : ''}`}>
          {account?.fresh ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
          {account?.fresh ? '今日已同步' : configured ? '需要更新' : '尚未同步'}
        </span>
      </div>

      {configured ? (
        <>
          <div className="mirror-summary">
            <div><span>可用资金</span><strong>{money(account?.cash ?? 0)}</strong></div>
            <div><span>总资产</span><strong>{money(account?.totalAssets ?? 0)}</strong></div>
            <div><span>持仓项目</span><strong>{account?.positions.length ?? 0}</strong></div>
            <div><span>抄录时间</span><strong>{account?.updatedAt ? new Date(account.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '--'}</strong></div>
          </div>
          {expanded && (
            <div className="mirror-positions">
              <div className="mirror-position-row mirror-position-head"><span>证券</span><span>持仓 / 可卖</span><span>成本</span></div>
              {account?.positions.map((item) => (
                <div className="mirror-position-row" key={item.symbol}>
                  <span><strong>{item.name}</strong><small>{item.symbol}</small></span>
                  <span><strong>{item.quantity}</strong><small>{item.availableQuantity}</small></span>
                  <span><strong>{price(item.avgCost)}</strong><small>手工抄录</small></span>
                </div>
              ))}
              {account?.positions.length === 0 && <div className="empty-state compact">未录入持仓</div>}
            </div>
          )}
        </>
      ) : (
        <div className="mirror-empty"><BriefcaseBusiness size={20} /><span><strong>先从君弘抄录余额和持仓</strong><small>不需要资金账号或交易密码</small></span></div>
      )}

      <div className="mirror-actions">
        <div><ShieldCheck size={14} />数据用 Windows DPAPI 加密；只用于提前阻断，实盘仍以君弘为准。</div>
        <button className="button secondary" type="button" onClick={open}><Pencil size={14} />{configured ? '更新镜像' : '录入镜像'}</button>
      </div>

      {editing && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog live-account-dialog" role="dialog" aria-modal="true" aria-labelledby="live-account-title">
            <div className="dialog-head">
              <div><span className="eyebrow">仅抄录非登录信息</span><h2 id="live-account-title">更新君弘账户镜像</h2></div>
              <button className="icon-button" type="button" onClick={() => setEditing(false)} title="关闭"><X size={18} /></button>
            </div>
            <div className="mirror-form-note"><ShieldCheck size={16} />请在君弘“资金股份”页面读取；不要填写资金账号、手机号或交易密码。</div>
            <div className="mirror-money-fields">
              <label className="field"><span>可用资金（元）</span><input type="number" min="0" step="0.01" value={cash} onChange={(event) => setCash(Number(event.target.value))} /></label>
              <label className="field"><span>总资产（元）</span><input type="number" min="0" step="0.01" value={totalAssets} onChange={(event) => setTotalAssets(Number(event.target.value))} /></label>
            </div>
            <div className="mirror-editor-head"><strong>持仓与当日可卖数量</strong><button className="button secondary small" type="button" onClick={() => setPositions((current) => [...current, blankPosition()])}><Plus size={13} />添加持仓</button></div>
            <div className="mirror-editor-list">
              {positions.map((item) => (
                <div className="mirror-editor-row" key={item.rowId}>
                  <label className="field"><span>证券代码</span><input value={item.symbol} placeholder="510300.SH" onChange={(event) => updatePosition(item.rowId, 'symbol', event.target.value.toUpperCase())} /></label>
                  <label className="field"><span>名称（可选）</span><input value={item.name} placeholder="沪深300ETF" maxLength={40} onChange={(event) => updatePosition(item.rowId, 'name', event.target.value)} /></label>
                  <label className="field"><span>持仓</span><input type="number" min="0" step="1" value={item.quantity} onChange={(event) => updatePosition(item.rowId, 'quantity', Math.max(0, Number(event.target.value)))} /></label>
                  <label className="field"><span>可卖</span><input type="number" min="0" step="1" value={item.availableQuantity} onChange={(event) => updatePosition(item.rowId, 'availableQuantity', Math.max(0, Number(event.target.value)))} /></label>
                  <label className="field"><span>成本价</span><input type="number" min="0" step="0.001" value={item.avgCost} onChange={(event) => updatePosition(item.rowId, 'avgCost', Math.max(0, Number(event.target.value)))} /></label>
                  <button className="icon-button ghost-danger" type="button" title="移除此项" onClick={() => setPositions((current) => current.filter((row) => row.rowId !== item.rowId))}><Trash2 size={15} /></button>
                </div>
              ))}
              {positions.length === 0 && <div className="empty-state compact">没有持仓时只录入资金即可</div>}
            </div>
            {error && <div className="inline-error dialog-inline-error"><XCircle size={15} />{error}</div>}
            <div className="dialog-actions split-actions">
              {configured && <button className="button ghost-danger" type="button" onClick={() => void clear()} disabled={busy}><Trash2 size={15} />清除镜像</button>}
              <span />
              <button className="button secondary" type="button" onClick={() => setEditing(false)}>取消</button>
              <button className="button primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}加密保存</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function blankPosition(): DraftPosition {
  return { rowId: rowId(), symbol: '', name: '', quantity: 0, availableQuantity: 0, avgCost: 0 }
}

function rowId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}
