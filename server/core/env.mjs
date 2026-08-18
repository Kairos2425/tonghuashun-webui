import { loadEnvFile } from 'node:process'

export function loadLocalEnv(path) {
  try {
    loadEnvFile(path)
    return true
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`[env] 无法加载 ${path}: ${error.message}`)
    return false
  }
}
