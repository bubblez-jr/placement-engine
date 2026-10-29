import { describe, expect, it } from 'vitest'
import { scenarioSearch } from './fixtures'

const byId = (r: Awaited<ReturnType<typeof scenarioSearch>>, id: string) => r.candidates.find(c => c.propertyId === id)!

describe('scenario: the brief example (parent + 3 children)', async () => {
  const r = await scenarioSearch('brief')
  it('needs 3 bedrooms', () => expect(r.bedroomNeed).toBe(3))
  it('recommends the in-borough flat near the schools', () => expect(r.recommendedId).toBe('P01'))
  it('ranks Becontree Heath (cheaper, far from school) below it', () => {
    const a = byId(r, 'P01')
    const b = byId(r, 'P09')
    expect(b.eligible).toBe(true)
    expect(a.score).toBeGreaterThan(b.score + 10)
    expect(a.cost.nightlyCharge - b.cost.nightlyCharge).toBe(34)
  })
  it('costs B with no education transport: under-16s ride London buses free', () => {
    expect(byId(r, 'P09').cost.educationStay).toBe(0)
  })
  it('blocks the expired gas certificate, the unapproved supplier and the reserved accessible unit', () => {
    expect(byId(r, 'P05').blocks.map(b => b.code)).toContain('COMPLIANCE_EXPIRED')
    expect(byId(r, 'P13').blocks.map(b => b.code)).toContain('SUPPLIER_NOT_APPROVED')
    expect(byId(r, 'P17').blocks.map(b => b.code)).toContain('RESERVED_ACCESSIBLE')
    expect(byId(r, 'P04').blocks.map(b => b.code)).toContain('SHARED_FACILITIES_FAMILY')
  })
  it('flags stale availability as a warning, not a block', () => {
    const c = byId(r, 'P10')
    expect(c.eligible).toBe(true)
    expect(c.warnings.map(w => w.code)).toContain('STALE_AVAILABILITY')
  })
  it('explains the recommendation in plain English', () => {
    expect(r.explanation.headline).toBe('Cedar Court 4 is recommended.')
    expect(r.explanation.reasons.join(' ')).toMatch(/location \(in the borough against a neighbouring borough/)
    expect(r.explanation.cost.join(' ')).toMatch(/temporary accommodation budget/)
  })
})

describe('scenario: large family with an exam year and a SEND child', async () => {
  const r = await scenarioSearch('large')
  it('needs 4 bedrooms', () => expect(r.bedroomNeed).toBe(4))
  it('raises the school weight for the exam year', () => {
    expect(r.effectiveWeights.school_journey).toBeGreaterThan(22)
  })
  it('charges the SEND taxi for Luton to the education budget', () => {
    const luton = byId(r, 'P22')
    expect(luton.eligible).toBe(true)
    expect(luton.cost.educationStay).toBeGreaterThan(10000)
    expect(luton.tier).toBe(4)
  })
  it('does not recommend Luton', () => expect(r.recommendedId).not.toBe('P22'))
})

describe('scenario: wheelchair user fleeing abuse', async () => {
  const r = await scenarioSearch('access')
  it('only accessible units are eligible', () => {
    const eligible = r.candidates.filter(c => c.eligible).map(c => c.propertyId)
    expect(eligible.sort()).toEqual(['P07', 'P24'])
  })
  it('removes properties inside the safeguarding zone without saying why', () => {
    const c = byId(r, 'P12')
    const s = c.checks.find(k => k.code === 'SAFEGUARDING')!
    expect(s.passed).toBe(false)
    expect(s.message).toBe('Inside a safeguarding exclusion zone')
  })
  it('recommends the in-borough accessible flat', () => expect(r.recommendedId).toBe('P07'))
})

describe('scenario: pregnant, out of hours', async () => {
  const r = await scenarioSearch('outofhours')
  it('admits shared accommodation only as a last resort', () => {
    const eligible = r.candidates.filter(c => c.eligible)
    expect(eligible.length).toBeGreaterThan(0)
    expect(eligible.every(c => c.lastResort)).toBe(true)
  })
  it('warns about the six-week limit in the explanation', () => {
    expect(r.explanation.caveats.join(' ')).toMatch(/6-week clock/)
  })
  it('does not claim the last-resort option passes every check', () => {
    expect(r.explanation.reasons[0]).toMatch(/last resort/)
    expect(r.explanation.reasons[0]).not.toMatch(/passes every compliance and suitability check/)
  })
  it('records the Ombudsman remedy risk when the plan runs past six weeks', () => {
    const rec = byId(r, r.recommendedId!)
    expect(rec.cost.risks.join(' ')).toMatch(/Ombudsman/)
  })
})

describe('scenario: dialysis and work', async () => {
  const r = await scenarioSearch('dialysis')
  it('applies the treatment multiplier', () => expect(r.effectiveWeights.medical_journey).toBeGreaterThan(r.effectiveWeights.work_journey))
  it('has a recommendation and a sensitivity result', () => {
    expect(r.recommendedId).not.toBeNull()
    expect(['robust', 'close_call']).toContain(r.sensitivity.status)
  })
  it('does not apply the school criterion', () => expect(r.effectiveWeights.school_journey).toBe(0))
})
