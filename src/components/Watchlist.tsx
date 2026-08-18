import { LoaderCircle, Plus, Search, Star, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { changeClass, percent, price } from '../format'
import type { Quote } from '../types'

interface Props {
  quotes: Quote[]
  selected: string
  onSelect: (symbol: string) => void
  onAdd: (symbol: string) => Promise<void>
}

export function Watchlist({ quotes, selected, onSelect, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return quotes
    return quotes.filter((item) => item.name.toLowerCase().includes(keyword) || item.symbol.toLowerCase().includes(keyword))
  }, [query, quotes])

  const add = async () => {
    if (!query.trim() || adding) return
    setAdding(true)
    setError('')
    try {
      await onAdd(query)
      setQuery('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法添加证券')
    } finally {
      setAdding(false)
    }
  }

  return (
    <section className="panel watchlist-panel" aria-label="观察列表">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">观察列表</span>
          <h2>先看懂，再决定</h2>
        </div>
        <Star size={17} aria-hidden="true" />
      </div>
      <form className="watch-search" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <Search size={15} aria-hidden="true" />
        <input value={query} onChange={(event) => { setQuery(event.target.value); setError('') }} placeholder="输入代码，如 600000" aria-label="筛选或添加证券" />
        <button type="submit" title="查询并添加证券" disabled={!query.trim() || adding}>{adding ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}</button>
      </form>
      {error && <div className="watch-error"><XCircle size={13} />{error}</div>}
      <div className="watch-table-head" aria-hidden="true">
        <span>标的</span><span>最新</span><span>涨跌</span>
      </div>
      <div className="watch-rows">
        {rows.map((quote) => (
          <button
            key={quote.symbol}
            type="button"
            className={`watch-item${selected === quote.symbol ? ' is-selected' : ''}`}
            onClick={() => onSelect(quote.symbol)}
          >
            <span className="watch-name">
              <strong>{quote.name}</strong>
              <small>{quote.symbol}</small>
            </span>
            <span className={`watch-price ${changeClass(quote.change)}`}>{price(quote.price)}</span>
            <span className={`watch-change ${changeClass(quote.changePct)}`}>{percent(quote.changePct)}</span>
          </button>
        ))}
        {rows.length === 0 && <div className="empty-state compact">没有本地匹配；输入 6 位代码后按加号查询</div>}
      </div>
      <div className="watch-footnote">ETF 与个股仅作观察样例，不构成推荐</div>
    </section>
  )
}
