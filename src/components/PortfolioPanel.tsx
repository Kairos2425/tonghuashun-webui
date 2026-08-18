import { BriefcaseBusiness, CircleDollarSign, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react'
import { changeClass, money, percent, price, sideLabel } from '../format'
import type { Portfolio } from '../types'

interface Props {
  portfolio?: Portfolio
  expanded?: boolean
  onReset?: () => void
}

export function PortfolioPanel({ portfolio, expanded = false, onReset }: Props) {
  if (!portfolio) return <section className="panel portfolio-panel"><div className="empty-state">正在读取账户</div></section>
  return (
    <section className={`panel portfolio-panel${expanded ? ' expanded' : ''}`} aria-label="模拟账户">
      <div className="panel-heading inline-heading">
        <div>
          <span className="eyebrow">模拟账户</span>
          <h2>资产与持仓</h2>
        </div>
        {onReset && <button className="icon-button" type="button" title="重置模拟账户" onClick={onReset}><RotateCcw size={16} /></button>}
      </div>
      <div className="asset-summary">
        <div className="asset-primary">
          <span>总资产</span>
          <strong>{money(portfolio.totalAssets)}</strong>
          <small className={changeClass(portfolio.totalPnl)}>
            {portfolio.totalPnl >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {money(portfolio.totalPnl)} · {percent(portfolio.totalPnlPct)}
          </small>
        </div>
        <div><CircleDollarSign size={15} /><span>可用资金</span><strong>{money(portfolio.cash)}</strong></div>
        <div><BriefcaseBusiness size={15} /><span>持仓市值</span><strong>{money(portfolio.marketValue)}</strong></div>
      </div>

      <div className="positions-table">
        <div className="table-row table-head"><span>标的</span><span>持仓/可卖</span><span>成本/现价</span><span>浮动盈亏</span></div>
        {portfolio.positions.map((position) => (
          <div className="table-row" key={position.symbol}>
            <span><strong>{position.name}</strong><small>{position.symbol}</small></span>
            <span><strong>{position.quantity}</strong><small>{position.availableQuantity}</small></span>
            <span><strong>{price(position.avgCost)}</strong><small>{price(position.marketPrice)}</small></span>
            <span className={changeClass(position.pnl)}><strong>{money(position.pnl)}</strong><small>{percent(position.pnlPct)}</small></span>
          </div>
        ))}
        {portfolio.positions.length === 0 && <div className="empty-state compact">暂无模拟持仓</div>}
      </div>

      {expanded && (
        <div className="order-history">
          <div className="subheading">最近模拟成交</div>
          {portfolio.orders.slice(0, 12).map((order) => (
            <div className="history-row" key={order.id}>
              <span>{new Date(order.submittedAt).toLocaleString('zh-CN', { hour12: false })}</span>
              <strong className={order.side === 'BUY' ? 'is-up' : 'is-down'}>{sideLabel(order.side)}</strong>
              <span>{order.name} {order.symbol}</span>
              <span>{order.quantity} @ {price(order.price)}</span>
              <span>{money(order.amount)}</span>
            </div>
          ))}
          {portfolio.orders.length === 0 && <div className="empty-state compact">完成一笔模拟单后，这里会留下审计记录</div>}
        </div>
      )}
    </section>
  )
}
