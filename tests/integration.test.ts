import { describe, expect, it } from 'vitest'
import { verifyChain } from '../src/audit/chain'
import { caseNoteText, placementsCsv } from '../src/audit/exports'
import { sha256Hex } from '../src/audit/hash'
import { caseRefOf, decisionRecords, recordKind, storyOf, tasksFrom, placementsFrom } from '../src/audit/records'
import { isPlacementEvent, type PlacementEvent } from '../src/audit/snapshot'
import { SCENARIOS } from '../src/data/households'
import { STAFF } from '../src/data/staff'
import { parseHouseholdImport } from '../src/engine/householdImport'
import { PermissionError } from '../src/engine/permissions'
import { validateHousehold, ValidationError } from '../src/engine/validate'
import { cmdDecide, cmdExport, cmdImportHousehold, cmdSearch, cmdTransition, type CommandCtx } from '../src/store/commands'
import { activeRulesetOf, seed, type AppData } from '../src/store/data'
import { lookupPostcode, normalisePostcode } from '../src/places/postcodes'
import { estimateProvider } from '../src/travel/estimate'
import type { ChainRecord } from '../src/audit/chain'

const TODAY = '2026-11-16'
const at = (hhmm: string, date = TODAY) => `${date}T${hhmm}:00.000Z`
const as = (id: string, now = at('10:00'), today = TODAY): CommandCtx => ({ user: STAFF.find(s => s.id === id)!, now, today })
const officer = as('u-ta-1')
import familyFile from '../docs/examples/household-family-of-four.json?raw'
import wheelchairFile from '../docs/examples/household-wheelchair-user.json?raw'
const EXAMPLES: Record<string, string> = { 'household-family-of-four.json': familyFile, 'household-wheelchair-user.json': wheelchairFile }
const example = (name: string) => EXAMPLES[name]
const refused = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (e) {
    return e
  }
  throw new Error('expected a refusal')
}

