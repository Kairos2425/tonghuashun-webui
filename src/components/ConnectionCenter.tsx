import { Bot, CheckCircle2, CircleHelp, ExternalLink, KeyRound, Link2, LockKeyhole, MonitorDown, PlugZap, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { api, ApiError } from '../api'
import type { HealthResponse } from '../types'

interface Props {
  health?: HealthResponse
  onOpenSettings: () => void
}

export function ConnectionCenter({ health, onOpenSettings }: Props) {
  const launchGtja = async () => {
    try {
      await api.launchGtja()
    } catch (reason) {
      if (reason instanceof ApiError && reason.downloadUrl) window.open(reason.downloadUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="connections-view">
      <section className="panel connection-overview">
        <div className="panel-heading">
          <div><span className="eyebrow">连接中心</span><h2>数据、AI 与交易通道</h2></div>
          <PlugZap size={19} />
        </div>
        <div className="connection-summary">
          <StatusMetric icon={<ShieldCheck size={17} />} label="本地服务" value={health?.localOnly ? '仅本机' : '检查中'} ok={Boolean(health?.localOnly)} />
          <StatusMetric icon={<Bot size={17} />} label="DeepSeek" value={health?.deepseek.configured ? '已配置' : '待配置'} ok={Boolean(health?.deepseek.configured)} />
          <StatusMetric icon={<Link2 size={17} />} label="公开行情" value={health?.market.source || '检查中'} ok={health?.market.sourceKind === 'public_reference'} />
          <StatusMetric icon={<LockKeyhole size={17} />} label="接口实盘" value={health?.liveEnabled ? '已解锁' : '默认锁定'} ok={false} />
        </div>
      </section>

      <section className="panel connectors-panel">
        <div className="panel-heading"><div><span className="eyebrow">交易通道</span><h2>国泰海通君弘优先</h2></div></div>
        <div className="connector-list">
          {health?.connectors.map((connector) => (
            <div className="connector-row" key={connector.id}>
              <div className={`connector-icon ${connector.kind}`}>
                {connector.id === 'paper' ? <ShieldCheck size={19} /> : connector.kind === 'manual_live' ? <MonitorDown size={19} /> : <KeyRound size={19} />}
              </div>
              <div className="connector-copy">
                <div><strong>{connector.name}</strong><span className={`status-pill ${connector.status}`}>{connectorStatus(connector.status)}</span></div>
                <p>{connector.description}</p>
                {connector.clientPath && <code>{connector.clientPath}</code>}
              </div>
              <div className="connector-actions">
                {connector.id === 'gtja-manual' && <button className="button secondary" type="button" onClick={() => void launchGtja()}><ExternalLink size={15} />{connector.status === 'ready' ? '打开客户端' : '官方下载安装'}</button>}
                {connector.id === 'paper' && <span className="ready-mark"><CheckCircle2 size={15} />可用</span>}
                {connector.kind === 'live_api' && connector.permissionUrl && <a className="text-link" href={connector.permissionUrl} target="_blank" rel="noreferrer">开通说明 <ExternalLink size={13} /></a>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel harness-panel">
        <div className="panel-heading"><div><span className="eyebrow">DeepSeek Harness</span><h2>独立智能体工作区</h2></div><Bot size={19} /></div>
        <div className="harness-status">
          <div className={health?.harness.running ? 'harness-orbit online' : 'harness-orbit'}><span /></div>
          <div><strong>{health?.harness.running ? 'Harness 正在运行' : 'Harness 已安装，服务未启动'}</strong><p>用于深度研究、文件分析与长任务；交易提交仍由本工作台风控隔离。</p></div>
          <a className={`button ${health?.harness.running ? 'primary' : 'secondary'}`} href={health?.harness.url || 'http://127.0.0.1:3080'} target="_blank" rel="noreferrer"><ExternalLink size={15} />打开 Harness</a>
        </div>
      </section>

      <section className="panel security-panel">
        <div className="panel-heading"><div><span className="eyebrow">密钥与权限</span><h2>敏感信息留在本机</h2></div><ShieldCheck size={19} /></div>
        <div className="security-grid">
          <div><KeyRound size={18} /><strong>DeepSeek 密钥</strong><p>{deepSeekCredentialLabel(health?.deepseek.source)}</p><button className="text-button" type="button" onClick={onOpenSettings}>管理密钥</button></div>
          <div><LockKeyhole size={18} /><strong>交易密码</strong><p>只在君弘官方客户端输入</p><span className="muted-action">工作台不读取</span></div>
          <div><CircleHelp size={18} /><strong>程序化权限</strong><p>先联系 95521 或客户经理完成报告与权限确认</p><a className="text-link" href="https://open.gtja.com/" target="_blank" rel="noreferrer">官方申请入口</a></div>
        </div>
      </section>
    </div>
  )
}

function StatusMetric({ icon, label, value, ok }: { icon: ReactNode; label: string; value: string; ok: boolean }) {
  return <div className="status-metric">{icon}<span>{label}</span><strong className={ok ? 'ok' : ''}>{value}</strong></div>
}

function connectorStatus(status: string) {
  if (status === 'ready') return '可用'
  if (status === 'configured') return '已配置'
  if (status === 'needs_client') return '待安装'
  return '待开通'
}

function deepSeekCredentialLabel(source?: string) {
  if (source === 'environment') return '由启动环境管理'
  if (source === 'windows_dpapi') return 'Windows DPAPI 已加密'
  return '尚未配置'
}
