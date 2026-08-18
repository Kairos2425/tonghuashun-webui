import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'

const PROTECT_SCRIPT = "$plain=[Console]::In.ReadToEnd();$bytes=[Text.Encoding]::UTF8.GetBytes($plain);$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($protected))"
const UNPROTECT_SCRIPT = "$encoded=[Console]::In.ReadToEnd().Trim();$bytes=[Convert]::FromBase64String($encoded);$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))"

export class SecretStore {
  constructor(filePath) {
    this.filePath = filePath
  }

  async status() {
    if (process.env.DEEPSEEK_API_KEY) return { configured: true, source: 'environment', protected: true }
    try {
      await readFile(this.filePath, 'utf8')
      return { configured: true, source: 'windows_dpapi', protected: true }
    } catch (error) {
      if (error?.code !== 'ENOENT') return { configured: false, source: 'error', protected: false }
      return { configured: false, source: 'none', protected: false }
    }
  }

  async get() {
    if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
    if (process.platform !== 'win32') return null
    try {
      const encrypted = await readFile(this.filePath, 'utf8')
      return await runPowerShell(UNPROTECT_SCRIPT, encrypted)
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async set(value) {
    if (process.env.DEEPSEEK_API_KEY) throw new Error('密钥来自环境变量，请在启动环境中替换')
    const key = String(value ?? '').trim()
    if (key.length < 16 || !key.startsWith('sk-')) throw new Error('DeepSeek API Key 格式不正确')
    if (process.platform !== 'win32') throw new Error('非 Windows 环境请使用 DEEPSEEK_API_KEY 环境变量')
    const encrypted = await runPowerShell(PROTECT_SCRIPT, key)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, encrypted, { encoding: 'utf8', mode: 0o600 })
    return this.status()
  }

  async clear() {
    if (process.env.DEEPSEEK_API_KEY) throw new Error('密钥来自环境变量，请在启动环境中移除')
    await rm(this.filePath, { force: true })
    return this.status()
  }
}

function runPowerShell(script, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let errors = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors.trim() || `PowerShell exited ${code}`)))
    child.stdin.end(input)
  })
}
