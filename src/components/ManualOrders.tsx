import { CheckCircle2, ClipboardCheck, LoaderCircle, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { money, price, sideLabel } from '../format'
import type { OrderRecord } from '../types'

interface Props {
  orders: OrderRecord[]
  onChanged: () => Promise<void>
}

export function ManualOrders({ orders, onChanged }: Props) {
  const [selected, setSelected] = useState<OrderRecord | null>(null)
  const [status, setStatus] = useState('filled')
  const [fillPrice, setFillPrice] = useState(0)
  const [fillQuantity, setFillQuantity] = useState(0)
  const [brokerOrderId, setBrokerOrderId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const open = (order: OrderRecord) => {
    setSelected(order)
    setStatus(order.status === 'partially_filled' ? 'partially_filled' : 'filled')
    setFillPrice(order.fillPrice ?? order.price)
    setFillQuantity(order.fillQuantity ?? order.quantity)
    setBrokerOrderId(order.brokerOrderId ?? '')
    setNote(order.note ?? '')
    setError('')
  }

  const save = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await api.reconcileManualOrder(selected.id, { status, fillPrice, fillQuantity, brokerOrderId, note })
      setSelected(null)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '回填失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel manual-orders-panel" aria-label="君弘实盘记录">
      <div className="panel-heading">
        <div><span className="eyebrow">国泰海通君弘</span><h2>实盘订单审计</h2></div>
        <ClipboardCheck size={18} />
      </div>
      <div className="manual-orders-list">
        {orders.map((order) => (
          <div className="manual-order-row" key={order.id}>
            <span className={`order-status ${order.status}`}>{statusLabel(order.status)}</span>
            <span><strong>{sideLabel(order.side)} {order.name}</strong><small>{order.symbol}</small></span>
            <span><strong>{order.quantity} @ {price(order.price)}</strong><small>{order.fillQuantity ? `成交 ${order.fillQuantity} @ ${price(order.fillPrice ?? 0)}` : money(order.amount)}</small></span>
            <span><strong>{new Date(order.submittedAt).toLocaleDateString('zh-CN')}</strong><small>{order.note || new Date(order.submittedAt).toLocaleTimeString('zh-CN', { hour12: false })}</small></span>
            {['awaiting_broker_confirmation', 'partially_filled'].includes(order.status) ? (
              <button className="button secondary small" type="button" onClick={() => open(order)}>{order.status === 'partially_filled' ? '继续回填' : '回填结果'}</button>
            ) : <span className="reconciled-mark"><CheckCircle2 size={15} />已记录</span>}
          </div>
        ))}
        {orders.length === 0 && <div className="empty-state">锁定君弘实盘草稿后，订单会出现在这里</div>}
      </div>

      {selected && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog small-dialog" role="dialog" aria-modal="true" aria-labelledby="reconcile-title">
            <div className="dialog-head">
              <div><span className="eyebrow">君弘成交回填</span><h2 id="reconcile-title">{selected.name} {selected.symbol}</h2></div>
              <button className="icon-button" type="button" onClick={() => setSelected(null)} title="关闭"><X size={18} /></button>
            </div>
            <div className="segmented status-segmented">
              <button type="button" className={status === 'filled' ? 'active' : ''} onClick={() => { setStatus('filled'); setFillQuantity(selected.quantity) }}>全部成交</button>
              <button type="button" className={status === 'partially_filled' ? 'active' : ''} onClick={() => setStatus('partially_filled')}>部分成交</button>
              {selected.status === 'partially_filled' ? (
                <button type="button" className={status === 'partially_filled_cancelled' ? 'active' : ''} onClick={() => setStatus('partially_filled_cancelled')}>余量已撤</button>
              ) : (
                <>
                  <button type="button" className={status === 'cancelled' ? 'active' : ''} onClick={() => setStatus('cancelled')}>未成交撤单</button>
                  <button type="button" className={status === 'rejected' ? 'active' : ''} onClick={() => setStatus('rejected')}>已拒绝</button>
                </>
              )}
            </div>
            {['filled', 'partially_filled', 'partially_filled_cancelled'].includes(status) && (
              <div className="reconcile-fields">
                <label className="field"><span>成交价</span><input type="number" min="0.001" step="0.001" value={fillPrice} onChange={(event) => setFillPrice(Number(event.target.value))} /></label>
                <label className="field"><span>成交数量</span><input type="number" min="1" step="1" value={fillQuantity} onChange={(event) => setFillQuantity(Number(event.target.value))} /></label>
              </div>
            )}
            <label className="field"><span>君弘合同号（可选）</span><input value={brokerOrderId} onChange={(event) => setBrokerOrderId(event.target.value)} maxLength={80} /></label>
            <label className="field"><span>复盘备注（可选）</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={3} placeholder="为什么买/卖、实际执行与计划有何偏差" /></label>
            {error && <div className="inline-error"><XCircle size={15} />{error}</div>}
            <div className="dialog-actions">
              <button className="button secondary" type="button" onClick={() => setSelected(null)}>取消</button>
              <button className="button primary" type="button" onClick={() => void save()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}保存审计记录</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function statusLabel(status: string) {
  if (status === 'filled') return '已成交'
  if (status === 'partially_filled') return '部分成交'
  if (status === 'partially_filled_cancelled') return '部分成交 · 余量撤'
  if (status === 'cancelled') return '已撤单'
  if (status === 'rejected') return '已拒绝'
  return '待君弘确认'
}
