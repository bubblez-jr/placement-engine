import type { Breakpoints } from './types'

/**
 * Piecewise-linear value function. Points are [x, value] sorted by x;
 * values outside the range clamp to the end points.
 * Example: [[20, 1], [45, 0.5], [75, 0]] — a 20-minute school run scores 1.0,
 * 45 minutes 0.5, 75 minutes or more 0.
 */
export function piecewise(points: Breakpoints, x: number): number {
  if (points.length === 0) return 0
  const pts = [...points].sort((a, b) => a[0] - b[0])
  if (x <= pts[0][0]) return pts[0][1]
  const last = pts[pts.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < pts.length; i++) {
    const [x1, v1] = pts[i]
    const [x0, v0] = pts[i - 1]
    if (x <= x1) return v0 + ((x - x0) / (x1 - x0)) * (v1 - v0)
  }
  return last[1]
}

export function round(n: number, dp = 1): number {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

export function money(n: number): number {
  return Math.round(n * 100) / 100
}
