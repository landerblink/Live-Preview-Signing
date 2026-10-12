export const BOARD_W = 1000
export const BOARD_H = 750
export type Pt = [number, number, number] // x, y (board units), pressure 0..1
export type Stroke = { id: string; color: string; width: number; points: Pt[] }
export type InkMsg = { id: string; color: string; width: number; pts: Pt[] }

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, k: number) {
  ctx.strokeStyle = s.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const p = s.points
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i]
    if (!a || !b) continue
    ctx.lineWidth = s.width * k * (0.4 + b[2]) // pen pressure -> thickness
    ctx.beginPath()
    ctx.moveTo(a[0] * k, a[1] * k)
    ctx.lineTo(b[0] * k, b[1] * k)
    ctx.stroke()
  }
}

export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
