import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../src/data/households'
import { validateHousehold, ValidationError } from '../src/engine/validate'
import type { Household, Issue } from '../src/engine/types'
import { scenarioSearch, searchHousehold, TODAY } from './fixtures'

/** A valid single-adult household to break one field at a time. */
function base(): Household {
  return {
    caseRef: 'HN-26-0001',
    members: [{ id: 'a1', label: 'Adult 1', role: 'adult', age: 30, sex: 'F' }],
    destinations: [],
    homeArea: { lat: 51.548, lng: 0.026 },
    homeAreaLabel: 'Forest Gate, Demo Borough',
    needFrom: TODAY,
    expectedNights: 120,
    accessNeeds: [],
    accessAssessments: [],
    petsMustBeAccommodated: false,
    flags: [],
    safeguardingZones: [],
    maxHouseholdContributionWeekly: 15,
  }
}
const errors = (h: Household) => validateHousehold(h, TODAY).filter(i => i.severity === 'error')
const paths = (xs: Issue[]) => xs.map(i => i.path)
const dest = (over: Partial<Household['destinations'][number]> = {}) => ({
  id: 'd1',
  personId: 'a1',
  kind: 'work' as const,
  name: 'Office',
  location: { lat: 51.5, lng: 0 },
  arriveBy: '09:00',
  daysPerWeek: 5,
  ...over,
})

describe('validateHousehold', () => {
  it('accepts a valid household', () => expect(validateHousehold(base(), TODAY)).toEqual([]))

  it('accepts every example household on the day it is loaded', () => {
    for (const s of SCENARIOS) expect(errors(s.household(TODAY)), s.id).toEqual([])
  })

  describe('case reference', () => {
    it('refuses blank and whitespace', () => {
      expect(paths(errors({ ...base(), caseRef: '' }))).toEqual(['caseRef'])
      expect(paths(errors({ ...base(), caseRef: '   ' }))).toEqual(['caseRef'])
    })
    it('trims before measuring, and caps at 40 characters', () => {
      expect(errors({ ...base(), caseRef: `  ${'X'.repeat(40)}  ` })).toEqual([])
      expect(paths(errors({ ...base(), caseRef: 'X'.repeat(41) }))).toEqual(['caseRef'])
    })
    it('warns, with a link, when the case already has an open search or a placement', () => {
      const issues = validateHousehold({ ...base(), caseRef: ' hn-26-0001 ' }, TODAY, {
        openCases: [
          { caseRef: 'HN-26-0001', kind: 'search', at: '2026-11-01T10:00:00Z', searchId: 'S-1' },
          { caseRef: 'HN-26-0001', kind: 'placement', at: '2026-10-01T10:00:00Z', seq: 3 },
          { caseRef: 'HN-26-9999', kind: 'search', at: '2026-11-01T10:00:00Z', searchId: 'S-2' },
        ],
      })
      expect(issues.every(i => i.severity === 'warning')).toBe(true)
      expect(issues.map(i => i.link)).toEqual([{ searchId: 'S-1' }, { seq: 3 }])
    })
  })

  describe('people', () => {
    it('needs at least one person', () => expect(paths(errors({ ...base(), members: [] }))).toEqual(['members']))
    it('needs an adult of 16 or over', () => {
      const h = { ...base(), members: [{ id: 'c1', label: 'Child 1', role: 'child' as const, age: 12, sex: 'F' as const }] }
      expect(paths(errors(h))).toEqual(['members'])
    })
    it.each([[-1], [121], [3.5], [NaN], [undefined as unknown as number], ['30' as unknown as number]])('refuses age %s', age => {
      const h = base()
      h.members[0].age = age
      expect(paths(errors(h))).toEqual(['age-a1'])
    })
    it('accepts 0 and 120', () => {
      const h = base()
      h.members.push({ id: 'c1', label: 'Child 1', role: 'child', age: 0, sex: 'M' })
      h.members[0].age = 120
      expect(errors(h)).toEqual([])
    })
    it('refuses an adult under 16 and a child of 18 or over', () => {
      const h = base()
      h.members.push({ id: 'a2', label: 'Adult 2', role: 'adult', age: 15, sex: 'M' }, { id: 'c1', label: 'Child 1', role: 'child', age: 18, sex: 'M' })
      expect(paths(errors(h))).toEqual(['age-a2', 'age-c1'])
    })
    it('allows a 17-year-old child', () => {
      const h = base()
      h.members.push({ id: 'c1', label: 'Child 1', role: 'child', age: 17, sex: 'M' })
      expect(errors(h)).toEqual([])
    })
    it('needs partner links to be mutual and to point at someone present', () => {
      const h = base()
      h.members.push({ id: 'a2', label: 'Adult 2', role: 'adult', age: 31, sex: 'M' })
      h.members[0].partnerOf = 'a2'
      expect(paths(errors(h))).toEqual(['partner-a1'])
      h.members[1].partnerOf = 'a1'
      expect(errors(h)).toEqual([])
      h.members[0].partnerOf = 'gone'
      expect(paths(errors(h))).toContain('partner-a1')
      h.members[1].partnerOf = 'a2'
      expect(errors(h).find(i => i.path === 'partner-a2')?.message).toMatch(/own partner/)
    })
  })

  describe('dates and stay', () => {
    it('needs a real date, not in the past', () => {
      expect(paths(errors({ ...base(), needFrom: '' }))).toEqual(['needFrom'])
      expect(paths(errors({ ...base(), needFrom: '2026-02-30' }))).toEqual(['needFrom'])
      expect(paths(errors({ ...base(), needFrom: 'tomorrow' }))).toEqual(['needFrom'])
      expect(paths(errors({ ...base(), needFrom: '2026-11-01' }))).toEqual(['needFrom'])
      expect(errors({ ...base(), needFrom: '2026-12-25' })).toEqual([])
    })
    it.each([[0], [731], [1.5], [NaN]])('refuses an expected stay of %s nights', n =>
      expect(paths(errors({ ...base(), expectedNights: n }))).toEqual(['expectedNights']),
    )
    it('accepts 1 and 730 nights', () => {
      expect(errors({ ...base(), expectedNights: 1 })).toEqual([])
      expect(errors({ ...base(), expectedNights: 730 })).toEqual([])
    })
  })

  describe('places that matter', () => {
    it('needs a person who is in the household', () => {
      expect(paths(errors({ ...base(), destinations: [dest({ personId: '' })] }))).toEqual(['who-d1'])
      expect(paths(errors({ ...base(), destinations: [dest({ personId: 'x9' })] }))).toEqual(['who-d1'])
    })
    it('needs a valid arrive-by time', () => {
      for (const t of ['', '9am', '24:00', '08:60']) expect(paths(errors({ ...base(), destinations: [dest({ arriveBy: t })] })), t).toEqual(['arrive-d1'])
    })
    it.each([[0], [8], [2.5], [NaN]])('refuses %s days a week', n =>
      expect(paths(errors({ ...base(), destinations: [dest({ daysPerWeek: n })] }))).toEqual(['days-d1']),
    )
    it('warns, but does not block, when a school is set against an adult', () => {
      const issues = validateHousehold({ ...base(), destinations: [dest({ kind: 'school', name: 'Riverside Primary' })] }, TODAY)
      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatchObject({ path: 'who-d1', severity: 'warning' })
    })
  })

  describe('money and zones', () => {
    it('refuses a negative or missing contribution, accepts 0', () => {
      expect(paths(errors({ ...base(), maxHouseholdContributionWeekly: -1 }))).toEqual(['afford'])
      expect(paths(errors({ ...base(), maxHouseholdContributionWeekly: NaN }))).toEqual(['afford'])
      expect(errors({ ...base(), maxHouseholdContributionWeekly: 0 })).toEqual([])
    })
    it('needs a zone radius between 0.1 and 50 km', () => {
      const zone = (r: number) => ({ ...base(), safeguardingZones: [{ id: 'z1', center: { lat: 51.5, lng: 0 }, radiusKm: r }] })
      expect(paths(errors(zone(0.05)))).toEqual(['radius-z1'])
      expect(paths(errors(zone(51)))).toEqual(['radius-z1'])
      expect(errors(zone(0.1))).toEqual([])
      expect(errors(zone(50))).toEqual([])
    })
  })
})

