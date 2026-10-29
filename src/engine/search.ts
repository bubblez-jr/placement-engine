import { bedroomNeed } from './bedrooms'
import { costPlacement } from './cost'
import { runGates } from './gates'
import { effectiveWeights, locationTier, rescore, scoreCandidate, TIER_LABEL } from './scoring'
import { buildExplanation } from './explain'
import type { Candidate, CriterionKey, Household, JourneyResult, Property, Ruleset, SearchResult, SensitivityFlip, Supplier } from './types'
import type { TravelProvider } from '../travel/provider'

export interface SearchInput {
  household: Household
  properties: Property[]
  suppliers: Supplier[]
  ruleset: Ruleset & { hash: string }
  travel: TravelProvider
  now: string
  dataVersions: { properties: string; reference: string }
  id?: string
}

function newId(): string {
  return `S-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

/** Pick the recommendation: highest suitability; within the tie-break band, lowest public cost. */
export function pickRecommendation(eligible: Candidate[], scoreOf: (c: Candidate) => number, band: number): { rec: Candidate | null; top: Candidate | null; tieBreak: boolean } {
  if (eligible.length === 0) return { rec: null, top: null, tieBreak: false }
  const sorted = [...eligible].sort((a, b) => scoreOf(b) - scoreOf(a) || a.cost.publicPerNight - b.cost.publicPerNight || a.label.localeCompare(b.label))
  const top = sorted[0]
  const inBand = sorted.filter(c => scoreOf(c) >= scoreOf(top) - band)
  const rec = inBand.reduce((best, c) => (c.cost.publicPerNight < best.cost.publicPerNight ? c : best), inBand[0])
  return { rec, top, tieBreak: rec.propertyId !== top.propertyId }
}

function renormalise(w: Record<CriterionKey, number>): Record<CriterionKey, number> {
  const total = Object.values(w).reduce((a, b) => a + b, 0)
  const out = { ...w }
  for (const k of Object.keys(out) as CriterionKey[]) out[k] = total > 0 ? (out[k] / total) * 100 : 0
  return out
}

export async function runSearch(input: SearchInput): Promise<SearchResult> {
  const { household: h, properties, suppliers, ruleset: rs, travel, now } = input
  const need = bedroomNeed(h.members)
  const weights = effectiveWeights(h, rs)
  const personLabel = (id: string) => h.members.find(m => m.id === id)?.label ?? id

  // Journeys: every property to every household destination plus the home area.
  const dests = [...h.destinations.map(d => ({ id: d.id, location: d.location })), { id: '__home', location: h.homeArea }]
  const cells = await travel.matrix({
    origins: properties.map(p => ({ id: p.id, location: p.location })),
    destinations: dests,
    mode: 'public_transport',
    arriveBy: h.destinations[0]?.arriveBy ?? '09:00',
  })
  const cell = (pid: string, did: string) => cells.find(c => c.originId === pid && c.destinationId === did)

  const candidates: Candidate[] = properties.map(p => {
    const supplier = suppliers.find(s => s.id === p.supplierId)
    const checks = runGates(h, p, supplier, rs, need, now)
    const blocks = checks.filter(c => c.severity === 'block' && !c.passed)
    const warnings = checks.filter(c => c.severity === 'warn')
    const journeys: JourneyResult[] = h.destinations.map(d => {
      const c = cell(p.id, d.id)
      return { destinationId: d.id, personId: d.personId, kind: d.kind, name: d.name, minutes: c?.minutes ?? null, distanceKm: c?.distanceKm ?? 0 }
    })
    const homeAreaMinutes = cell(p.id, '__home')?.minutes ?? null
    const tier = locationTier(p, rs, homeAreaMinutes)
    const { criteria, score } = scoreCandidate(h, p, rs, journeys, tier, weights, personLabel)
    return {
      propertyId: p.id,
      label: p.label,
      district: p.district,
      tier,
      checks,
      blocks,
      warnings,
      eligible: blocks.length === 0,
      lastResort: false,
      journeys,
      homeAreaMinutes,
      criteria,
      score,
      cost: costPlacement(h, p, rs, journeys, false),
    }
  })

  // Shared facilities for a family are allowed only when nothing else passes.
  if (!candidates.some(c => c.eligible)) {
    for (const c of candidates) {
      if (c.blocks.length > 0 && c.blocks.every(b => b.code === 'SHARED_FACILITIES_FAMILY')) {
        const p = properties.find(x => x.id === c.propertyId)!
        c.eligible = true
        c.lastResort = true
        c.blocks = []
        c.checks = c.checks.map(k => (k.code === 'SHARED_FACILITIES_FAMILY' ? { ...k, severity: 'warn' as const, message: `Last resort: no self-contained option passes. ${k.message}` } : k))
        c.warnings = c.checks.filter(k => k.severity === 'warn')
        c.cost = costPlacement(h, p, rs, c.journeys, true)
      }
    }
  }

  for (const c of candidates) {
    if (c.tier === 4) c.cost.risks.push(`Out of area (${TIER_LABEL[4].toLowerCase()}): record why nothing nearer was suitable.`)
  }

  const eligible = candidates.filter(c => c.eligible)
  const ranked = [...eligible].sort((a, b) => b.score - a.score || a.cost.publicPerNight - b.cost.publicPerNight || a.label.localeCompare(b.label))
  ranked.forEach((c, i) => (c.rank = i + 1))
  for (const c of eligible) {
    c.pareto = !eligible.some(
      o => o !== c && o.score >= c.score && o.cost.publicPerNight <= c.cost.publicPerNight && (o.score > c.score || o.cost.publicPerNight < c.cost.publicPerNight),
    )
  }

  const { rec, top, tieBreak } = pickRecommendation(eligible, c => c.score, rs.costTieBreakBand)

  // Sensitivity: does the recommendation survive each weight moving ±20%?
  const flips: SensitivityFlip[] = []
  if (rec && eligible.length > 1) {
    for (const key of Object.keys(weights) as CriterionKey[]) {
      if (weights[key] <= 0) continue
      for (const [factor, change] of [
        [0.8, '-20%'],
        [1.2, '+20%'],
      ] as const) {
        const w = renormalise({ ...weights, [key]: weights[key] * factor })
        const scores = new Map(eligible.map(c => [c.propertyId, rescore(c.criteria, w)]))
        const alt = pickRecommendation(eligible, c => scores.get(c.propertyId)!, rs.costTieBreakBand)
        if (alt.rec && alt.rec.propertyId !== rec.propertyId) flips.push({ criterion: key, change, newRecommendationId: alt.rec.propertyId })
      }
    }
  }

  const result: SearchResult = {
    id: input.id ?? newId(),
    createdAt: now,
    household: h,
    rulesetId: rs.id,
    rulesetVersion: rs.version,
    rulesetHash: rs.hash,
    travelProvider: { id: travel.id, label: travel.label, disclaimer: travel.disclaimer, assumptions: `Public transport, arrive by ${h.destinations[0]?.arriveBy ?? '09:00'} on a term-time weekday` },
    bedroomNeed: need,
    effectiveWeights: weights,
    candidates,
    recommendedId: rec?.propertyId ?? null,
    topScoreId: top?.propertyId ?? null,
    tieBreakApplied: tieBreak,
    sensitivity: { status: !rec || eligible.length < 2 ? 'n/a' : flips.length === 0 ? 'robust' : 'close_call', flips },
    explanation: { headline: '', reasons: [], cost: [], caveats: [] },
    dataVersions: input.dataVersions,
  }
  result.explanation = buildExplanation(result, rs)
  return result
}
