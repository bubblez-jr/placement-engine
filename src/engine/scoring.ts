import { piecewise, round } from './valueFns'
import { daysBetween } from './dates'
import type { CriterionConfig, CriterionKey, CriterionScore, DestinationKind, Household, JourneyResult, Property, Ruleset } from './types'
import { sharedFacilities } from './gates'

const JOURNEY_KINDS: Partial<Record<CriterionKey, DestinationKind[]>> = {
  school_journey: ['school'],
  work_journey: ['work'],
  medical_journey: ['medical'],
  support_journey: ['care', 'support'],
}

/** Which criteria apply to this household (journeys only count if it has that kind of destination). */
export function applicableCriteria(h: Household, rs: Ruleset): CriterionKey[] {
  return rs.criteria
    .filter(c => {
      const kinds = JOURNEY_KINDS[c.key]
      return !kinds || h.destinations.some(d => kinds.includes(d.kind))
    })
    .map(c => c.key)
}

/**
 * Weights after priority flags (e.g. an exam-year child raises the school
 * journey weight), restricted to applicable criteria and renormalised to 100.
 */
export function effectiveWeights(h: Household, rs: Ruleset): Record<CriterionKey, number> {
  const applicable = new Set(applicableCriteria(h, rs))
  const flags = new Set(h.flags)
  if (h.members.some(m => m.examYear)) flags.add('exam_year')
  if (h.members.some(m => m.employed)) flags.add('employment')
  const raw: Partial<Record<CriterionKey, number>> = {}
  for (const c of rs.criteria) {
    if (!applicable.has(c.key)) continue
    let w = c.weight
    for (const m of rs.priorityMultipliers) if (m.criterion === c.key && flags.has(m.flag)) w *= m.multiplier
    raw[c.key] = w
  }
  const total = Object.values(raw).reduce((a, b) => a + (b ?? 0), 0)
  const out = {} as Record<CriterionKey, number>
  for (const c of rs.criteria) out[c.key] = total > 0 && raw[c.key] !== undefined ? (raw[c.key]! / total) * 100 : 0
  return out
}

export function locationTier(p: Property, rs: Ruleset, homeAreaMinutes: number | null): 1 | 2 | 3 | 4 {
  if (p.district === rs.homeDistrict) return 1
  if (rs.adjacentDistricts.includes(p.district)) return 2
  if (homeAreaMinutes !== null && homeAreaMinutes <= rs.tierTravelLimitMins) return 3
  return 4
}

export const TIER_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: 'In the borough',
  2: 'Neighbouring borough',
  3: 'Further away, within reach',
  4: 'Out of area',
}

function worstJourney(journeys: JourneyResult[], kinds: DestinationKind[]): JourneyResult | null {
  const js = journeys.filter(j => kinds.includes(j.kind))
  if (js.length === 0) return null
  return js.reduce((a, b) => ((b.minutes ?? Infinity) > (a.minutes ?? Infinity) ? b : a))
}

function facilitiesClass(p: Property): 'self_contained' | 'shared_kitchen' | 'shared_all' {
  if (!sharedFacilities(p)) return 'self_contained'
  return p.unitType === 'bnb' ? 'shared_all' : 'shared_kitchen'
}

const FACILITIES_LABEL = { self_contained: 'Self-contained', shared_kitchen: 'Shared kitchen or bathroom', shared_all: 'Shared kitchen and bathroom (B&B)' }

/** Raw measure and 0..1 value for one criterion. Pure and weight-independent. */
export function criterionValue(
  c: CriterionConfig,
  h: Household,
  p: Property,
  rs: Ruleset,
  journeys: JourneyResult[],
  tier: 1 | 2 | 3 | 4,
  personLabel: (id: string) => string,
): { raw: number | null; rawLabel: string; value: number } {
  const kinds = JOURNEY_KINDS[c.key]
  if (kinds) {
    const j = worstJourney(journeys, kinds)
    if (!j) return { raw: null, rawLabel: 'Not applicable', value: 0 }
    if (j.minutes === null) return { raw: null, rawLabel: `${personLabel(j.personId)} → ${j.name}: no route`, value: 0 }
    return {
      raw: j.minutes,
      rawLabel: `${j.minutes} min (${personLabel(j.personId)} → ${j.name})`,
      value: piecewise(c.breakpoints ?? [], j.minutes),
    }
  }
  switch (c.key) {
    case 'location_tier':
      return { raw: tier, rawLabel: `Tier ${tier}: ${TIER_LABEL[tier]}`, value: piecewise(c.breakpoints ?? [], tier) }
    case 'facilities': {
      const f = facilitiesClass(p)
      return { raw: null, rawLabel: FACILITIES_LABEL[f], value: rs.facilitiesValues[f] }
    }
    case 'condition': {
      const g = p.inspectionGrade ?? 'unknown'
      return { raw: null, rawLabel: g === 'unknown' ? 'Not inspected' : `Inspection grade ${g}`, value: rs.conditionValues[g] }
    }
    case 'stability': {
      if (!p.availableUntil) return { raw: 100, rawLabel: 'Covers the whole expected stay', value: 1 }
      const nights = Math.max(0, daysBetween(h.needFrom, p.availableUntil))
      const share = Math.min(1, nights / Math.max(1, h.expectedNights))
      return {
        raw: Math.round(share * 100),
        rawLabel: share >= 1 ? 'Covers the whole expected stay' : `Covers ${nights} of ${h.expectedNights} nights (${Math.round(share * 100)}%)`,
        value: share,
      }
    }
    default:
      return { raw: null, rawLabel: '', value: 0 }
  }
}

export function scoreCandidate(
  h: Household,
  p: Property,
  rs: Ruleset,
  journeys: JourneyResult[],
  tier: 1 | 2 | 3 | 4,
  weights: Record<CriterionKey, number>,
  personLabel: (id: string) => string,
): { criteria: CriterionScore[]; score: number } {
  const applicable = new Set(applicableCriteria(h, rs))
  const criteria = rs.criteria.map(c => {
    const v = criterionValue(c, h, p, rs, journeys, tier, personLabel)
    const isApplicable = applicable.has(c.key)
    const weight = isApplicable ? weights[c.key] : 0
    return {
      key: c.key,
      label: c.label,
      legalFactor: c.legalFactor,
      applicable: isApplicable,
      raw: v.raw,
      rawLabel: v.rawLabel,
      value: round(v.value, 3),
      weight: round(weight, 2),
      contribution: round(weight * v.value, 2),
    }
  })
  const score = round(criteria.reduce((a, c) => a + c.contribution, 0), 1)
  return { criteria, score }
}

/** Re-score from stored values with different weights (for the sensitivity check). */
export function rescore(criteria: CriterionScore[], weights: Record<CriterionKey, number>): number {
  return round(criteria.reduce((a, c) => a + (c.applicable ? weights[c.key] * c.value : 0), 0), 1)
}

