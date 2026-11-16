import { describe, expect, it } from 'vitest'
import { effectiveAccessNeeds, requiredAccessSubjects } from '../src/engine/access'
import { runGates } from '../src/engine/gates'
import { validateHousehold, ValidationError } from '../src/engine/validate'
import { seedProperties, SUPPLIERS } from '../src/data/properties'
import { defaultRuleset } from '../src/data/ruleset'
import type { AccessAssessment, Household, Property } from '../src/engine/types'
import { NOW, scenarioSearch, searchHousehold, TODAY } from './fixtures'

const ALL_YES: AccessAssessment['answers'] = {
  wheelchair_accessible: 'yes',
  step_free: 'yes',
  ground_floor_or_lift: 'yes',
  adapted_bathroom: 'yes',
  assistance_dog: 'no',
  equipment_or_carer: 'no',
}
const ALL_NO: AccessAssessment['answers'] = { ...ALL_YES, wheelchair_accessible: 'no', step_free: 'no', ground_floor_or_lift: 'no', adapted_bathroom: 'no' }

function household(over: Partial<Household> = {}): Household {
  return {
    caseRef: 'HN-26-0002',
    members: [
      { id: 'a1', label: 'Adult 1', role: 'adult', age: 40, sex: 'F' },
      { id: 'c1', label: 'Child 1', role: 'child', age: 8, sex: 'M', wheelchairUser: true },
    ],
    destinations: [],
    homeArea: { lat: 51.548, lng: 0.026 },
    homeAreaLabel: 'Forest Gate, Demo Borough',
    needFrom: TODAY,
    expectedNights: 120,
    accessNeeds: [],
    accessAssessments: [{ subject: 'c1', answers: ALL_YES }],
    petsMustBeAccommodated: false,
    flags: [],
    safeguardingZones: [],
    maxHouseholdContributionWeekly: 30,
    ...over,
  }
}

const props = seedProperties(TODAY, NOW)
const rs = defaultRuleset(NOW)
const gates = (h: Household, p: Property) =>
  runGates(
    h,
    p,
    SUPPLIERS.find(s => s.id === p.supplierId),
    rs,
    2,
    NOW,
  )
/** Does this property meet every access need? */
const meetsAll = (p: Property) => p.stepFree && p.wheelchairAccessible && (p.floor === 0 || p.lift) && p.adaptedBathroom

describe('regression: ticking "wheelchair user" must change what is offered', () => {
  it('a wheelchair user with every answer "yes" is never offered a property that fails them', async () => {
    const r = await searchHousehold(household())
    const offered = r.candidates.filter(c => c.eligible)
    for (const c of offered) expect(meetsAll(props.find(p => p.id === c.propertyId)!), c.label).toBe(true)
    // and the properties that fail access are ruled out by name
    const upstairs = r.candidates.find(c => !meetsAll(props.find(p => p.id === c.propertyId)!))!
    expect(upstairs.eligible).toBe(false)
    expect(upstairs.blocks.map(b => b.message).join(' ')).toMatch(/Child 1 needs/)
  })

  it('a wheelchair user with unanswered questions cannot be searched', async () => {
    const h = household({ accessAssessments: [] })
    const err = await searchHousehold(h).catch(e => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).issues.filter(i => i.path.startsWith('access-c1-'))).toHaveLength(6)
  })

  it('one unanswered question is enough to refuse the search', () => {
    const { adapted_bathroom: _, ...partial } = ALL_YES
    void _
    const issues = validateHousehold(household({ accessAssessments: [{ subject: 'c1', answers: partial }] }), TODAY)
    expect(issues.filter(i => i.severity === 'error').map(i => i.path)).toEqual(['access-c1-adapted_bathroom'])
  })
})

describe('who answers access questions', () => {
  it('every wheelchair user', () => expect(requiredAccessSubjects(household())).toEqual(['c1']))
  it('the household, when the disability flag is set and nobody is a wheelchair user', () => {
    const h = household({ members: [{ id: 'a1', label: 'Adult 1', role: 'adult', age: 40, sex: 'F' }], flags: ['disability'], accessAssessments: [] })
    expect(requiredAccessSubjects(h)).toEqual(['household'])
    const errs = validateHousehold(h, TODAY).filter(i => i.severity === 'error')
    expect(errs).toHaveLength(6)
    expect(errs.every(i => i.path.startsWith('access-household-'))).toBe(true)
  })
  it('nobody, when there is no wheelchair user and no disability flag', () => {
    const h = household({ members: [{ id: 'a1', label: 'Adult 1', role: 'adult', age: 40, sex: 'F' }], accessAssessments: [] })
    expect(requiredAccessSubjects(h)).toEqual([])
    expect(validateHousehold(h, TODAY)).toEqual([])
  })
  it('answers for someone who has left the household are an error', () => {
    const h = household({
      accessAssessments: [
        { subject: 'c1', answers: ALL_YES },
        { subject: 'gone', answers: ALL_YES },
      ],
    })
    expect(
      validateHousehold(h, TODAY)
        .filter(i => i.severity === 'error')
        .map(i => i.path),
    ).toEqual(['members'])
  })
})

