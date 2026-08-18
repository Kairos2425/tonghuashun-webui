import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const children = [
  spawn(process.execPath, [join(rootDir, 'server', 'index.mjs')], { cwd: rootDir, stdio: 'inherit', env: process.env }),
  spawn(process.execPath, [join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: rootDir, stdio: 'inherit', env: process.env }),
]

let closing = false
function close(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 300).unref()
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!closing && code !== 0) close(code || 1)
  })
}

process.on('SIGINT', () => close(0))
process.on('SIGTERM', () => close(0))
