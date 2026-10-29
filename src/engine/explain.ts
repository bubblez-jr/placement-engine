import type { Candidate, CriterionKey, CriterionScore, Explanation, GateCode, Ruleset, SearchResult } from './types'

// Plain-English explanations built from templates. The numbers come from the
// engine; nothing here computes a score. (A language model may later reword
// these sentences, but never produce them from scratch.)

export function gbp(n: number, dp = 0): string {
  const sign = n < 0 ? '−' : ''
  return `${sign}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
}

const TIER_SHORT = { 1: 'in the borough', 2: 'a neighbouring borough', 3: 'further away, within reach', 4: 'out of area' } as const

function shortRaw(c: CriterionScore): string {
  switch (c.key as CriterionKey) {
    case 'school_journey':
    case 'work_journey':
    case 'medical_journey':
    case 'support_journey':
      return c.raw === null ? 'no route' : `${c.raw} min`
    case 'location_tier':
      return c.raw ? TIER_SHORT[c.raw as 1 | 2 | 3 | 4] : '—'
    case 'stability':
      return c.raw === 100 || c.raw === null ? 'the whole stay' : `${c.raw}% of the stay`
    case 'condition':
      return c.rawLabel.replace('Inspection grade', 'grade').replace('Not inspected', 'not inspected')
    case 'facilities':
      return c.rawLabel.startsWith('Self') ? 'self-contained' : c.rawLabel.includes('B&B') ? 'shared kitchen and bathroom' : 'shared kitchen or bathroom'
    default:
      return c.rawLabel
  }
}

const PHRASE: Record<CriterionKey, string> = {
  school_journey: 'the longest school journey',
  work_journey: 'the journey to work',
  medical_journey: 'the journey to treatment',
  support_journey: 'the journey to care or support',
  location_tier: 'location',
  facilities: 'facilities',
  condition: 'condition',
  stability: 'how much of the stay it covers',
}

/** The criteria where `a` beats `b` by the most points, as phrases. */
export function biggestDifferences(a: Candidate, b: Candidate, n = 2): string[] {
  const diffs = a.criteria
    .filter(c => c.applicable)
    .map(c => {
      const other = b.criteria.find(x => x.key === c.key)!
      return { c, other, delta: c.contribution - other.contribution }
    })
    .filter(d => d.delta > 0.5)
    .sort((x, y) => y.delta - x.delta)
    .slice(0, n)
  return diffs.map(d => `${PHRASE[d.c.key]} (${shortRaw(d.c)} against ${shortRaw(d.other)}, +${d.delta.toFixed(1)} points)`)
}

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** Cost sentences comparing a to b, split by budget holder. */
export function costComparison(a: Candidate, b: Candidate): string[] {
  const out: string[] = []
  const diff = a.cost.taNetPerNight - b.cost.taNetPerNight
  const stayDiff = a.cost.taBudgetStay - b.cost.taBudgetStay
  if (Math.abs(diff) < 0.5) {
    out.push(`After housing benefit subsidy, ${a.label} and ${b.label} cost the temporary accommodation budget about the same per night.`)
  } else {
    out.push(
      `After housing benefit subsidy, ${a.label} costs the temporary accommodation budget ${gbp(Math.abs(diff))} a night ${diff > 0 ? 'more' : 'less'} than ${b.label} (${gbp(
        Math.abs(stayDiff),
      )} over the expected ${a.cost.stayNights}-night stay).`,
    )
  }
  const eduPerDay = (c: Candidate) => c.cost.lines.filter(l => l.budgetHolder === 'education').reduce((s, l) => s + l.perUnit, 0)
  const ea = eduPerDay(a)
  const eb = eduPerDay(b)
  if (eb > ea + 0.5) out.push(`${b.label} would add about ${gbp(eb - ea)} a school day to the education transport budget (${gbp(b.cost.educationStay - a.cost.educationStay)} over the stay).`)
  if (ea > eb + 0.5) out.push(`${a.label} adds about ${gbp(ea - eb)} a school day to the education transport budget (${gbp(a.cost.educationStay - b.cost.educationStay)} over the stay).`)
  const hh = b.cost.householdStay - a.cost.householdStay
  if (hh > 20) out.push(`${b.label} would cost the family about ${gbp(hh)} more over the stay in travel and charges.`)
  if (hh < -20) out.push(`${a.label} costs the family about ${gbp(-hh)} more over the stay in travel and charges.`)
  return out
}

const BLOCK_SUMMARY: Partial<Record<GateCode, string>> = {
  NOT_AVAILABLE: 'not available on the date',
  AVAILABILITY_ENDED: 'availability ended',
  TOO_FEW_BEDROOMS: 'too few bedrooms',
  TOO_MANY_BEDROOMS: 'too large for the household',
  RESERVED_ACCESSIBLE: 'accessible unit reserved for other needs',
  OVER_CAPACITY: 'too small for the household',
  COMPLIANCE_MISSING: 'missing a safety certificate',
  COMPLIANCE_EXPIRED: 'a safety certificate has expired',
  EPC_BELOW_E: 'EPC below band E',
  SHARED_FACILITIES_FAMILY: 'shared facilities (family)',
  SAFEGUARDING: 'inside a safeguarding exclusion zone',
  AFFORDABILITY: 'not affordable for the household',
  SUPPLIER_NOT_APPROVED: 'supplier not approved',
  PETS: 'pets not accepted',
  ACCESS_STEP_FREE: 'not step-free',
  ACCESS_WHEELCHAIR: 'not wheelchair accessible',
  ACCESS_GROUND_OR_LIFT: 'no ground floor or lift',
  ACCESS_ADAPTED_BATHROOM: 'no adapted bathroom',
}

export function rejectionSummary(candidates: Candidate[]): string[] {
  const counts = new Map<string, number>()
  for (const c of candidates.filter(x => !x.eligible)) {
    for (const b of c.blocks) {
      const k = BLOCK_SUMMARY[b.code] ?? b.code
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`)
}

