import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck, Trash2, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'

interface Props {
  configured: boolean
  source: string
  onClose: () => void
  onChanged: () => Promise<void>
}

export function SettingsDialog({ configured, source, onClose, onChanged }: Props) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const environmentManaged = source === 'environment'

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api.saveDeepSeekKey(key)
      setKey('')
      setSaved(true)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    setError('')
    try {
      await api.clearDeepSeekKey()
      setSaved(false)
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '清除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="dialog-head">
          <div><span className="eyebrow">本机设置</span><h2 id="settings-title">连接 DeepSeek</h2></div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭"><X size={18} /></button>
        </div>
        <div className="secret-status">
          <span className={configured ? 'secret-icon configured' : 'secret-icon'}>{configured ? <CheckCircle2 size={19} /> : <KeyRound size={19} />}</span>
          <div><strong>{configured ? 'API Key 已配置' : '尚未配置 API Key'}</strong><p>{environmentManaged ? '密钥来自启动环境，请在启动工作台的环境中替换或移除。' : '密钥由 Windows 当前用户 DPAPI 加密，浏览器无法读取明文。'}</p></div>
        </div>
        {!environmentManaged && (
          <label className="field secret-field">
            <span>{configured ? '替换 API Key' : 'DeepSeek API Key'}</span>
            <input type="password" value={key} onChange={(event) => { setKey(event.target.value); setSaved(false) }} placeholder="sk-..." autoComplete="new-password" />
          </label>
        )}
        <div className="security-note"><ShieldCheck size={16} />不会提交到 Git，也不会发送给券商；仅用于请求 DeepSeek 官方 API。</div>
        {saved && <div className="inline-success"><CheckCircle2 size={15} />密钥已安全保存</div>}
        {error && <div className="inline-error"><XCircle size={15} />{error}</div>}
        <div className="dialog-actions split-actions">
          {configured && !environmentManaged && <button className="button ghost-danger" type="button" onClick={() => void clear()} disabled={busy}><Trash2 size={15} />清除密钥</button>}
          <span />
          <button className="button secondary" type="button" onClick={onClose}>关闭</button>
          {!environmentManaged && <button className="button primary" type="button" onClick={() => void save()} disabled={busy || key.length < 16}>{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}保存</button>}
        </div>
      </div>
    </div>
  )
}
