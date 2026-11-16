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

// ---------- UK wall-clock time and working days ----------
// The engine never reads the clock: every function below takes the instant it
// works from. UK time (Europe/London, with summer time) comes from the
// standard time-zone data, which gives the same answer every run.

export const UK_TIME_ZONE = 'Europe/London'

const ukFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** The UK calendar date and HH:MM of an instant. */
export function ukParts(at: IsoDateTime): { date: IsoDate; time: string } {
  const p = Object.fromEntries(ukFormat.formatToParts(new Date(at)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

/** The UK calendar date of an instant: "today" for an officer in England. */
export function ukDate(at: IsoDateTime): IsoDate {
  return ukParts(at).date
}

function ukOffsetMs(ms: number): number {
  const p = Object.fromEntries(ukFormat.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** The instant that is `time` (HH:MM) UK time on `date`. */
export function ukTimeToIso(date: IsoDate, time: string): IsoDateTime {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  let ms = wall - ukOffsetMs(wall)
  ms = wall - ukOffsetMs(ms)
  return new Date(ms).toISOString()
}

/** Monday to Friday. Bank holidays are not included in the demo (docs/PILOT-READINESS.md). */
export function isWorkingDay(date: IsoDate): boolean {
  const day = parseDate(date).getUTCDay()
  return day !== 0 && day !== 6
}

/** The first `time` (HH:MM, UK) on a working day that is later than `now`. */
export function nextWorkingDayAt(now: IsoDateTime, time: string): IsoDateTime {
  let date = ukDate(now)
  for (let i = 0; i < 14; i++) {
    if (isWorkingDay(date)) {
      const at = ukTimeToIso(date, time)
      if (at > now) return at
    }
    date = addDays(date, 1)
  }
  throw new Error('No working day found')
}

/** Whether an instant falls in working hours (09:00 to 17:00 UK on a working day). */
export function inWorkingHours(at: IsoDateTime): boolean {
  const { date, time } = ukParts(at)
  return isWorkingDay(date) && time >= '09:00' && time < '17:00'
}

/** Add hours to an instant. */
export function addHours(at: IsoDateTime, hours: number): IsoDateTime {
  return new Date(new Date(at).getTime() + hours * 3_600_000).toISOString()
}

/** "14:00 on 17 Nov" in UK time, for messages frozen into records (the same on every screen). */
export function formatUkTimeOn(at: IsoDateTime): string {
  const { date, time } = ukParts(at)
  const x = parseDate(date)
  return `${time} on ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`
}

/** "3 Nov" */
export function formatShortDate(d: IsoDate): string {
  const x = parseDate(d)
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`
}

/** A date-only deadline falls due at the end of that working day: 17:00 UK. */
export function endOfDay(date: IsoDate): IsoDateTime {
  return ukTimeToIso(date, '17:00')
}
