import { Bot, CheckCircle2, KeyRound, LoaderCircle, Send, ShieldAlert, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../api'
import type { AiAnalysis, Quote } from '../types'

interface Props {
  quote?: Quote
  configured: boolean
  onOpenSettings: () => void
}

const QUICK_PROMPTS = [
  '用小白能懂的话解释今天的涨跌',
  '列出我最容易忽略的三个风险',
  '给我一份不急着下单的观察计划',
]

export function AiAssistant({ quote, configured, onOpenSettings }: Props) {
  const [question, setQuestion] = useState('')
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const ask = async (prompt = question) => {
    if (!quote || !prompt.trim() || loading) return
    setQuestion(prompt)
    setError('')
    setLoading(true)
    try {
      setAnalysis(await api.analyze(quote.symbol, prompt))
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 412) onOpenSettings()
      setError(reason instanceof Error ? reason.message : '分析失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="panel ai-panel" aria-label="DeepSeek 研究助手">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DeepSeek 研究助手</span>
          <h2>{quote ? `正在看 ${quote.name}` : '选择一个标的'}</h2>
        </div>
        <span className={`connection-dot${configured ? ' is-online' : ''}`} title={configured ? 'DeepSeek 已配置' : 'DeepSeek 未配置'}>
          <Bot size={18} aria-hidden="true" />
        </span>
      </div>

      {!configured && (
        <button className="setup-callout" type="button" onClick={onOpenSettings}>
          <KeyRound size={17} aria-hidden="true" />
          <span><strong>连接 DeepSeek</strong><small>密钥用 Windows DPAPI 加密保存在本机</small></span>
        </button>
      )}

      <div className="quick-prompts">
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt} type="button" onClick={() => void ask(prompt)} disabled={!configured || loading}>{prompt}</button>
        ))}
      </div>

      <div className="ai-scroll">
        {!analysis && !loading && (
          <div className="ai-empty">
            <Sparkles size={22} aria-hidden="true" />
            <p>AI 只负责研究和风险清单，不能提交订单。</p>
          </div>
        )}
        {loading && <div className="ai-loading"><LoaderCircle className="spin" size={20} />正在整理事实、推断与未知</div>}
        {error && <div className="inline-error"><ShieldAlert size={16} />{error}</div>}
        {analysis && !loading && (
          <div className="analysis-result">
            <p className="analysis-summary">{analysis.result.summary || '分析已完成'}</p>
            <AnalysisList title="可能有利" items={analysis.result.bullCase} tone="positive" />
            <AnalysisList title="可能不利" items={analysis.result.bearCase} tone="negative" />
            <AnalysisList title="先核对这些风险" items={analysis.result.risks} tone="warning" />
            <AnalysisList title="下一步检查" items={analysis.result.nextChecks} tone="neutral" />
            {analysis.result.plan && (
              <div className="analysis-plan">
                <strong>计划草稿</strong>
                <dl>
                  <div><dt>动作</dt><dd>{analysis.result.plan.action || '继续观察'}</dd></div>
                  <div><dt>触发</dt><dd>{analysis.result.plan.trigger || '未给出'}</dd></div>
                  <div><dt>失效</dt><dd>{analysis.result.plan.invalidates || '未给出'}</dd></div>
                </dl>
              </div>
            )}
            <div className="analysis-meta">{analysis.model} · {new Date(analysis.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</div>
          </div>
        )}
      </div>

      <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void ask() }}>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="问走势、风险或观察计划" rows={2} maxLength={2_000} disabled={!configured} />
        <button className="icon-button primary" type="submit" title="发送给 DeepSeek" disabled={!configured || !question.trim() || loading}>
          <Send size={17} aria-hidden="true" />
        </button>
      </form>
      <div className="ai-disclaimer"><ShieldAlert size={13} />无实时新闻，不构成投资建议；以君弘报价和公告为准</div>
    </section>
  )
}

function AnalysisList({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
  if (!items?.length) return null
  return (
    <div className={`analysis-list ${tone}`}>
      <strong>{title}</strong>
      <ul>{items.map((item, index) => <li key={`${title}-${index}`}><CheckCircle2 size={13} />{item}</li>)}</ul>
    </div>
  )
}
