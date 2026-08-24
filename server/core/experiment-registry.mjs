import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export class ExperimentRegistryStore {
  constructor(filePath) {
    this.filePath = filePath
    this.pendingMutation = Promise.resolve()
  }

  async get() {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8'))
      return { version: 1, experiments: Array.isArray(value?.experiments) ? value.experiments : [] }
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, experiments: [] }
      throw error
    }
  }

  async record(input) {
    return this.mutate(async () => {
      const current = await this.get()
      const experiment = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        modelId: String(input.modelId ?? '').slice(0, 80),
        dataFingerprint: String(input.dataFingerprint ?? '').slice(0, 128),
        universe: Array.isArray(input.universe) ? input.universe.map(String).slice(0, 10) : [],
        signalDate: String(input.signalDate ?? '').slice(0, 10),
        verdict: String(input.verdict ?? 'REJECTED').slice(0, 32),
        knownTrialCount: Number(input.knownTrialCount || 0),
        selectionBiasNotice: String(input.selectionBiasNotice ?? '').slice(0, 500),
        summary: input.summary ?? {},
        checks: Array.isArray(input.checks) ? input.checks.slice(0, 20) : [],
        baseMetrics: input.baseMetrics ?? {},
      }
      const next = { version: 1, experiments: [experiment, ...current.experiments].slice(0, 50) }
      await this.save(next)
      return { experiment, registry: next }
    })
  }

  async save(value) {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
  }

  mutate(operation) {
    const result = this.pendingMutation.then(operation, operation)
    this.pendingMutation = result.catch(() => {})
    return result
  }
}