describe('importing a household (placement-household/1)', () => {
  it('reads the complete example, reports the field it does not understand, and it passes validation', () => {
    const r = parseHouseholdImport(example('household-family-of-four.json'))
    expect(r.problems).toEqual([])
    expect(r.source).toEqual({ system: 'Example case system (synthetic)', exportedAt: '2026-11-16T09:12:00Z' })
    expect(r.notUnderstood).toEqual([{ path: 'reason_for_homelessness', note: 'Not a field of this format.' }])
    const h = r.household!
    expect(h.members.map(m => `${m.label} ${m.age}`)).toEqual(['Adult 1 36', 'Child 1 12', 'Child 2 8', 'Child 3 3'])
    expect(h.destinations.map(d => [d.name, d.personId, d.placeSource])).toEqual([
      ['Eastfield Academy', 'c1', 'import'],
      ['Mill Lane Primary School', 'c2', 'import'],
      ['Care work, Ilford', 'a1', 'import'],
    ])
    expect(h.homeAreaLabel).toBe('Manor Park, Demo Borough')
    expect(validateHousehold(h, TODAY).filter(i => i.severity === 'error')).toEqual([])
  })
  it('the wheelchair example cannot be searched until the access questions and the date are answered', () => {
    const r = parseHouseholdImport(example('household-wheelchair-user.json'))
    expect(r.problems).toEqual([])
    expect(r.notUnderstood).toEqual([
      {
        path: 'places[1]',
        note: 'Not imported: Retail job, Stratford centre has no coordinates (postcode E15 1XX). Add it on the form with “Add a place by postcode”.',
      },
    ])
    const h = r.household!
    expect(h.members[0]).toMatchObject({ label: 'Adult 1', wheelchairUser: true, partnerOf: 'a2' })
    const errors = validateHousehold(h, TODAY).filter(i => i.severity === 'error')
    expect(errors.map(e => e.path).sort()).toEqual([
      'access-a1-adapted_bathroom',
      'access-a1-assistance_dog',
      'access-a1-equipment_or_carer',
      'access-a1-ground_floor_or_lift',
      'access-a1-step_free',
      'access-a1-wheelchair_accessible',
      'needFrom',
    ])
  })
  it('refuses a file that is not this format, and says why', () => {
    expect(parseHouseholdImport('not json').problems).toEqual(['The file is not valid JSON.'])
    expect(parseHouseholdImport('[]').problems[0]).toMatch(/one household as a JSON object/)
    expect(parseHouseholdImport('{"format":"other/1","members":[{}]}').problems[0]).toMatch(/This one says "other\/1"/)
    expect(parseHouseholdImport('{"format":"placement-household/1"}').problems[0]).toMatch(/no "members" list/)
  })
  it('reports every field it cannot use, keeps values the form must flag, and drops nothing silently', () => {
    const r = parseHouseholdImport(
      JSON.stringify({
        format: 'placement-household/1',
        case_reference: 'HN-1',
        members: [
          { ref: 'x', role: 'adult', age: 'forty', sex: 'female', wheelchair_user: 'yes', partner_ref: 'nobody', shoe_size: 9 },
          { ref: 'y', role: 'child', age: -3, sex: 'M', access_needs: { step_free: 'maybe', teleport: 'yes' } },
          { ref: 'z', role: 'lodger', age: 30 },
        ],
        places: [{ person_ref: 'q', kind: 'school', name: 'A school', lat: 51.5, lng: 0.01, arrive_by: 845, days_per_week: 5 }],
        priority_flags: ['domestic_abuse', 'vip'],
        last_settled_area: { label: 'Somewhere', lat: 'x', lng: 0 },
      }),
    )
    const paths = r.notUnderstood.map(n => n.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'members[0].shoe_size',
        'members[0].age',
        'members[0].sex',
        'members[0].wheelchair_user',
        'members[1].access_needs.teleport',
        'members[1].access_needs.step_free',
        'members[2]',
        'places[0].person_ref',
        'places[0].arrive_by',
        'priority_flags',
        'last_settled_area',
      ]),
    )
    const h = r.household!
    expect(h.members.length).toBe(2)
    expect(h.flags).toEqual(['domestic_abuse'])
    const errors = validateHousehold(h, TODAY).filter(i => i.severity === 'error')
    const ep = errors.map(e => e.path)
    expect(ep).toEqual(expect.arrayContaining(['age-a1', 'age-c1', 'partner-a1', 'homeArea', 'needFrom', 'expectedNights', 'afford', 'who-d1', 'arrive-d1']))
  })
  it('stamps who imported it, needs the import permission, and never runs a search', async () => {
    const d = await seed(at('09:00'), TODAY)
    const r = cmdImportHousehold(d, officer, example('household-family-of-four.json'))
    expect(r.household!.importedFrom).toEqual({
      format: 'placement-household/1',
      system: 'Example case system (synthetic)',
      exportedAt: '2026-11-16T09:12:00Z',
      importedBy: { userId: 'u-ta-1', name: 'Sam Okafor', role: 'ta_officer', roleLabel: 'Temporary accommodation officer' },
      importedAt: at('10:00'),
    })
    expect(r.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(d.searches.length).toBe(0)
    for (const who of ['u-aud-1', 'u-sup-1']) expect(await refused(() => cmdImportHousehold(d, as(who), '{}'))).toBeInstanceOf(PermissionError)
    expect(cmdImportHousehold(d, as('u-adm-1'), example('household-family-of-four.json')).household).not.toBeNull()
  })
  it('an imported wheelchair user with no access answers is refused at search; once answered, the search runs and keeps where the details came from', async () => {
    const d = await seed(at('09:00'), TODAY)
    const { household } = cmdImportHousehold(d, officer, example('household-wheelchair-user.json'))
    const e = (await refused(cmdSearch(d, officer, household!, { id: 'S-IMP', travel: estimateProvider }))) as ValidationError
    expect(e).toBeInstanceOf(ValidationError)
    expect(e.issues.filter(i => i.path.startsWith('access-a1-')).length).toBe(6)
    const answered = {
      ...household!,
      needFrom: '2026-11-18',
      accessAssessments: [
        {
          subject: 'a1',
          answers: {
            wheelchair_accessible: 'yes' as const,
            step_free: 'yes' as const,
            ground_floor_or_lift: 'yes' as const,
            adapted_bathroom: 'yes' as const,
            assistance_dog: 'no' as const,
            equipment_or_carer: 'no' as const,
          },
        },
      ],
    }
    const { result } = await cmdSearch(d, officer, answered, { id: 'S-IMP', travel: estimateProvider })
    expect(result.household.importedFrom?.system).toBe('Example case system (synthetic)')
    expect(result.household.accessAssessments![0].answeredBy?.name).toBe('Sam Okafor')
    for (const c of result.candidates.filter(c => c.eligible)) {
      const p = d.properties.find(x => x.id === c.propertyId)!
      expect(p.wheelchairAccessible && p.stepFree && p.adaptedBathroom).toBe(true)
    }
  })
})

