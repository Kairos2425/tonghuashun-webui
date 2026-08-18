import { access } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GTJA_DOWNLOAD_URL = 'https://fy.gtht.com/fuyi-download/'
const GTJA_PERMISSION_URL = 'https://open.gtja.com/'
const SUPERMIND_PERMISSION_URL = 'https://quant.10jqka.com.cn/view/help/14'
const CLIENT_PATH_CACHE_MS = 10_000
let clientPathCache = { value: null, expiresAt: 0 }

export async function connectorStatuses({ clientPathResolver = resolveGtjaClientPath } = {}) {
  const clientPath = await clientPathResolver()
  const gtjaApiConfigured = Boolean(process.env.GTJA_API_BRIDGE_URL && process.env.GTJA_API_BRIDGE_TOKEN)
  const supermindConfigured = Boolean(process.env.SUPERMIND_BRIDGE_URL && process.env.SUPERMIND_BRIDGE_TOKEN)
  return [
    {
      id: 'paper',
      name: '模拟账户',
      kind: 'paper',
      status: 'ready',
      canSubmit: true,
      description: '本地 1 万元模拟资金，强制用于实盘前验证。',
    },
    {
      id: 'gtja-manual',
      name: '国泰海通君弘',
      kind: 'manual_live',
      status: clientPath ? 'ready' : 'needs_client',
      canSubmit: true,
      clientPath: clientPath || null,
      downloadUrl: GTJA_DOWNLOAD_URL,
      description: clientPath
        ? '工作台生成并校验订单，最终在君弘富易内由你本人确认。'
        : '桌面端未安装；仍可生成订单草稿，再到君弘 APP 由你本人确认。',
    },
    {
      id: 'gtja-api',
      name: '国泰海通 STS / 官方 API',
      kind: 'live_api',
      status: gtjaApiConfigured ? 'configured' : 'needs_permission',
      canSubmit: gtjaApiConfigured && process.env.LIVE_TRADING_ENABLED === 'true',
      permissionUrl: GTJA_PERMISSION_URL,
      description: '普通君弘登录不能直接使用；需券商确认程序化交易报告、接口权限和官方桥接。',
    },
    {
      id: 'supermind',
      name: '同花顺 SuperMind',
      kind: 'live_api',
      status: supermindConfigured ? 'configured' : 'needs_permission',
      canSubmit: supermindConfigured && process.env.LIVE_TRADING_ENABLED === 'true',
      permissionUrl: SUPERMIND_PERMISSION_URL,
      description: '需要 SuperMind 实盘版本、受支持券商账户和官方交易接口权限。',
    },
  ]
}

export async function launchGtjaClient() {
  const path = await resolveGtjaClientPath({ force: true })
  if (!path) {
    const error = new Error('未检测到君弘富易客户端')
    error.statusCode = 412
    error.downloadUrl = GTJA_DOWNLOAD_URL
    throw error
  }
  const child = spawn(path, [], { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  return { launched: true, path }
}

export async function submitOfficialOrder(connectorId, order, confirmationText) {
  if (process.env.LIVE_TRADING_ENABLED !== 'true') throw withStatus('实盘 API 总开关未启用', 423)
  const prefix = connectorId === 'gtja-api' ? 'GTJA' : 'SUPERMIND'
  const baseUrl = process.env[`${prefix}_BRIDGE_URL`]
  const token = process.env[`${prefix}_BRIDGE_TOKEN`]
  if (!baseUrl || !token) throw withStatus('官方交易桥接服务未配置', 412)
  const expected = `LIVE-${order.symbol}-${order.quantity}`
  if (confirmationText !== expected) throw withStatus('实盘确认文本不匹配', 400)
  const response = await fetch(new URL('/orders', baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientOrderId: randomUUID(), ...order }),
    signal: AbortSignal.timeout(8_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw withStatus(payload?.message || `券商桥接返回 HTTP ${response.status}`, 502)
  return payload
}

async function resolveGtjaClientPath({ force = false } = {}) {
  if (!force && clientPathCache.expiresAt > Date.now()) return clientPathCache.value
  const candidates = [
    ...knownClientPaths(),
    ...await registeredClientPaths(),
  ]
  for (const rawCandidate of candidates) {
    const candidate = cleanExecutablePath(rawCandidate)
    if (!candidate) continue
    try {
      await access(candidate)
      clientPathCache = { value: candidate, expiresAt: Date.now() + CLIENT_PATH_CACHE_MS }
      return candidate
    } catch {
      // Continue through official install records and known paths.
    }
  }
  clientPathCache = { value: null, expiresAt: Date.now() + CLIENT_PATH_CACHE_MS }
  return null
}

function knownClientPaths() {
  return [
    process.env.GTJA_CLIENT_PATH,
    'C:\\new_fuyi\\TdxW.exe',
    'C:\\国泰海通富易\\TdxW.exe',
    'C:\\国泰海通君弘富易\\TdxW.exe',
    ...pathsBelow(process.env.ProgramFiles),
    ...pathsBelow(process.env['ProgramFiles(x86)']),
    ...pathsBelow(process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')),
  ].filter(Boolean)
}

function pathsBelow(root) {
  if (!root) return []
  return [
    join(root, 'GTJA', 'Fuyi', 'Fuyi.exe'),
    join(root, 'GTJA', 'Fuyi', 'TdxW.exe'),
    join(root, '国泰海通', '富易', 'Fuyi.exe'),
    join(root, '国泰海通', '富易', 'TdxW.exe'),
    join(root, '国泰海通富易', 'Fuyi.exe'),
    join(root, '国泰海通富易', 'TdxW.exe'),
    join(root, '国泰君安', '富易', 'Fuyi.exe'),
    join(root, '国泰君安', '富易', 'TdxW.exe'),
  ]
}

async function registeredClientPaths() {
  if (process.platform !== 'win32') return []
  const script = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$roots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$paths = @()
Get-ItemProperty $roots -ErrorAction SilentlyContinue |
  Where-Object { ([string]$_.DisplayName) -match '富易|Fuyi|Richeasy' } |
  ForEach-Object {
    if ($_.DisplayIcon) {
      $icon = [Environment]::ExpandEnvironmentVariables(([string]$_.DisplayIcon))
      $paths += (($icon -replace ',\s*-?\d+$', '').Trim('"'))
    }
    if ($_.InstallLocation) {
      $location = [Environment]::ExpandEnvironmentVariables(([string]$_.InstallLocation).Trim('"'))
      foreach ($relative in @('TdxW.exe', 'Fuyi.exe', 'Richeasy.exe', 'bin\TdxW.exe', 'bin\Fuyi.exe', 'bin\Richeasy.exe')) {
        $paths += Join-Path $location $relative
      }
    }
  }
$existing = @($paths | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique)
ConvertTo-Json -InputObject $existing -Compress
`
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true,
      maxBuffer: 512 * 1024,
    })
    const parsed = JSON.parse(stdout.trim() || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function cleanExecutablePath(value) {
  if (typeof value !== 'string') return null
  const path = value.trim().replace(/^"|"$/g, '')
  return /\.exe$/i.test(path) ? path : null
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
