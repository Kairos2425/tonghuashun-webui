import { BrainCircuit, ChartNoAxesCombined, FlaskConical, LoaderCircle, Pause, Play, RefreshCw, ShieldAlert, ShieldCheck, Target, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { money, price, sideLabel } from '../format'
import type { QuantAutomation, QuantBacktestResult, Quote, RelativeValueResult } from '../types'

interface Props {
  quote?: Quote
  onPaperChanged: () => Promise<void>
}

export function QuantLab({ quote, onPaperChanged }: Props) {
  const [symbol, setSymbol] = useState(quote?.symbol ?? '510300.SH')
  const [buyThreshold, setBuyThreshold] = useState(0.58)
  const [sellThreshold, setSellThreshold] = useState(0.42)
  const [maxOrderValue, setMaxOrderValue] = useState(1_000)
  const [slippageBps, setSlippageBps] = useState(5)
  const [backtest, setBacktest] = useState<QuantBacktestResult | null>(null)
  const [backtestBusy, setBacktestBusy] = useState(false)
  const [leftSymbol, setLeftSymbol] = useState('510300.SH')
  const [rightSymbol, setRightSymbol] = useState('159919.SZ')
  const [relativeValue, setRelativeValue] = useState<RelativeValueResult | null>(null)
  const [pairBusy, setPairBusy] = useState(false)
  const [automation, setAutomation] = useState<QuantAutomation | null>(null)
  const [automationBusy, setAutomationBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api.quantAutomation()
      .then((value) => {
        if (!active) return
        setAutomation(value.automation)
        setBuyThreshold(value.automation.buyThreshold)
        setSellThreshold(value.automation.sellThreshold)
        setMaxOrderValue(value.automation.maxOrderValue)
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : '自动执行配置读取失败'))
    return () => { active = false }
  }, [])

  const runBacktest = async () => {
    setBacktestBusy(true)
    setError('')
    try {
      const response = await api.quantBacktest({ symbol, buyThreshold, sellThreshold, maxOrderValue, slippageBps })
      setBacktest(response.result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '回测失败')
    } finally {
      setBacktestBusy(false)
    }
  }

  const runPair = async () => {
    setPairBusy(true)
    setError('')
    try {
      setRelativeValue((await api.relativeValue(leftSymbol, rightSymbol)).result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '相对价值分析失败')
    } finally {
      setPairBusy(false)
    }
  }

  const saveAutomation = async (enabled: boolean) => {
    setAutomationBusy(true)
    setError('')
    try {
      const response = await api.saveQuantAutomation({
        enabled,
        mode: 'paper',
        symbol: automation?.symbol ?? '510300.SH',
        buyThreshold,
        sellThreshold,
        maxOrderValue,
        evaluationIntervalMinutes: automation?.evaluationIntervalMinutes ?? 15,
      })
      setAutomation(response.automation)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '自动执行配置保存失败')
    } finally {
      setAutomationBusy(false)
    }
  }

  const runAutomation = async () => {
    setAutomationBusy(true)
    setError('')
    try {
      const evaluation = await api.runQuantAutomation()
      setAutomation((current) => current ? { ...current, lastEvaluation: evaluation, history: [evaluation, ...current.history].slice(0, 50) } : current)
      if (evaluation.action?.includes('EXECUTED')) await onPaperChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '策略评估失败')
    } finally {
      setAutomationBusy(false)
    }
  }

  return (
    <div className="quant-view">
      <section className="panel quant-principles">
        <div className="panel-heading"><div><span className="eyebrow">AI 量化研究</span><h2>从公开方法论到可验证实验</h2></div><BrainCircuit size={20} /></div>
        <div className="quant-principle-grid">
          <div><FlaskConical size={18} /><strong>快速实验</strong><p>统一特征、模型、回测与成本参数，每次结果可复现。</p></div>
          <div><Target size={18} /><strong>寻找定价偏差</strong><p>量价机器学习预测与同类 ETF 相对价值信号分开验证。</p></div>
          <div><ShieldCheck size={18} /><strong>先证伪再执行</strong><p>只看样本外表现，计入费用与滑点，不用演示行情出结论。</p></div>
          <div><Zap size={18} /><strong>分阶段自动化</strong><p>当前只自动执行模拟盘；真实资金通道在券商授权前硬锁定。</p></div>
        </div>
      </section>

      {error && <div className="global-error quant-error"><ShieldAlert size={16} /><span>{error}</span><button type="button" onClick={() => setError('')}>×</button></div>}

      <div className="quant-grid">
        <section className="panel quant-backtest-panel">
          <div className="panel-heading"><div><span className="eyebrow">机器学习基线</span><h2>走步样本外回测</h2></div><ChartNoAxesCombined size={19} /></div>
          <div className="quant-controls">
            <label className="field"><span>证券代码</span><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} /></label>
            <label className="field"><span>买入概率阈值</span><input type="number" min="0.51" max="0.9" step="0.01" value={buyThreshold} onChange={(event) => setBuyThreshold(Number(event.target.value))} /></label>
            <label className="field"><span>卖出概率阈值</span><input type="number" min="0.1" max="0.49" step="0.01" value={sellThreshold} onChange={(event) => setSellThreshold(Number(event.target.value))} /></label>
            <label className="field"><span>单笔上限</span><input type="number" min="100" max="1000" step="100" value={maxOrderValue} onChange={(event) => setMaxOrderValue(Number(event.target.value))} /></label>
            <label className="field"><span>滑点（基点）</span><input type="number" min="0" max="100" step="1" value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))} /></label>
            <button className="button primary quant-run-button" type="button" onClick={() => void runBacktest()} disabled={backtestBusy}>{backtestBusy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}运行回测</button>
          </div>
          {backtest ? <BacktestResult result={backtest} /> : <div className="quant-placeholder"><BrainCircuit size={26} /><strong>先运行一次基线实验</strong><p>模型只使用历史日 K，并以过去训练、未来测试的顺序逐日推进。</p></div>}
        </section>

        <aside className="quant-side-column">
          <section className="panel quant-automation-panel">
            <div className="panel-heading"><div><span className="eyebrow">自动执行</span><h2>模拟盘策略机器人</h2></div><span className={`automation-state${automation?.enabled ? ' enabled' : ''}`}>{automation?.enabled ? '运行中' : '已停止'}</span></div>
            <div className="automation-lock"><ShieldCheck size={16} /><span><strong>实盘硬锁定</strong><small>机器人只可调用本地模拟账户，不可选择君弘或 SuperMind。</small></span></div>
            <label className="field automation-symbol"><span>自动研究 ETF</span><input value={automation?.symbol ?? '510300.SH'} onChange={(event) => setAutomation((current) => current ? { ...current, symbol: event.target.value.toUpperCase() } : current)} /></label>
            <div className="automation-actions">
              <button className={`button ${automation?.enabled ? 'ghost-danger' : 'primary'}`} type="button" disabled={automationBusy} onClick={() => void saveAutomation(!automation?.enabled)}>{automationBusy ? <LoaderCircle className="spin" size={15} /> : automation?.enabled ? <Pause size={15} /> : <Play size={15} />}{automation?.enabled ? '停止机器人' : '启用模拟机器人'}</button>
              <button className="button secondary" type="button" disabled={!automation?.enabled || automationBusy} onClick={() => void runAutomation()}><RefreshCw size={15} />立即评估</button>
            </div>
            <AutomationStatus automation={automation} />
          </section>

          <section className="panel relative-value-panel">
            <div className="panel-heading"><div><span className="eyebrow">定价偏差</span><h2>ETF 相对价值监控</h2></div><Target size={19} /></div>
            <div className="pair-fields">
              <label className="field"><span>左侧</span><input value={leftSymbol} onChange={(event) => setLeftSymbol(event.target.value.toUpperCase())} /></label>
              <label className="field"><span>右侧</span><input value={rightSymbol} onChange={(event) => setRightSymbol(event.target.value.toUpperCase())} /></label>
            </div>
            <button className="button secondary full" type="button" disabled={pairBusy} onClick={() => void runPair()}>{pairBusy ? <LoaderCircle className="spin" size={15} /> : <ChartNoAxesCombined size={15} />}计算 60 日价差</button>
            {relativeValue && (
              <div className="relative-result">
                <div><span>最新 Z 分数</span><strong className={Math.abs(relativeValue.zScore) >= relativeValue.threshold ? 'is-up' : ''}>{relativeValue.zScore.toFixed(3)}</strong></div>
                <div><span>偏离中心</span><strong>{relativeValue.divergencePct.toFixed(3)}%</strong></div>
                <p>{relativeValue.interpretation}</p>
              </div>
            )}
            <div className="quant-disclaimer"><ShieldAlert size={13} />普通现金账户不能对称做空，这里是换仓观察，不是无风险套利。</div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function BacktestResult({ result }: { result: QuantBacktestResult }) {
  const maxWeight = useMemo(() => Math.max(...result.model.featureWeights.map((item) => Math.abs(item.weight)), 0.0001), [result])
  return (
    <div className="backtest-result">
      <div className="signal-banner">
        <div className={`signal-orb ${result.current.signal.toLowerCase()}`}>{result.current.signal}</div>
        <span><small>{result.current.date} · 下一日正收益概率</small><strong>{(result.current.probability * 100).toFixed(1)}%</strong><p>{result.current.explanation}</p></span>
        <em>样本外 {result.model.outOfSampleSamples} 天</em>
      </div>
      <div className="quant-metrics">
        <Metric label="策略收益" value={`${signed(result.metrics.totalReturnPct)}%`} tone={result.metrics.totalReturnPct >= 0 ? 'is-up' : 'is-down'} />
        <Metric label="同期买入持有" value={`${signed(result.metrics.buyHoldReturnPct)}%`} />
        <Metric label="最大回撤" value={`-${Math.abs(result.metrics.maxDrawdownPct).toFixed(2)}%`} tone="is-down" />
        <Metric label="样本外准确率" value={`${result.metrics.directionalAccuracy.toFixed(2)}%`} />
        <Metric label="夏普" value={result.metrics.sharpe.toFixed(2)} />
        <Metric label="完整交易" value={String(result.metrics.completedTrades)} />
        <Metric label="胜率" value={`${result.metrics.winRatePct.toFixed(2)}%`} />
        <Metric label="估算成本" value={money(result.metrics.estimatedCosts)} />
      </div>
      <EquityChart points={result.equityCurve} />
      <div className="model-details">
        <div className="feature-weights">
          <div className="subheading">当前训练窗特征权重（仅解释方向，不代表因果）</div>
          {result.model.featureWeights.map((item) => (
            <div className="feature-row" key={item.name}><span>{item.name}</span><i><b className={item.weight >= 0 ? 'positive' : 'negative'} style={{ width: `${Math.max(2, Math.abs(item.weight) / maxWeight * 100)}%` }} /></i><strong>{item.weight.toFixed(4)}</strong></div>
          ))}
        </div>
        <div className="quant-trades">
          <div className="subheading">最近模拟成交点</div>
          {result.trades.slice(-8).reverse().map((trade, index) => (
            <div className="quant-trade-row" key={`${trade.date}-${trade.side}-${index}`}><span>{trade.date}</span><strong className={trade.side === 'BUY' ? 'is-up' : 'is-down'}>{sideLabel(trade.side)}</strong><span>{trade.quantity} @ {price(trade.price)}</span><span>{trade.pnl === undefined ? '--' : money(trade.pnl)}</span></div>
          ))}
          {result.trades.length === 0 && <div className="empty-state compact">阈值与单笔上限下没有产生交易</div>}
        </div>
      </div>
      <div className="backtest-warnings">{result.warnings.map((warning) => <span key={warning}><ShieldAlert size={12} />{warning}</span>)}</div>
    </div>
  )
}

