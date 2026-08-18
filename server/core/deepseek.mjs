const SYSTEM_PROMPT = `你是一个面向中国 A 股新手的研究助手。你只能做信息整理、风险教育和交易计划草稿，不能承诺收益，不能代替持牌投顾，不能调用下单工具，也不能声称知道输入中没有的新闻或基本面。\n\n回答必须是 JSON 对象，字段为：summary（简短结论）、whatChanged（数组）、bullCase（数组）、bearCase（数组）、risks（数组）、nextChecks（数组）、plan（对象，含 action、trigger、invalidates、maxLossNote）。明确区分事实、推断和未知；提醒用户以券商交易页报价和公告为准。`

export async function analyzeWithDeepSeek({ key, question, instrument, quote, position, model }) {
  if (!key) {
    const error = new Error('DeepSeek 尚未配置')
    error.statusCode = 412
    throw error
  }
  const cleanQuestion = String(question ?? '').trim().slice(0, 2_000)
  if (!cleanQuestion) {
    const error = new Error('请输入要分析的问题')
    error.statusCode = 400
    throw error
  }
  const context = {
    instrument: sanitize(instrument),
    quote: sanitize(quote),
    position: sanitize(position),
    limitations: ['公开行情可能延迟', '未提供实时新闻与公告', 'AI 不得提交订单'],
  }
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.2,
      max_tokens: 1_200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `上下文：${JSON.stringify(context)}\n\n用户问题：${cleanQuestion}` },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `DeepSeek API 返回 HTTP ${response.status}`)
    error.statusCode = response.status
    throw error
  }
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('DeepSeek 返回内容为空')
  let result
  try {
    result = JSON.parse(content)
  } catch {
    result = { summary: content, whatChanged: [], bullCase: [], bearCase: [], risks: [], nextChecks: [], plan: {} }
  }
  return {
    model: payload.model || model || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    usage: payload.usage ?? null,
    generatedAt: new Date().toISOString(),
    result,
  }
}

function sanitize(value) {
  if (!value || typeof value !== 'object') return null
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/account|password|token|secret|phone|identity/i.test(key)) return undefined
    return item
  }))
}
