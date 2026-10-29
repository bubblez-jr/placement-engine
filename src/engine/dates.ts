import type { IsoDate, IsoDateTime } from './types'

/** Parse YYYY-MM-DD as a UTC date (no timezone drift). */
export function parseDate(d: IsoDate): Date {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const x = parseDate(d)
  x.setUTCDate(x.getUTCDate() + days)
  return toIsoDate(x)
}

/** Whole days from a to b (b − a) */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000)
}

export function hoursBetween(a: IsoDateTime, b: IsoDateTime): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "4 Nov 2026" */
export function formatDate(d: IsoDate | IsoDateTime): string {
  const x = parseDate(d)
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`
}

/** "4 Nov 2026, 14:05" in local time */
export function formatDateTime(d: IsoDateTime): string {
  const x = new Date(d)
  const hh = String(x.getHours()).padStart(2, '0')
  const mm = String(x.getMinutes()).padStart(2, '0')
  return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}, ${hh}:${mm}`
}
