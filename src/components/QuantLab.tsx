import { BrainCircuit, ChartNoAxesCombined, FlaskConical, LoaderCircle, Pause, Play, RefreshCw, ShieldAlert, ShieldCheck, Target, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { money, price, sideLabel } from '../format'
import type { CrossSectionalResult, QuantAutomation, QuantBacktestResult, QuantExperiment, Quote, RelativeValueResult, RobustnessResult, ShadowPortfolio } from '../types'

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
  const [universeOptions, setUniverseOptions] = useState<Array<{ symbol: string; name: string; style: string }>>([])
  const [selectedUniverse, setSelectedUniverse] = useState<string[]>([])
  const [crossSectional, setCrossSectional] = useState<CrossSectionalResult | null>(null)
  const [crossBusy, setCrossBusy] = useState(false)
  const [shadow, setShadow] = useState<ShadowPortfolio | null>(null)
  const [shadowBusy, setShadowBusy] = useState(false)
  const [robustness, setRobustness] = useState<RobustnessResult | null>(null)
  const [experiments, setExperiments] = useState<QuantExperiment[]>([])
  const [robustnessBusy, setRobustnessBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([api.quantAutomation(), api.quantUniverse(), api.shadowPortfolio(), api.quantExperiments()])
      .then(([value, universe, shadowValue, registry]) => {
        if (!active) return
        setAutomation(value.automation)
        setUniverseOptions(universe)
        setSelectedUniverse(shadowValue.shadow.universe.length ? shadowValue.shadow.universe : universe.map((item) => item.symbol))
        setShadow(shadowValue.shadow)
        setExperiments(registry.experiments)
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

  const runCrossSectional = async () => {
    setCrossBusy(true)
    setError('')
    try {
      const response = await api.crossSectional({ symbols: selectedUniverse, topK: 3, rebalanceEvery: 5, maxWeight: 0.3, maxOrderValue, slippageBps })
      setCrossSectional(response.result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '横截面组合回测失败')
    } finally {
      setCrossBusy(false)
    }
  }

  const saveShadow = async (enabled: boolean) => {
    setShadowBusy(true)
    setError('')
    try {
      setShadow((await api.saveShadowPortfolio({ enabled, universe: selectedUniverse })).shadow)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '影子组合配置失败')
    } finally {
      setShadowBusy(false)
    }
  }

  const captureShadow = async () => {
    setShadowBusy(true)
    setError('')
    try {
      const response = await api.captureShadowPortfolio()
      setShadow(response.shadow)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '影子组合快照失败')
    } finally {
      setShadowBusy(false)
    }
  }

  const toggleUniverse = (target: string) => {
    setSelectedUniverse((current) => current.includes(target) ? current.filter((symbolItem) => symbolItem !== target) : [...current, target])
  }

  const runRobustness = async () => {
    setRobustnessBusy(true)
    setError('')
    try {
      const response = await api.quantRobustness({ symbols: selectedUniverse, topK: 3, maxWeight: 0.3 })
      setRobustness(response.robustness)
      setExperiments((current) => [response.experiment, ...current].slice(0, 50))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模型稳健性审计失败')
    } finally {
      setRobustnessBusy(false)
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

      <div className="cross-workspace">
        <section className="panel cross-sectional-panel">
          <div className="panel-heading"><div><span className="eyebrow">多资产机器学习</span><h2>ETF 横截面选优与组合回测</h2></div><Target size={19} /></div>
          <div className="universe-selector">
            {universeOptions.map((item) => (
              <button key={item.symbol} type="button" className={selectedUniverse.includes(item.symbol) ? 'selected' : ''} onClick={() => toggleUniverse(item.symbol)}>
                <span>{selectedUniverse.includes(item.symbol) ? '✓' : '+'}</span><strong>{item.name}</strong><small>{item.symbol} · {item.style}</small>
              </button>
            ))}
          </div>
          <div className="cross-actions">
            <span><ShieldCheck size={13} />选择 4–10 只 ETF；胜出概率低于 55% 时保持现金，最多 3 只、单只不超过 30%</span>
            <button className="button primary" type="button" disabled={crossBusy || selectedUniverse.length < 4} onClick={() => void runCrossSectional()}>{crossBusy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}运行组合回测</button>
          </div>
          {crossSectional ? <CrossSectionalResultView result={crossSectional} /> : <div className="cross-placeholder"><ChartNoAxesCombined size={24} /><span><strong>比较资产，而不是孤立预测</strong><small>模型学习下一交易日相对收益是否高于研究池中位数。</small></span></div>}
        </section>

        <aside className="panel shadow-panel">
          <div className="panel-heading"><div><span className="eyebrow">无交易观察</span><h2>影子组合</h2></div><span className={`automation-state${shadow?.enabled ? ' enabled' : ''}`}>{shadow?.enabled ? '每日记录' : '已停止'}</span></div>
          <div className="shadow-lock"><ShieldCheck size={16} /><span><strong>不产生任何订单</strong><small>只在本机记录模型目标权重，供至少 30 个交易日观察。</small></span></div>
          <div className="shadow-actions">
            <button className={`button ${shadow?.enabled ? 'ghost-danger' : 'primary'}`} type="button" disabled={shadowBusy || selectedUniverse.length < 4} onClick={() => void saveShadow(!shadow?.enabled)}>{shadowBusy ? <LoaderCircle className="spin" size={15} /> : shadow?.enabled ? <Pause size={15} /> : <Play size={15} />}{shadow?.enabled ? '停止每日记录' : '启用每日记录'}</button>
            <button className="button secondary" type="button" disabled={shadowBusy || selectedUniverse.length < 4} onClick={() => void captureShadow()}><RefreshCw size={15} />立即记录</button>
          </div>
          <ShadowStatus shadow={shadow} />
        </aside>
      </div>

      <section className="panel robustness-panel">
        <div className="panel-heading"><div><span className="eyebrow">模型治理</span><h2>固定场景稳健性审计与实验登记</h2></div><span className={`verdict-badge ${robustness?.verdict.toLowerCase() ?? ''}`}>{robustness ? verdictLabel(robustness.verdict) : '尚未审计'}</span></div>
        <div className="robustness-intro">
          <span><ShieldAlert size={15} />一次运行固定登记 7 个场景和至少 9 次已知试验，不自动挑选最好参数。</span>
          <button className="button secondary" type="button" disabled={robustnessBusy || selectedUniverse.length < 4} onClick={() => void runRobustness()}>{robustnessBusy ? <LoaderCircle className="spin" size={15} /> : <FlaskConical size={15} />}运行并登记审计</button>
        </div>
        {robustness ? <RobustnessView result={robustness} experiments={experiments} /> : <ExperimentRegistry experiments={experiments} />}
      </section>

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

function RobustnessView({ result, experiments }: { result: RobustnessResult; experiments: QuantExperiment[] }) {
  return (
    <div className="robustness-result">
      <div className="robust-summary">
        <Metric label="固定场景" value={String(result.summary.scenarios)} />
        <Metric label="正超额场景" value={`${result.summary.positiveScenarios} / ${result.summary.scenarios}`} />
        <Metric label="中位超额" value={`${signed(result.summary.medianExcessReturnPct)}%`} tone={result.summary.medianExcessReturnPct >= 0 ? 'is-up' : 'is-down'} />
        <Metric label="最差超额" value={`${signed(result.summary.worstExcessReturnPct)}%`} tone="is-down" />
        <Metric label="最差回撤" value={`-${result.summary.worstDrawdownPct.toFixed(2)}%`} tone="is-down" />
        <Metric label="已知试验次数" value={String(result.knownTrialCount)} />
      </div>
      <div className="robust-grid">
        <div className="robust-checks">
          <div className="subheading">模型卡检查</div>
          {result.checks.map((check) => <div className={check.pass ? 'pass' : 'fail'} key={check.id}><span>{check.pass ? '✓' : '×'}</span><strong>{check.label}</strong></div>)}
          <p>{result.selectionBiasNotice}</p>
        </div>
        <div className="scenario-table">
          <div className="subheading">固定压力场景</div>
          <div className="scenario-row scenario-head"><span>场景</span><span>超额</span><span>回撤</span><span>换手</span></div>
          {result.scenarios.map((scenario) => <div className="scenario-row" key={scenario.id}><strong>{scenario.label}</strong><span className={scenario.metrics.excessReturnPct >= 0 ? 'is-up' : 'is-down'}>{signed(scenario.metrics.excessReturnPct)}%</span><span>-{scenario.metrics.maxDrawdownPct.toFixed(2)}%</span><span>{scenario.metrics.turnoverPct.toFixed(0)}%</span></div>)}
        </div>
        <div className="regime-table">
          <div className="subheading">时间分段一致性</div>
          {result.regimes.map((regime) => <div className="regime-row" key={regime.id}><span><strong>{regime.start}</strong><small>至 {regime.end}</small></span><em className={regime.excessReturnPct >= 0 ? 'is-up' : 'is-down'}>{signed(regime.excessReturnPct)}% 超额</em></div>)}
        </div>
        <ExperimentRegistry experiments={experiments} compact />
      </div>
      <div className="backtest-warnings">{result.warnings.map((warning) => <span key={warning}><ShieldAlert size={12} />{warning}</span>)}</div>
    </div>
  )
}

function ExperimentRegistry({ experiments, compact = false }: { experiments: QuantExperiment[]; compact?: boolean }) {
  return (
    <div className={`experiment-registry${compact ? ' compact' : ''}`}>
      <div className="subheading">实验登记簿 · {experiments.length} 条</div>
      {experiments.slice(0, compact ? 5 : 8).map((experiment) => (
        <div className="experiment-row" key={experiment.id}>
          <span><strong>{new Date(experiment.createdAt).toLocaleString('zh-CN', { hour12: false })}</strong><small>{experiment.dataFingerprint.slice(0, 22)}…</small></span>
          <em className={experiment.verdict.toLowerCase()}>{verdictLabel(experiment.verdict)}</em>
          <b>{experiment.knownTrialCount} 次试验</b>
        </div>
      ))}
      {experiments.length === 0 && <div className="empty-state compact">尚未运行稳健性审计</div>}
    </div>
  )
}

function CrossSectionalResultView({ result }: { result: CrossSectionalResult }) {
  return (
    <div className="cross-result">
      <div className="cross-metrics">
        <Metric label="组合收益" value={`${signed(result.metrics.totalReturnPct)}%`} tone={result.metrics.totalReturnPct >= 0 ? 'is-up' : 'is-down'} />
        <Metric label="等权基准" value={`${signed(result.metrics.benchmarkReturnPct)}%`} />
        <Metric label="超额收益" value={`${signed(result.metrics.excessReturnPct)}%`} tone={result.metrics.excessReturnPct >= 0 ? 'is-up' : 'is-down'} />
        <Metric label="最大回撤" value={`-${Math.abs(result.metrics.maxDrawdownPct).toFixed(2)}%`} tone="is-down" />
        <Metric label="排名命中率" value={`${result.metrics.rankHitRatePct.toFixed(2)}%`} />
        <Metric label="换手率" value={`${result.metrics.turnoverPct.toFixed(2)}%`} />
        <Metric label="估算成本" value={money(result.metrics.estimatedCosts)} />
        <Metric label="样本外日期" value={String(result.model.outOfSampleDates)} />
      </div>
      <CrossEquityChart points={result.equityCurve} />
      <div className="cross-current">
        <div className="ranking-table">
          <div className="subheading">{result.current.date} 横截面排名</div>
          <div className="ranking-row ranking-head"><span>排名</span><span>ETF</span><span>相对胜出概率</span><span>状态</span></div>
          {result.current.ranking.map((item) => (
            <div className={`ranking-row${item.selected ? ' selected' : ''}`} key={item.symbol}>
              <strong>#{item.rank}</strong><span><b>{item.name}</b><small>{item.symbol}</small></span><span>{(item.probability * 100).toFixed(1)}%</span><em>{item.selected ? '目标组合' : '观察'}</em>
            </div>
          ))}
        </div>
        <div className="target-allocation">
          <div className="subheading">逆波动目标权重</div>
          {result.current.targets.map((target) => (
            <div className="target-row" key={target.symbol}><span><strong>{target.name}</strong><small>{target.symbol}</small></span><i><b style={{ width: `${target.weight * 100}%` }} /></i><em>{(target.weight * 100).toFixed(1)}%</em></div>
          ))}
          <div className="target-row cash"><span><strong>现金缓冲</strong><small>未配置资金</small></span><i><b style={{ width: `${result.current.cashWeight * 100}%` }} /></i><em>{(result.current.cashWeight * 100).toFixed(1)}%</em></div>
          {result.current.targets.length === 0 && <div className="empty-state compact">没有 ETF 概率超过 50%，保持现金</div>}
        </div>
      </div>
      <div className="backtest-warnings">{result.warnings.map((warning) => <span key={warning}><ShieldAlert size={12} />{warning}</span>)}</div>
    </div>
  )
}

function CrossEquityChart({ points }: { points: CrossSectionalResult['equityCurve'] }) {
  const width = 900
  const height = 170
  const all = points.flatMap((item) => [item.equity, item.benchmark])
  const minimum = Math.min(...all)
  const maximum = Math.max(...all)
  const range = Math.max(1, maximum - minimum)
  const line = (field: 'equity' | 'benchmark') => points.map((item, index) => {
    const x = points.length <= 1 ? 0 : index / (points.length - 1) * width
    const y = height - ((item[field] - minimum) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <div className="equity-chart cross-chart">
      <div><span className="strategy-line" />横截面组合 <span className="benchmark-line" />研究池等权</div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="横截面组合样本外权益曲线"><polyline className="benchmark" points={line('benchmark')} /><polyline className="strategy" points={line('equity')} /></svg>
    </div>
  )
}

function ShadowStatus({ shadow }: { shadow: ShadowPortfolio | null }) {
  const snapshot = shadow?.lastSnapshot
  if (!snapshot) return <div className="shadow-empty">尚无影子快照。可立即记录上一完整交易日的目标组合。</div>
  return (
    <div className="shadow-status">
      <div><span>最近信号日</span><strong>{snapshot.date}</strong></div>
      <div><span>历史快照</span><strong>{shadow?.history.length ?? 0} 天</strong></div>
      <div><span>已结算</span><strong>{shadow?.performance.settledSnapshots ?? 0} 天</strong></div>
      <div><span>累计影子超额</span><strong className={(shadow?.performance.cumulativeExcessPct ?? 0) >= 0 ? 'is-up' : 'is-down'}>{signed(shadow?.performance.cumulativeExcessPct ?? 0)}%</strong></div>
      <div className="shadow-targets">
        {snapshot.targets.map((target) => <span key={target.symbol}><b>{target.symbol}</b><em>{(target.weight * 100).toFixed(1)}%</em></span>)}
        <span><b>现金</b><em>{(snapshot.cashWeight * 100).toFixed(1)}%</em></span>
      </div>
      {snapshot.outcome && <p>最近结算至 {snapshot.outcome.toDate}：组合 {signed(snapshot.outcome.portfolioReturnPct)}%，基准 {signed(snapshot.outcome.benchmarkReturnPct)}%，超额 {signed(snapshot.outcome.excessReturnPct)}%。</p>}
      <p>影子组合从未调用模拟或实盘下单接口。</p>
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

function verdictLabel(verdict: string) {
  const labels: Record<string, string> = {
    SHADOW_ONLY: '仅限影子观察',
    FRAGILE: '结果脆弱',
    REJECTED: '审计不通过',
  }
  return labels[verdict] ?? verdict
}
