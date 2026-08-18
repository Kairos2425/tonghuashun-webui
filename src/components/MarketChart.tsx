import { useEffect, useMemo, useRef, useState } from 'react'
import type { Candle } from '../types'
import { compact, price } from '../format'

interface Props {
  candles: Candle[]
  loading: boolean
}

interface HoverPoint {
  index: number
  x: number
  y: number
}

export function MarketChart({ candles, loading }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<HoverPoint | null>(null)
  const movingAverages = useMemo(() => ({ ma5: average(candles, 5), ma20: average(candles, 20) }), [candles])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const draw = () => drawChart(canvas, candles, movingAverages.ma5, movingAverages.ma20, hover?.index ?? -1)
    const observer = new ResizeObserver(draw)
    observer.observe(wrap)
    draw()
    return () => observer.disconnect()
  }, [candles, movingAverages, hover])

  const handlePointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (candles.length === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const plotLeft = 54
    const plotRight = rect.width - 64
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left - plotLeft) / Math.max(1, plotRight - plotLeft)))
    const index = Math.min(candles.length - 1, Math.max(0, Math.round(ratio * (candles.length - 1))))
    setHover({ index, x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  const hovered = hover ? candles[hover.index] : candles.at(-1)

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="chart-legend" aria-live="polite">
        {hovered ? (
          <>
            <span>{hovered.date}</span>
            <span>开 <b>{price(hovered.open)}</b></span>
            <span>高 <b>{price(hovered.high)}</b></span>
            <span>低 <b>{price(hovered.low)}</b></span>
            <span>收 <b>{price(hovered.close)}</b></span>
            <span>量 <b>{compact(hovered.volume)}</b></span>
          </>
        ) : <span>暂无 K 线数据</span>}
      </div>
      <canvas
        ref={canvasRef}
        onPointerMove={handlePointer}
        onPointerLeave={() => setHover(null)}
        aria-label="日 K 线图，红色上涨，绿色下跌"
      />
      {loading && <div className="chart-loading">正在更新 K 线</div>}
      {hover && hovered && (
        <div className="chart-tooltip" style={{ left: Math.min(hover.x + 12, 250), top: Math.max(40, hover.y - 44) }}>
          {hovered.date} · 收 {price(hovered.close)}
        </div>
      )}
    </div>
  )
}

function average(candles: Candle[], period: number) {
  return candles.map((_, index) => {
    if (index < period - 1) return null
    const slice = candles.slice(index - period + 1, index + 1)
    return slice.reduce((sum, item) => sum + item.close, 0) / period
  })
}

function drawChart(canvas: HTMLCanvasElement, candles: Candle[], ma5: Array<number | null>, ma20: Array<number | null>, hoverIndex: number) {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(320, rect.width)
  const height = Math.max(260, rect.height)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const left = 54
  const right = 62
  const top = 34
  const volumeHeight = Math.max(48, height * 0.2)
  const bottom = 26
  const priceBottom = height - volumeHeight - bottom - 18
  const plotWidth = width - left - right
  const priceHeight = priceBottom - top

  if (candles.length === 0) {
    ctx.fillStyle = '#7b8491'
    ctx.font = '13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('暂无 K 线数据', width / 2, height / 2)
    return
  }

  const low = Math.min(...candles.map((item) => item.low))
  const high = Math.max(...candles.map((item) => item.high))
  const range = Math.max(0.001, high - low)
  const paddedLow = low - range * 0.08
  const paddedHigh = high + range * 0.08
  const maxVolume = Math.max(...candles.map((item) => item.volume), 1)
  const slot = plotWidth / candles.length
  const candleWidth = Math.max(2, Math.min(9, slot * 0.62))
  const x = (index: number) => left + slot * (index + 0.5)
  const y = (value: number) => top + ((paddedHigh - value) / (paddedHigh - paddedLow)) * priceHeight

  ctx.strokeStyle = '#e7ebef'
  ctx.fillStyle = '#7b8491'
  ctx.lineWidth = 1
  ctx.font = '11px ui-monospace, monospace'
  ctx.textAlign = 'right'
  for (let line = 0; line <= 4; line += 1) {
    const rowY = top + (priceHeight / 4) * line
    ctx.beginPath()
    ctx.moveTo(left, rowY)
    ctx.lineTo(width - right, rowY)
    ctx.stroke()
    const label = paddedHigh - ((paddedHigh - paddedLow) / 4) * line
    ctx.fillText(price(label), width - 8, rowY + 4)
  }

  candles.forEach((candle, index) => {
    const color = candle.close >= candle.open ? '#d92d20' : '#07883d'
    const cx = x(index)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(cx, y(candle.high))
    ctx.lineTo(cx, y(candle.low))
    ctx.stroke()
    const bodyTop = Math.min(y(candle.open), y(candle.close))
    const bodyHeight = Math.max(1, Math.abs(y(candle.open) - y(candle.close)))
    ctx.fillRect(cx - candleWidth / 2, bodyTop, candleWidth, bodyHeight)
    const volumeBar = (candle.volume / maxVolume) * (volumeHeight - 12)
    ctx.globalAlpha = 0.55
    ctx.fillRect(cx - candleWidth / 2, height - bottom - volumeBar, candleWidth, volumeBar)
    ctx.globalAlpha = 1
  })

  drawAverage(ctx, ma5, x, y, '#c78b00')
  drawAverage(ctx, ma20, x, y, '#356ad2')

  ctx.textAlign = 'left'
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillStyle = '#c78b00'
  ctx.fillText('MA5', left, 18)
  ctx.fillStyle = '#356ad2'
  ctx.fillText('MA20', left + 42, 18)
  ctx.fillStyle = '#7b8491'
  ctx.fillText('VOL', left + 94, 18)

  const markCount = Math.min(5, candles.length)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#7b8491'
  for (let mark = 0; mark < markCount; mark += 1) {
    const index = Math.round((candles.length - 1) * (mark / Math.max(1, markCount - 1)))
    ctx.fillText(candles[index].date.slice(5), x(index), height - 7)
  }

  if (hoverIndex >= 0) {
    const hoverX = x(hoverIndex)
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = '#7b8491'
    ctx.beginPath()
    ctx.moveTo(hoverX, top)
    ctx.lineTo(hoverX, height - bottom)
    ctx.stroke()
    ctx.restore()
  }
}

function drawAverage(ctx: CanvasRenderingContext2D, values: Array<number | null>, x: (index: number) => number, y: (value: number) => number, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.4
  ctx.beginPath()
  let started = false
  values.forEach((value, index) => {
    if (value === null) return
    if (!started) {
      ctx.moveTo(x(index), y(value))
      started = true
    } else {
      ctx.lineTo(x(index), y(value))
    }
  })
  if (started) ctx.stroke()
}
