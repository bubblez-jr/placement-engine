import { subsidyProvenance } from '../engine/cost'
import { formatDate } from '../engine/dates'
import { isTravelFault, weekdayName } from '../engine/journeys'
import type { JourneyProvenance, JourneySource, Ruleset, SearchResult, SubsidyProvenance } from '../engine/types'

// Where a search's journey times and subsidy figures came from, read the same
// way for every search: those recorded from phase 3 say so themselves; older
// ones were always the estimate and the illustrative table.

export interface JourneyView extends JourneyProvenance {
  outcome: 'measured' | 'estimated' | 'mixed'
  /** Recorded before searches said where their journeys came from */
  legacy: boolean
  /** Whether the officer should be warned (a failure), or just told (the estimate on purpose, or not switched on) */
  tone: 'info' | 'warn'
  /** One plain sentence that stands alone (the case note, the audit pack) */
  headline: string
  /** What to say after the label, without repeating it (the note on the results) */
  detail: string
}

export function journeyView(s: Pick<SearchResult, 'travelProvider'>): JourneyView {
  const p = s.travelProvider
  if (!p.outcome) {
    return {
      ...p,
      outcome: p.id.startsWith('traveltime') ? 'measured' : 'estimated',
      legacy: true,
      tone: 'info',
      headline: `Journey times: ${p.label.toLowerCase()}. ${p.disclaimer}`,
      detail: p.disclaimer,
    }
  }
  const day = p.planningDate ? `${weekdayName(p.planningDate)} ${formatDate(p.planningDate)}` : ''
  const fault = !!p.fallback && isTravelFault(p.fallback.code)
  const reason = p.fallback ? p.fallback.message : ''
  const lower = (t: string) => (t.startsWith('TravelTime') ? t : t.charAt(0).toLowerCase() + t.slice(1))
  let headline: string
  let detail: string
  if (p.outcome === 'measured') {
    headline = `Journey times are timetable-based public transport times from TravelTime, planned for ${day}.`
    detail = `Timetable-based, arriving by each place’s arrive-by time on ${day}.`
  } else if (p.outcome === 'mixed') {
    const est = p.counts?.estimated ?? 0
    const total = est + (p.counts?.measured ?? 0)
    headline = `Some journey times are estimates: ${lower(reason)}. Each estimated journey is marked.`
    detail = `${reason}, so ${est} of ${total} times are estimates from straight-line distance, marked “Estimate”. The rest are timetable-based, for ${day}.`
  } else if (p.requested === 'traveltime') {
    headline = `Journey times are estimates from straight-line distance: ${lower(reason)}.`
    detail = `${reason}, so these are estimates from straight-line distance, not timetable times.`
  } else {
    headline = 'Journey times are estimates from straight-line distance (the demo model), not timetable times.'
    detail = 'Estimates from straight-line distance, not timetable times.'
  }
  return { ...p, outcome: p.outcome, legacy: false, tone: fault || p.outcome === 'mixed' ? 'warn' : 'info', headline, detail }
}

export const JOURNEY_SOURCE_LABEL: Record<JourneySource, string> = { traveltime: 'TravelTime', estimate: 'Estimate' }

/** The subsidy figures a search's costs used: its own record, or for older searches the policy version it used. */
export function subsidyOfSearch(s: Pick<SearchResult, 'subsidy'>, ruleset: Pick<Ruleset, 'subsidy'> | undefined): SubsidyProvenance {
  if (s.subsidy) return s.subsidy
  return subsidyProvenance(ruleset ?? { subsidy: { status: 'illustrative', source: 'Illustrative figures.' } as Ruleset['subsidy'] })
}
