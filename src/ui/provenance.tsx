import { journeyView, JOURNEY_SOURCE_LABEL, subsidyOfSearch } from '../audit/provenance'
import { journeySourceOf } from '../engine/journeys'
import type { Destination, JourneyResult, Ruleset, SearchResult, SubsidyProvenance } from '../engine/types'
import { Icon } from './icons'

// Where journey times, subsidy figures and places came from, said the same
// way on every screen. Each label is text, never colour alone.

/** At the top of the results: which journey times these are, and if the site fell back, why. */
export function JourneySourceNote({ s, id = 'journey-source' }: { s: Pick<SearchResult, 'travelProvider'>; id?: string }) {
  const v = journeyView(s)
  const warn = v.tone === 'warn'
  return (
    <div
      id={id}
      role={warn ? 'status' : undefined}
      className={`callout flex gap-2.5 text-sm ${warn ? 'border-warn bg-warn-soft' : ''}`}
      data-outcome={v.outcome}
      data-fallback={v.fallback?.code ?? ''}
    >
      <Icon name={warn ? 'alert' : 'clock'} size={16} className={`mt-0.5 shrink-0 ${warn ? 'text-warn' : 'text-muted'}`} />
      <span>
        <b>{v.label}.</b> {v.detail}
      </span>
    </div>
  )
}

/** "Illustrative subsidy figures" or "Official subsidy table", with where they came from on hover and for screen readers. */
export function SubsidyChip({ sub, id }: { sub: SubsidyProvenance; id?: string }) {
  return (
    <span id={id} className={`chip ${sub.status === 'official' ? 'chip-good' : 'chip-warn'}`} title={sub.detail} data-status={sub.status}>
      {sub.label}
      <span className="sr-only">: {sub.detail}</span>
    </span>
  )
}

export function subsidyFor(s: SearchResult, rulesets: Ruleset[]): SubsidyProvenance {
  return subsidyOfSearch(
    s,
    rulesets.find(r => r.hash === s.rulesetHash),
  )
}

/** "TravelTime" or "Estimate" beside a journey time. */
export function JourneyTag({ j, s }: { j: Pick<JourneyResult, 'source'>; s: Pick<SearchResult, 'travelProvider'> }) {
  const src = journeySourceOf(j, s.travelProvider)
  return <span className={`chip ${src === 'traveltime' ? 'chip-plain' : 'chip-outline'}`}>{JOURNEY_SOURCE_LABEL[src]}</span>
}

/** Where a place came from: a synthetic example, a postcode lookup or an imported file. */
export function placeSourceText(d: Pick<Destination, 'placeSource' | 'postcode'>): string {
  const src = d.placeSource ?? 'example'
  if (src === 'postcode') return `Located from postcode ${d.postcode ?? ''} (postcodes.io)`.trim()
  if (src === 'import') return `From the imported file${d.postcode ? `, postcode ${d.postcode}` : ''}`
  return 'Synthetic example place'
}