export function buildExplanation(r: SearchResult, rs: Ruleset): Explanation {
  const eligible = r.candidates.filter(c => c.eligible)
  const rejected = r.candidates.length - eligible.length
  const rec = r.candidates.find(c => c.propertyId === r.recommendedId)
  if (!rec) {
    return {
      headline: 'No available property passes every check.',
      reasons: [`All ${r.candidates.length} properties were checked. Reasons: ${joinAnd(rejectionSummary(r.candidates))}.`],
      cost: [],
      caveats: [
        'Record the search steps taken and escalate to a manager: the council has to be able to show what it did to find suitable accommodation (R (Imam) v Croydon [2023] UKSC 45).',
      ],
    }
  }
  const reasons: string[] = []
  const caveats: string[] = []
  const prop = rec.checks.find(c => c.code === 'NOT_AVAILABLE')
  reasons.push(
    `It passes every compliance and suitability check${prop ? ` and is ${prop.message.charAt(0).toLowerCase()}${prop.message.slice(1)}` : ''}. ${rejected} of ${r.candidates.length} properties were ruled out by the checks.`,
  )

  const top = r.candidates.find(c => c.propertyId === r.topScoreId)!
  const others = eligible.filter(c => c.propertyId !== rec.propertyId).sort((a, b) => b.score - a.score)
  const runnerUp = r.tieBreakApplied ? top : others[0]

  let cost: string[] = []
  if (!runnerUp) {
    reasons.push(`It is the only property that passes every check. Suitability score ${rec.score}/100.`)
  } else if (r.tieBreakApplied) {
    reasons.push(
      `It scores ${rec.score}/100 for suitability, within ${rs.costTieBreakBand} points of ${top.label} (${top.score}). The council's rule is that public cost decides between options this close, and ${rec.label} costs less.`,
    )
    cost = costComparison(rec, top)
  } else {
    const diffs = biggestDifferences(rec, runnerUp)
    reasons.push(
      `It scores ${rec.score}/100 for suitability against ${runnerUp.score} for ${runnerUp.label}, the next option.${diffs.length ? ` The biggest differences are ${joinAnd(diffs)}.` : ''}`,
    )
    cost = costComparison(rec, runnerUp)
  }

  for (const w of rec.warnings) caveats.push(w.message)
  if (rec.lastResort) caveats.push(`Shared facilities for a family: start the ${rs.bnbFamilyLimitWeeks}-week clock and keep searching for self-contained accommodation.`)
  if (rec.district !== rs.homeDistrict) caveats.push(`Outside the borough (${rec.district}): notify ${rec.district} within 14 days (Housing Act 1996 s208).`)
  for (const risk of rec.cost.risks) caveats.push(risk)
  if (r.sensitivity.status === 'close_call') {
    caveats.push(`Close call: the recommendation changes if some weights move by 20% (${r.sensitivity.flips.length} of the tested changes). Check the next option carefully.`)
  }
  return { headline: `${rec.label} is recommended.`, reasons, cost, caveats }
}

/** One line for any candidate: why it sits where it does relative to the recommendation. */
export function whyHere(c: Candidate, rec: Candidate | undefined): string {
  if (!c.eligible) return `Ruled out: ${c.blocks.map(b => b.message).join('; ')}.`
  if (!rec || c.propertyId === rec.propertyId) return 'Recommended option.'
  const behind = biggestDifferences(rec, c)
  const ahead = biggestDifferences(c, rec)
  const parts: string[] = []
  parts.push(`${(rec.score - c.score).toFixed(1)} points behind ${rec.label}`)
  if (behind.length) parts.push(`mainly ${joinAnd(behind.map(x => x.split(' (')[0]))}`)
  if (ahead.length) parts.push(`better on ${joinAnd(ahead.map(x => x.split(' (')[0]))}`)
  return `${parts.join('; ')}.`
}