describe('postcode lookup', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  it('normalises UK postcodes', () => {
    expect(normalisePostcode(' e151aa ')).toBe('E15 1AA')
    expect(normalisePostcode('SW1A 1AA')).toBe('SW1A 1AA')
    expect(normalisePostcode('E15')).toBeNull()
    expect(normalisePostcode('12345')).toBeNull()
  })
  it('finds a postcode and sends only the postcode', async () => {
    const calls: string[] = []
    const f = (async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({ status: 200, result: { postcode: 'E15 1AA', latitude: 51.541, longitude: 0.001, admin_district: 'Newham' } }))
    }) as unknown as typeof fetch
    expect(await lookupPostcode('e15 1aa', f)).toEqual({ ok: true, postcode: 'E15 1AA', location: { lat: 51.541, lng: 0.001 }, district: 'Newham' })
    expect(calls).toEqual(['https://api.postcodes.io/postcodes/E15%201AA'])
  })
  it('says when a postcode is unknown, invalid, has no location, or the lookup fails', async () => {
    expect(await lookupPostcode('ZZ9 9ZZ', ok({ status: 404, error: 'Postcode not found' }, 404))).toMatchObject({ ok: false, reason: 'unknown' })
    expect(await lookupPostcode('nope', ok({}))).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await lookupPostcode('E15 1AA', ok({ status: 200, result: { postcode: 'E15 1AA', latitude: null, longitude: null } }))).toMatchObject({
      ok: false,
      reason: 'no_location',
    })
    expect(await lookupPostcode('E15 1AA', (async () => Promise.reject(new TypeError('blocked'))) as typeof fetch)).toMatchObject({
      ok: false,
      reason: 'failed',
    })
    expect(await lookupPostcode('E15 1AA', ok({ error: 'down' }, 500))).toMatchObject({ ok: false, reason: 'failed' })
    expect(await lookupPostcode('E15 1AA', (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toMatchObject({
      ok: false,
      reason: 'failed',
    })
  })
})