describe('effective needs are the union of every "yes"', () => {
  it('names whose need each one is', () => {
    const h = household({
      members: [
        { id: 'a1', label: 'Adult 1', role: 'adult', age: 70, sex: 'F', wheelchairUser: true },
        { id: 'c1', label: 'Child 1', role: 'child', age: 8, sex: 'M', wheelchairUser: true },
      ],
      accessAssessments: [
        { subject: 'a1', answers: { ...ALL_NO, step_free: 'yes', wheelchair_accessible: 'yes' } },
        { subject: 'c1', answers: { ...ALL_NO, step_free: 'yes' } },
      ],
    })
    expect(effectiveAccessNeeds(h)).toEqual([
      { need: 'wheelchair_accessible', who: ['Adult 1'] },
      { need: 'step_free', who: ['Adult 1', 'Child 1'] },
    ])
    const flat = props.find(p => !p.stepFree)!
    const fail = gates(h, flat).find(g => g.code === 'ACCESS_STEP_FREE')!
    expect(fail.passed).toBe(false)
    expect(fail.message).toMatch(/^Adult 1 and Child 1 need step-free access/)
  })
  it('"no" to every need adds no access gate', () => {
    const h = household({ accessAssessments: [{ subject: 'c1', answers: ALL_NO }] })
    expect(gates(h, props[0]).filter(g => g.code.startsWith('ACCESS_'))).toEqual([])
  })
  it('still applies household-level needs carried from schema 1, so old or imported data is not ignored', () => {
    const h = household({
      members: [{ id: 'a1', label: 'Adult 1', role: 'adult', age: 40, sex: 'F' }],
      accessAssessments: undefined,
      accessNeeds: ['step_free'],
    })
    expect(effectiveAccessNeeds(h)).toEqual([{ need: 'step_free', who: ['The household'] }])
  })
})

describe('reserved accessible units key off the effective needs', () => {
  const reserved = props.find(p => p.reservedForAccessNeeds)!
  it('are open to a household whose answers need the adaptations', () => {
    expect(gates(household(), reserved).find(g => g.code === 'RESERVED_ACCESSIBLE')!.passed).toBe(true)
  })
  it('are closed to a wheelchair user whose answers say no to the adaptations', () => {
    const h = household({ accessAssessments: [{ subject: 'c1', answers: { ...ALL_NO, step_free: 'yes' } }] })
    expect(gates(h, reserved).find(g => g.code === 'RESERVED_ACCESSIBLE')!.passed).toBe(false)
  })
})

describe('the other two questions', () => {
  it('an assistance dog drives the pets gate and is named', () => {
    const h = household({ accessAssessments: [{ subject: 'c1', answers: { ...ALL_NO, assistance_dog: 'yes' } }] })
    const noPets = props.find(p => !p.petsAllowed)!
    const g = gates(h, noPets).find(x => x.code === 'PETS')!
    expect(g.passed).toBe(false)
    expect(g.message).toMatch(/Child 1 has an assistance dog/)
  })
  it('equipment or a carer is a warning, not a change to the bedroom count', async () => {
    const h = household({ accessAssessments: [{ subject: 'c1', answers: { ...ALL_NO, equipment_or_carer: 'yes' } }] })
    const r = await searchHousehold(h)
    expect(r.bedroomNeed).toBe(2)
    expect(r.validation).toContainEqual(expect.objectContaining({ path: 'access-c1-equipment_or_carer', severity: 'warning' }))
    expect(r.validation?.every(i => i.severity === 'warning')).toBe(true)
  })
  it('a wheelchair user answering "no" to a wheelchair-accessible home gets a check-this warning', () => {
    const h = household({ accessAssessments: [{ subject: 'c1', answers: ALL_NO }] })
    expect(validateHousehold(h, TODAY)).toEqual([expect.objectContaining({ path: 'access-c1-wheelchair_accessible', severity: 'warning' })])
  })
})

describe('scenario: wheelchair user fleeing abuse, on the new model', () => {
  it('keeps its result: only the two accessible units pass, and names whose need fails', async () => {
    const r = await scenarioSearch('access')
    expect(
      r.candidates
        .filter(c => c.eligible)
        .map(c => c.propertyId)
        .sort(),
    ).toEqual(['P07', 'P24'])
    const msgs = r.candidates.flatMap(c => c.blocks.map(b => b.message)).join(' ')
    expect(msgs).toMatch(/Adult 1 needs a wheelchair-accessible home/)
    expect(msgs).toMatch(/Adult 1 has an assistance dog/)
  })
})
