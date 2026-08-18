import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from '../server/core/env.mjs'
import { SecretStore } from '../server/core/secrets.mjs'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
loadLocalEnv(join(rootDir, '.env.local'))
const binPath = join(rootDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dshHome = process.env.DSH_HOME || join(rootDir, '.dsh')
const secrets = new SecretStore(join(rootDir, '.data', 'deepseek-key.dpapi'))
const apiKey = await secrets.get().catch(() => null)

console.log(`[harness] DSH_HOME=${dshHome}`)
console.log(`[harness] DeepSeek 凭据：${apiKey || process.env.DEEPSEEK_API_KEY ? '已从本机安全存储注入子进程' : '未配置，可在工作台设置中添加'}`)

const child = spawn(process.execPath, [binPath, 'web', ...process.argv.slice(2)], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DSH_HOME: dshHome,
    ...(apiKey && !process.env.DEEPSEEK_API_KEY ? { DEEPSEEK_API_KEY: apiKey } : {}),
  },
})

child.on('error', (error) => {
  console.error(`[harness] 启动失败：${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) console.error(`[harness] 已由信号 ${signal} 结束`)
  process.exitCode = code ?? (signal ? 1 : 0)
})