describe('exports', () => {
  /** A full placement story: decided, confirmed, offered, accepted, moved in, moved out. */
  async function story(): Promise<{ d: AppData; seq: number }> {
    const h = SCENARIOS.find(s => s.id === 'brief')!.household(TODAY)
    let { data: d, result } = await cmdSearch(await seed(at('09:00'), TODAY), officer, h, { id: 'S-1', travel: estimateProvider })
    const dec = await cmdDecide(
      d,
      officer,
      result.id,
      {
        outcome: 'accepted',
        chosenPropertyId: result.recommendedId!,
        reasonText: 'Keeps all three children at their schools.',
        startDate: TODAY,
        confirmedFullListReviewed: true,
        consent: { status: 'given', givenBy: 'Adult 1', method: 'in_person' },
      },
      { resultsOpenedAt: at('09:55'), propertiesOpened: [], comparisonOpened: false },
    )
    d = dec.data
    const seq = dec.record.seq
    const steps: [string, Parameters<typeof cmdTransition>[3]][] = [
      ['10:20', { action: 'confirm_provider', contactName: 'Mo Patel, Northside Lettings', providerReference: 'NL-2611-04' }],
      ['10:40', { action: 'offer', method: 'phone' }],
      ['10:45', { action: 'accept' }],
      ['18:00', { action: 'check_in', checkedInOn: TODAY }],
    ]
    for (const [time, input] of steps) d = (await cmdTransition(d, as('u-ta-1', at(time)), seq, input)).data
    d = (
      await cmdTransition(d, as('u-ta-2', at('12:00', '2026-12-10'), '2026-12-10'), seq, {
        action: 'move_out',
        movedOutOn: '2026-12-10',
        reason: 'Offered a council tenancy',
        destination: 'settled_home',
      })
    ).data
    return { d, seq }
  }
  const later = as('u-ta-1', at('09:00', '2026-12-11'), '2026-12-11')

  it('the case note tells the whole story in order, with its sources and the synthetic label', async () => {
    const { d, seq } = await story()
    const rec = decisionRecords(d.chain).find(r => r.seq === seq)!
    const text = caseNoteText(d.chain, rec, at('09:00', '2026-12-11'))
    expect(text).toMatch(/^PLACEMENT DECISION: CASE HN-26-0317\n/)
    expect(text).toContain('SYNTHETIC DEMO DATA')
    expect(text).toContain('Decided by: Sam Okafor, Temporary accommodation officer')
    expect(text).toContain('Officer’s words: “Keeps all three children at their schools.”')
    expect(text).toContain('Consent to notify school, GP and health visitor: Consent given by Adult 1, in person.')
    expect(text).toContain('Journey times: Journey times are estimates from straight-line distance (the demo model)')
    expect(text).toContain('Subsidy figures: Illustrative subsidy figures.')
    const order = ['Decision recorded', 'Provider confirmed', 'Offered to the household', 'accepted the offer', 'moved in on', 'moved out on 10 Dec 2026']
    const idx = order.map(s => text.indexOf(s))
    expect(idx.every(i => i > 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(text).toMatch(/Status when exported, .*: Placement: moved out\./)
    expect(text).not.toMatch(/—/)
  })
  it('the placements CSV has one row per placement with its state and sources', async () => {
    const { d } = await story()
    const { text, rows } = placementsCsv(d.chain, at('09:00', '2026-12-11'))
    const lines = text.split('\n')
    expect(rows).toBe(1)
    expect(lines[0]).toBe(
      'decision_record,case_reference,outcome,property_id,property,state,decided_at,decided_by,start_date,planned_end,moved_in_on,moved_out_on,approval,six_week_rule,journey_times,subsidy_figures,synthetic',
    )
    const p = placementsFrom(d.chain, at('09:00', '2026-12-11'))[0]
    expect(lines[1]).toBe(
      `1,HN-26-0317,accepted,${p.propertyId},${p.propertyLabel},Moved out,${at('10:00')},Sam Okafor,2026-11-16,${p.currentEnd},2026-11-16,2026-12-10,not_required,no,estimated,illustrative,yes`,
    )
  })
  it('each export is sealed first: who, what, how, and a fingerprint of exactly what left', async () => {
    const { d, seq } = await story()
    const before = d.chain.length
    const a = await cmdExport(d, later, { format: 'case_note', seq, delivery: 'clipboard' })
    expect(a.data.chain.length).toBe(before + 1)
    const ev = a.record.snapshot as PlacementEvent
    expect(ev).toMatchObject({
      schema: 'placement-event/1',
      caseRef: 'HN-26-0317',
      about: { seq },
      actor: { userId: 'u-ta-1' },
      event: { type: 'records_exported', format: 'case_note', delivery: 'clipboard', contentSha256: await sha256Hex(a.content!) },
    })
    expect(a.fileName).toBe(`placement-decision-${seq}-HN-26-0317-case-note.txt`)
    const b = await cmdExport(a.data, later, { format: 'decision_json', seq, delivery: 'download' })
    expect(JSON.parse(b.content!)).toMatchObject({ seq, snapshot: { schema: 'placement-decision/2' } })
    const c = await cmdExport(b.data, later, { format: 'placements_csv', delivery: 'download' })
    expect(c.record.snapshot).toMatchObject({ caseRef: null, about: null, event: { type: 'records_exported', format: 'placements_csv', records: 1 } })
    expect(caseRefOf(c.record)).toBe('All placements')
    expect(recordKind(c.record)).toBe('Export of all placements')
    const pdfHash = 'a'.repeat(64)
    const e = await cmdExport(c.data, as('u-aud-1', at('09:05', '2026-12-11'), '2026-12-11'), {
      format: 'audit_pdf',
      seq,
      delivery: 'download',
      contentSha256: pdfHash,
    })
    expect(e.content).toBeNull()
    expect(e.record.snapshot).toMatchObject({ actor: { role: 'auditor' }, event: { format: 'audit_pdf', contentSha256: pdfHash } })
    expect(await refused(cmdExport(c.data, later, { format: 'audit_pdf', seq, delivery: 'download', contentSha256: 'x' }))).toBeInstanceOf(Error)
    // The exports join the decision's story and the chain still verifies; tasks and the placement are unaffected.
    const rec = decisionRecords(e.data.chain).find(r => r.seq === seq)!
    const texts = storyOf(e.data.chain, rec).map(s => s.text)
    expect(texts.filter(t => t.startsWith('Exported ')).length).toBe(3)
    expect(texts).toContain(
      `Exported a case note for the case system, copied out to paste elsewhere. Content fingerprint ${(await sha256Hex(a.content!)).slice(0, 16)}.`,
    )
    expect(await verifyChain(e.data.chain)).toEqual({ ok: true, checked: e.data.chain.length })
    expect(placementsFrom(e.data.chain, at('09:00', '2026-12-11'))[0].state).toBe('moved_out')
    expect(tasksFrom(e.data.chain, e.data.properties, activeRulesetOf(e.data), at('09:00', '2026-12-11')).length).toBe(
      tasksFrom(d.chain, d.properties, activeRulesetOf(d), at('09:00', '2026-12-11')).length,
    )
  })
  it('needs a signed-in person; every role may export, and each export names them', async () => {
    const { d, seq } = await story()
    expect(await refused(cmdExport(d, { user: null, now: at('10:00'), today: TODAY }, { format: 'case_note', seq, delivery: 'clipboard' }))).toBeInstanceOf(
      PermissionError,
    )
    for (const u of STAFF) {
      const r = await cmdExport(d, as(u.id), { format: 'placements_csv', delivery: 'clipboard' })
      expect((r.record as ChainRecord<PlacementEvent>).snapshot.actor.userId).toBe(u.id)
    }
  })
  it('records sealed before exports existed still read the same', async () => {
    const { d } = await story()
    expect(d.chain.filter(r => isPlacementEvent(r.snapshot)).every(r => recordKind(r) !== 'Export')).toBe(true)
  })
})