describe('runSearch enforces validation', () => {
  it('refuses a household with errors, so an import cannot bypass the form', async () => {
    const err = await searchHousehold({ ...base(), caseRef: ' ' }).catch(e => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(paths((err as ValidationError).issues)).toContain('caseRef')
  })
  it('freezes warnings into the result and trims the case reference', async () => {
    const r = await searchHousehold({ ...base(), caseRef: '  HN-26-0001 ', destinations: [dest({ kind: 'school', name: 'Riverside Primary' })] })
    expect(r.household.caseRef).toBe('HN-26-0001')
    expect(r.validation?.map(i => i.path)).toEqual(['who-d1'])
  })
  it('records an empty validation list for a clean example household', async () => {
    expect((await scenarioSearch('brief')).validation).toEqual([])
  })
})

describe('places and the last settled area (phase 3: imports can leave them unset)', () => {
  it('needs a last settled area with a location', () => {
    expect(paths(errors({ ...base(), homeArea: { lat: NaN, lng: NaN }, homeAreaLabel: '' }))).toEqual(['homeArea'])
  })
  it('needs every place named and located', () => {
    expect(paths(errors({ ...base(), destinations: [dest({ name: '  ' })] }))).toEqual(['place-d1'])
    expect(paths(errors({ ...base(), destinations: [dest({ location: { lat: NaN, lng: 0 } })] }))).toEqual(['place-d1'])
  })
  it('accepts a place located from a postcode', () => {
    expect(errors({ ...base(), destinations: [dest({ placeSource: 'postcode', postcode: 'E15 1AA', refId: 'Postcode E15 1AA' })] })).toEqual([])
  })
})