function EquityChart({ points }: { points: QuantBacktestResult['equityCurve'] }) {
  const width = 760
  const height = 180
  const all = points.flatMap((item) => [item.equity, item.buyHold])
  const minimum = Math.min(...all)
  const maximum = Math.max(...all)
  const range = Math.max(1, maximum - minimum)
  const line = (field: 'equity' | 'buyHold') => points.map((item, index) => {
    const x = points.length <= 1 ? 0 : index / (points.length - 1) * width
    const y = height - ((item[field] - minimum) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <div className="equity-chart">
      <div><span className="strategy-line" />策略净值 <span className="benchmark-line" />买入持有</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="样本外权益曲线"><polyline className="benchmark" points={line('buyHold')} /><polyline className="strategy" points={line('equity')} /></svg>
    </div>
  )
}

function AutomationStatus({ automation }: { automation: QuantAutomation | null }) {
  const evaluation = automation?.lastEvaluation
  if (!evaluation) return <div className="automation-empty">尚无自动评估记录</div>
  return (
    <div className="automation-last">
      <span>{evaluation.signalDate || '--'} · {evaluation.signal || 'HOLD'}</span>
      <strong>{actionLabel(evaluation.action)}</strong>
      <p>{evaluation.reason || evaluation.message || '评估完成'}</p>
      {evaluation.probability !== undefined && <small>正收益概率 {(evaluation.probability * 100).toFixed(1)}%</small>}
    </div>
  )
}

function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div><span>{label}</span><strong className={tone}>{value}</strong></div>
}

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
}

function actionLabel(action?: string) {
  const labels: Record<string, string> = {
    BUY_EXECUTED: '模拟买入已执行',
    SELL_EXECUTED: '模拟卖出已执行',
    HOLD_POSITION: '已有持仓，未加仓',
    NO_POSITION: '无持仓，无需卖出',
    WAIT_T1: '等待 T+1',
    BLOCKED: '风控阻断',
    NONE: '未触发交易',
    WINDOW_CLOSED: '仅预览，等待执行窗口',
  }
  return labels[action ?? ''] ?? action ?? '未执行'
}
