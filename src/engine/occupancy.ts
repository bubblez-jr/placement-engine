import { formatShortDate, formatUkTimeOn, ukDate } from './dates'
import type { Placement } from './placement'
import type { IsoDate, IsoDateTime } from './types'

// Who occupies which property, and when, derived from placements. Nothing is
// stored: refused, cancelled and expired placements simply stop counting.
// Periods are nights, as half-open date ranges [from, to): a household that
// leaves on the 10th and one that arrives on the 10th do not overlap.
// Availability is the supplier's statement; occupancy is ours.

export type OccupancyKind = 'hold' | 'booked' | 'in_residence' | 'past'

export interface OccupiedPeriod {
  propertyId: string
  /** The decision record (the placement's identity) */
  seq: number
  caseRef: string
  kind: OccupancyKind
  from: IsoDate
  /** First free night; null while a household is still in residence past its planned end */
  to: IsoDate | null
  /** For a hold: when it ends */
  holdUntil?: IsoDateTime
}

/** Occupancy at `now`. A hold counts until it expires; a household in residence counts until it moves out. */
export function occupancyOf(placements: Placement[], now: IsoDateTime): OccupiedPeriod[] {
  const today = ukDate(now)
  const out: OccupiedPeriod[] = []
  for (const p of placements) {
    const base = { propertyId: p.propertyId, seq: p.seq, caseRef: p.caseRef }
    switch (p.state) {
      case 'held':
        out.push({ ...base, kind: 'hold', from: p.startDate, to: p.currentEnd, holdUntil: p.holdUntil })
        break
      case 'provider_confirmed':
      case 'offered':
      case 'accepted':
        out.push({ ...base, kind: 'booked', from: p.startDate, to: p.currentEnd })
        break
      case 'checked_in': {
        const from = p.checkedInOn ?? p.startDate
        // Past the planned end and still there: open-ended until a move-out is recorded.
        out.push({ ...base, kind: 'in_residence', from, to: today < p.currentEnd ? p.currentEnd : null })
        break
      }
      case 'moved_out':
        out.push({ ...base, kind: 'past', from: p.checkedInOn ?? p.startDate, to: p.movedOutOn ?? p.currentEnd })
        break
      default:
        break
    }
  }
  return out
}

/** Whether two night ranges share a night. `to` null means open-ended. */
export function overlaps(a: { from: IsoDate; to: IsoDate | null }, b: { from: IsoDate; to: IsoDate | null }): boolean {
  const aEndsAfterBStarts = a.to === null || a.to > b.from
  const bEndsAfterAStarts = b.to === null || b.to > a.from
  return aEndsAfterBStarts && bEndsAfterAStarts
}

/** Periods on a property that overlap the requested nights, other than the placement named in `exceptSeq`. */
export function conflictsFor(periods: OccupiedPeriod[], propertyId: string, from: IsoDate, to: IsoDate, exceptSeq?: number): OccupiedPeriod[] {
  return periods.filter(o => o.propertyId === propertyId && o.seq !== exceptSeq && overlaps(o, { from, to }))
}

/**
 * What the officer is told about a conflict. Dates only: nothing about the
 * other household. `forCaseRef` lets the message say when the hold is this
 * case's own earlier one.
 */
export function occupancyMessage(o: OccupiedPeriod, forCaseRef?: string): string {
  const whose = forCaseRef && forCaseRef === o.caseRef ? 'for this case' : 'for another case'
  if (o.kind === 'hold') return `Held ${whose} until ${formatUkTimeOn(o.holdUntil!)}`
  if (o.kind === 'in_residence' && o.to === null) return `Occupied since ${formatShortDate(o.from)}, past its planned end, with no move-out recorded`
  if (o.kind === 'in_residence') return `Occupied ${formatShortDate(o.from)} to ${formatShortDate(o.to!)}`
  return `Booked ${formatShortDate(o.from)} to ${formatShortDate(o.to!)}`
}
