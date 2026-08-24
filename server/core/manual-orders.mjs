import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export class ManualOrderStore {
  constructor(filePath, auditPath) {
    this.filePath = filePath
    this.auditPath = auditPath
    this.pendingMutation = Promise.resolve()
  }

  async list() {
    try {
      const payload = JSON.parse(await readFile(this.filePath, 'utf8'))
      return Array.isArray(payload) ? payload : []
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
  }

  async create(order, preview) {
    return this.mutate(() => this.createUnlocked(order, preview))
  }

  async createUnlocked(order, preview) {
    const orders = await this.list()
    const record = {
      id: randomUUID(),
      previewId: preview.id,
      broker: order.broker,
      status: 'awaiting_broker_confirmation',
      ...order,
      amount: preview.amount,
      fees: preview.fees,
      submittedAt: new Date().toISOString(),
    }
    orders.unshift(record)
    await this.save(orders.slice(0, 500))
    await this.audit('manual_order_created', record)
    return record
  }

  async reconcile(id, input) {
    return this.mutate(() => this.reconcileUnlocked(id, input))
  }

  async reconcileUnlocked(id, input) {
    const orders = await this.list()
    const index = orders.findIndex((item) => item.id === id)
    if (index < 0) throw withStatus('找不到待回填委托', 404)
    if (!['filled', 'partially_filled', 'partially_filled_cancelled', 'cancelled', 'rejected'].includes(input?.status)) throw withStatus('回填状态无效', 400)
    const previous = orders[index]
    if (!['awaiting_broker_confirmation', 'partially_filled'].includes(previous.status)) throw withStatus('该委托已进入终态，不能重复修改', 409)
    if (previous.status === 'partially_filled' && ['cancelled', 'rejected'].includes(input.status)) {
      throw withStatus('已有部分成交，请选择“余量已撤”或继续回填成交', 400)
    }
    const hasFill = ['filled', 'partially_filled', 'partially_filled_cancelled'].includes(input.status)
    const fillPrice = hasFill ? positiveNumber(input.fillPrice, '成交价') : null
    const fallbackQuantity = input.status === 'filled' ? previous.quantity : previous.fillQuantity
    const fillQuantity = hasFill ? positiveInteger(input.fillQuantity ?? fallbackQuantity, '累计成交数量') : 0
    if (hasFill && fillQuantity > previous.quantity) throw withStatus('成交数量不能超过草稿委托数量', 400)
    if (hasFill && fillQuantity < Number(previous.fillQuantity || 0)) throw withStatus('累计成交数量不能小于上次回填数量', 400)
    if (input.status === 'filled' && fillQuantity !== previous.quantity) throw withStatus('全部成交的数量必须等于委托数量；不足时请选择部分成交', 400)
    if (['partially_filled', 'partially_filled_cancelled'].includes(input.status) && fillQuantity >= previous.quantity) throw withStatus('部分成交数量必须小于委托数量', 400)
    if (hasFill && previous.side === 'BUY' && fillPrice > previous.price) throw withStatus('限价买入的成交价不能高于草稿限价，请核对录入', 400)
    if (hasFill && previous.side === 'SELL' && fillPrice < previous.price) throw withStatus('限价卖出的成交价不能低于草稿限价，请核对录入', 400)
    const updated = {
      ...previous,
      status: input.status,
      brokerOrderId: String(input.brokerOrderId ?? previous.brokerOrderId ?? '').trim().slice(0, 80) || null,
      fillPrice,
      fillQuantity,
      note: String(input.note ?? previous.note ?? '').trim().slice(0, 300),
      reconciliationCount: Number(previous.reconciliationCount || 0) + 1,
      reconciledAt: new Date().toISOString(),
    }
    orders[index] = updated
    await this.save(orders)
    await this.audit('manual_order_reconciled', updated)
    return updated
  }

  async audit(event, payload) {
    await mkdir(dirname(this.auditPath), { recursive: true })
    const entry = { event, at: new Date().toISOString(), payload }
    await appendFile(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  async save(orders) {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(orders, null, 2)}\n`, 'utf8')
    await rename(temporary, this.filePath)
  }

  mutate(operation) {
    const result = this.pendingMutation.then(operation, operation)
    this.pendingMutation = result.catch(() => {})
    return result
  }
}

function positiveNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw withStatus(`${label}必须大于 0`, 400)
  return number
}

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw withStatus(`${label}必须是正整数`, 400)
  return number
}

function withStatus(message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
