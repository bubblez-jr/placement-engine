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
  /** One plain sentence for the top of the results and the case note */
  headline: string
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
    }
  }
  const day = p.planningDate ? `${weekdayName(p.planningDate)} ${formatDate(p.planningDate)}` : ''
  const fault = !!p.fallback && isTravelFault(p.fallback.code)
  let headline: string
  if (p.outcome === 'measured') headline = `Journey times are timetable-based public transport times from TravelTime, planned for ${day}.`
  else if (p.outcome === 'mixed')
    headline = `Some journey times are estimates: ${p.fallback?.message.charAt(0).toLowerCase()}${p.fallback?.message.slice(1)}. Each estimated journey is marked.`
  else if (p.requested === 'traveltime')
    headline = `Journey times are estimates from straight-line distance: ${p.fallback?.message.charAt(0).toLowerCase()}${p.fallback?.message.slice(1)}.`
  else headline = 'Journey times are estimates from straight-line distance (the demo model), not timetable times.'
  return { ...p, outcome: p.outcome, legacy: false, tone: fault || p.outcome === 'mixed' ? 'warn' : 'info', headline }
}

export const JOURNEY_SOURCE_LABEL: Record<JourneySource, string> = { traveltime: 'TravelTime', estimate: 'Estimate' }

/** The subsidy figures a search's costs used: its own record, or for older searches the policy version it used. */
export function subsidyOfSearch(s: Pick<SearchResult, 'subsidy'>, ruleset: Pick<Ruleset, 'subsidy'> | undefined): SubsidyProvenance {
  if (s.subsidy) return s.subsidy
  return subsidyProvenance(ruleset ?? { subsidy: { status: 'illustrative', source: 'Illustrative figures.' } as Ruleset['subsidy'] })
}
