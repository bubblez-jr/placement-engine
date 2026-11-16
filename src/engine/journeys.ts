import { addDays, formatDate, parseDate } from './dates'
import type { IsoDate, JourneyProvenance, JourneySource, TravelFailureCode } from './types'

// Which day journeys are planned for, and how the search records where its
// journey times came from. Pure: the date comes from the household's details,
// never from the clock, so the same search always plans the same journeys.

/**
 * School holiday windows that are the same, or nearly, for every council in
 * England: the summer holiday and Christmas. Easter is worked out from the
 * year. Half-terms differ by council and are not modelled; a pilot uses the
 * council's own term dates.
 */
function inMainHoliday(date: IsoDate): boolean {
  const md = date.slice(5)
  if (md >= '07-22' && md <= '08-31') return true
  if (md >= '12-21' || md <= '01-03') return true
  const easter = easterSunday(Number(date.slice(0, 4)))
  return date >= addDays(easter, -7) && date <= addDays(easter, 7)
}

/** Easter Sunday in the Gregorian calendar (the anonymous Gregorian algorithm). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The day journeys are planned for: the first Tuesday, Wednesday or Thursday
 * on or after the date the accommodation is needed, outside the summer,
 * Christmas and Easter school holidays. A journey to school is a term-time
 * weekday trip; Tuesday to Thursday avoids bank holiday Mondays and Good
 * Friday, which the demo has no calendar for, and Monday and Friday timetables
 * that can differ from the rest of the week.
 */
export function journeyPlanningDate(needFrom: IsoDate): IsoDate {
  let date = needFrom
  for (let i = 0; i < 120; i++) {
    const day = parseDate(date).getUTCDay()
    if (day >= 2 && day <= 4 && !inMainHoliday(date)) return date
    date = addDays(date, 1)
  }
  return needFrom
}

/** Plain-English reasons, written for the officer. */
export const TRAVEL_FAILURE_TEXT: Record<TravelFailureCode, string> = {
  not_configured: 'Real journey times are not switched on for this site yet',
  status_unavailable: 'The journey-time service on this site could not be checked',
  invalid_request: 'This site’s journey-time service refused the request',
  bad_key: 'TravelTime did not accept this site’s key',
  rate_limited: 'TravelTime’s limit on requests was reached',
  timeout: 'TravelTime did not answer in time',
  network: 'TravelTime could not be reached',
  rejected: 'TravelTime rejected the request',
  vendor_error: 'TravelTime reported an error',
  bad_response: 'TravelTime’s answer was not in the form expected',
  partial: 'TravelTime did not return a time for every journey',
}

/** Whether a reason is a fault (shown as a warning) or just how the site is set up (shown as information). */
export function isTravelFault(code: TravelFailureCode): boolean {
  return code !== 'not_configured'
}

export interface TravelRunSummary {
  /** What the site asked for: real times, or the estimate on purpose (the shared demo file, seeded history, tests) */
  requested: 'traveltime' | 'estimate'
  /** Set when TravelTime was asked for but some or all times are estimates */
  fallback: { code: TravelFailureCode; pairs: number } | null
  counts: { measured: number; estimated: number; noRoute: number }
}

const ESTIMATE_DISCLAIMER =
  'Estimated from straight-line distance, not from timetables. A pilot uses timetable-based times (TravelTime, or a self-hosted router on bus and rail timetables).'

/**
 * What the search records about its journeys: which source produced them,
 * whether it fell back to the estimate and why, and the day and times planned
 * for. Shown on the results, in the audit pack and the PDF.
 */
export function journeyProvenance(run: TravelRunSummary, planningDate: IsoDate): JourneyProvenance {
  const { measured, estimated, noRoute } = run.counts
  const total = measured + estimated
  const outcome: JourneyProvenance['outcome'] = measured === 0 ? 'estimated' : estimated === 0 ? 'measured' : 'mixed'
  const day = `${weekdayName(planningDate)} ${formatDate(planningDate)}`
  const assumptions =
    outcome === 'estimated'
      ? 'Public transport. The estimate does not depend on the time or the day'
      : `Public transport, arriving by each place’s arrive-by time on ${day} (the first term-time Tuesday to Thursday from the date needed)`
  const noRouteNote = noRoute ? ` ${noRoute} journey${noRoute === 1 ? ' has' : 's have'} no public transport route within 4 hours.` : ''
  const fb = run.fallback
  const reason = fb ? TRAVEL_FAILURE_TEXT[fb.code] : ''
  let id: string
  let label: string
  let disclaimer: string
  if (outcome === 'measured') {
    id = 'traveltime-v4'
    label = 'Public transport times from TravelTime'
    disclaimer = `Timetable-based journey times from TravelTime, planned for ${day}.${noRouteNote}`
  } else if (outcome === 'mixed') {
    id = 'traveltime-v4+estimate-v1'
    label = 'TravelTime, with some estimated journeys'
    disclaimer = `${reason}, so ${estimated} of ${total} journey times are estimates and are marked as such. The rest are timetable-based times from TravelTime, planned for ${day}.${noRouteNote} ${ESTIMATE_DISCLAIMER}`
  } else if (run.requested === 'traveltime') {
    id = 'estimate-v1'
    label = 'Estimated journey times (TravelTime not used)'
    disclaimer = `${reason}, so every journey time here is an estimate. ${ESTIMATE_DISCLAIMER}`
  } else {
    id = 'estimate-v1'
    label = 'Estimated journey times (demo model)'
    disclaimer = ESTIMATE_DISCLAIMER
  }
  return {
    id,
    label,
    disclaimer,
    assumptions,
    requested: run.requested,
    outcome,
    fallback: fb ? { code: fb.code, message: reason, pairs: fb.pairs } : null,
    planningDate,
    counts: run.counts,
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function weekdayName(d: IsoDate): string {
  return WEEKDAYS[parseDate(d).getUTCDay()]
}

/** How one journey's time was found, for searches recorded before journeys carried their source. */
export function journeySourceOf(j: { source?: JourneySource }, provenance: { id: string }): JourneySource {
  if (j.source) return j.source
  return provenance.id.startsWith('traveltime') ? 'traveltime' : 'estimate'
}
