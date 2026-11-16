import { describe, expect, it } from 'vitest'
import schema1 from './fixtures/schema1-localstorage.json'
import schema2 from './fixtures/schema2-localstorage.json'
import { verifyChain } from '../src/audit/chain'
import {
  approvalOf,
  clocksNow,
  consentAtDecision,
  consentSummary,
  currentConsent,
  decisionRecords,
  deciderOf,
  describeEvent,
  placementBaseOf,
  placementOf,
  placementsFrom,
  recordKind,
  tasksFrom,
} from '../src/audit/records'
import { addHours } from '../src/engine/dates'
import { occupancyOf } from '../src/engine/occupancy'
import { isDecisionSnapshot } from '../src/audit/snapshot'
import { STAFF } from '../src/data/staff'
import { cmdDecide, cmdExport, cmdTransition, cmdUpdateConsent, type CommandCtx } from '../src/store/commands'
import { journeyView, subsidyOfSearch } from '../src/audit/provenance'
import { caseNoteText, placementsCsv } from '../src/audit/exports'
import { journeySourceOf } from '../src/engine/journeys'
import { KEY_V1, KEY_V2, loadStored, migrate } from '../src/store/migrate'

// tests/fixtures/schema1-localstorage.json was written by the main-branch (schema 1)
// code: seed() and decide() exactly as the live demo ran them. It holds two
// sealed decisions (consent ticked and unticked) and an open search.
const raw = () => structuredClone(schema1) as Record<string, any>
const NOW = '2026-11-16T09:00:00.000Z'
const officer: CommandCtx = { user: STAFF.find(s => s.id === 'u-ta-2')!, now: NOW, today: '2026-11-16' }

describe('schema 1 → 2 migration', () => {
  it('the fixture is genuine schema 1 and its chain verifies before migration', async () => {
    const v1 = raw()
    expect(v1.schema).toBe(1)
    expect(v1.chain.map((r: { snapshot: { schema: string } }) => r.snapshot.schema)).toEqual(['placement-decision/1', 'placement-decision/1'])
    expect(await verifyChain(v1.chain)).toEqual({ ok: true, checked: 2 })
  })

  it('upgrades to schema 2 without touching a sealed record', async () => {
    const v1 = raw()
    const v2 = migrate(structuredClone(v1), NOW)!
    expect(v2.schema).toBe(2)
    expect(v2.migratedFrom).toEqual({ schema: 1, at: NOW })
    expect(JSON.stringify(v2.chain)).toBe(JSON.stringify(v1.chain))
    expect(await verifyChain(v2.chain)).toEqual({ ok: true, checked: 2 })
  })

  it('leaves schema-2 data alone and refuses data it does not recognise', () => {
    const v2 = migrate(raw(), NOW)!
    expect(migrate(v2, '2030-01-01T00:00:00Z')).toBe(v2)
    expect(migrate(null, NOW)).toBeNull()
    expect(migrate({ schema: 1 }, NOW)).toBeNull()
    expect(migrate({ ...raw(), schema: 7 }, NOW)).toBeNull()
  })

  it('reads the v2 key first, then falls back to the schema-1 key', () => {
    const store = new Map<string, unknown>([[KEY_V1, raw()]])
    const loaded = loadStored({ load: <T>(k: string) => (store.get(k) ?? null) as T | null }, NOW)!
    expect(loaded.schema).toBe(2)
    store.set(KEY_V2, { ...loaded, seededAt: 'from-v2' })
    expect(loadStored({ load: <T>(k: string) => (store.get(k) ?? null) as T | null }, NOW)!.seededAt).toBe('from-v2')
  })
})

describe('schema-1 records still render through the shared views', () => {
  const d = migrate(raw(), NOW)!
  const [r1, r2] = decisionRecords(d.chain)
  it('the decider is the free text the record was sealed with, marked as not signed in', () => {
    expect(deciderOf(r1.snapshot)).toEqual({ name: 'Sam Okafor', roleLabel: 'Temporary Accommodation Officer', signedIn: false })
  })
  it('consent reads as the earlier tick-box, honestly', () => {
    expect(consentAtDecision(r1.snapshot)).toEqual({ kind: 'legacy', consented: true })
    expect(consentAtDecision(r2.snapshot)).toEqual({ kind: 'legacy', consented: false })
    expect(consentSummary(consentAtDecision(r2.snapshot))).toMatch(/^Consent recorded as no under the earlier version/)
  })
  it('the household has no access answers, and nothing breaks', () => {
    expect(r1.snapshot.search.household.accessAssessments).toBeUndefined()
    expect(r1.snapshot.search.validation).toBeUndefined()
    expect(recordKind(r1)).toBe('Decision (earlier version)')
  })
})

describe('new records after old ones', () => {
  it('a V2 decision and a consent event append to a schema-1 chain, and the whole chain verifies', async () => {
    let d = migrate(raw(), NOW)!
    const s = d.searches.find(x => x.id === 'S-FIX-DIALYSIS')!
    // the stored search predates schema 2 and has no validation field: deciding on it still works
    const decided = await cmdDecide(
      d,
      officer,
      s.id,
      { outcome: 'accepted', chosenPropertyId: s.recommendedId, reasonText: '', startDate: '2026-11-16', confirmedFullListReviewed: true },
      { resultsOpenedAt: NOW, propertiesOpened: [], comparisonOpened: false },
    )
    d = decided.data
    expect(decided.record.snapshot.schema).toBe('placement-decision/2')
    expect(decided.record.snapshot.decision.decidedBy).toEqual({
      userId: 'u-ta-2',
      name: 'Priya Raman',
      role: 'ta_officer',
      roleLabel: 'Temporary accommodation officer',
    })

    // a later consent answer on the schema-1 record whose tick-box was unticked
    const before = JSON.stringify(d.chain[1])
    const ev = await cmdUpdateConsent(d, officer, 2, { status: 'given', givenBy: 'Adult 2', method: 'phone', note: 'Rang back after school run.' })
    d = ev.data
    expect(JSON.stringify(d.chain[1])).toBe(before)
    expect(ev.record.snapshot.about).toEqual({ seq: 2, rowHash: d.chain[1].rowHash })
    expect(ev.record.snapshot.event).toMatchObject({ type: 'consent_updated', previous: { legacyConsentToNotify: false } })
    expect(await verifyChain(d.chain)).toEqual({ ok: true, checked: 4 })

    const rec2 = decisionRecords(d.chain).find(r => r.seq === 2)!
    const cur = currentConsent(d.chain, rec2)
    expect(cur.now).toMatchObject({ kind: 'record', consent: { status: 'given', givenBy: 'Adult 2', recordedBy: { name: 'Priya Raman' } } })
    expect(cur.updates.map(u => u.seq)).toEqual([4])
    // the sealed "ask again" clock reads as the notification now that consent is given
    expect(clocksNow(d.chain, rec2).find(c => c.key === 's213aa')!.label).toBe("Notify the children's school(s), GP and health visitor")
    expect(rec2.snapshot.clocks.find(c => c.key === 's213aa')!.label).toMatch(/Ask again/)
    expect(d.chain.filter(r => !isDecisionSnapshot(r.snapshot))).toHaveLength(1)
  })
})

// tests/fixtures/schema2-localstorage.json was written by the phase 1 code (commit
// 2e441b3) through its own commands: three decisions (one with a later consent
// event) sealed as placement-decision/2 without `terms`, one of them a pregnant
// woman placed in a shared annex, and an open search.
describe('decisions sealed before placements were tracked', () => {
  const v1 = () => migrate(raw(), NOW)!
  const v2 = () => migrate(structuredClone(schema2), NOW)!

  it('the schema-2 fixture is genuine phase 1 data: no terms, and its chain verifies', async () => {
    const d = v2()
    expect(d.chain.map(r => r.snapshot.schema)).toEqual(['placement-decision/2', 'placement-decision/2', 'placement-event/1', 'placement-decision/2'])
    expect(decisionRecords(d.chain).every(r => r.snapshot.schema === 'placement-decision/2' && r.snapshot.terms === undefined)).toBe(true)
    expect(await verifyChain(d.chain)).toEqual({ ok: true, checked: 4 })
  })

  it('each becomes a placement held from its decision time under the default policy, with no exceptions', () => {
    for (const [d, firstAt] of [
      [v1(), '2026-11-10T10:00:00.000Z'],
      [v2(), '2026-11-12T10:00:00.000Z'],
    ] as const) {
      const r = decisionRecords(d.chain)[0]
      const base = placementBaseOf(r)!
      expect(base).toMatchObject({ legacy: true, exceptions: [], approvalRequired: false })
      expect(base.holdUntil).toBe(addHours(r.snapshot.decision.decidedAt, 24))
      expect(placementOf(d.chain, r, firstAt)!.state).toBe('held')
      expect(approvalOf(d.chain, r).status).toBe('not_required')
    }
  })

  it('days later their holds have expired: the properties are free and nothing crashes', () => {
    for (const d of [v1(), v2()]) {
      const ps = placementsFrom(d.chain, NOW)
      expect(ps.map(p => p.state).every(s => s === 'hold_expired')).toBe(true)
      expect(occupancyOf(ps, NOW)).toEqual([])
      const ts = tasksFrom(d.chain, d.properties, d.rulesets[0], NOW)
      expect(ts.filter(t => t.seq !== undefined && t.kind !== 'certificate')).toEqual([])
    }
  })

  it('a schema-1 decision has no signed-in decider: its tasks go to the officers’ queue', () => {
    const d = v1()
    const t = tasksFrom(d.chain, d.properties, d.rulesets[0], '2026-11-11T08:00:00.000Z').find(x => x.id === 'hold:1')!
    expect(t.owner).toEqual({ kind: 'role', role: 'ta_officer' })
    expect(placementBaseOf(decisionRecords(d.chain)[0])!.decidedBy).toBeNull()
  })

  it('a phase 1 shared-annex placement still in its hold gets the ladder, saying no plan was recorded', () => {
    const d = v2()
    const r = decisionRecords(d.chain).find(x => x.seq === 4)!
    const base = placementBaseOf(r)!
    expect(base).toMatchObject({ sixWeekRule: true, propertyId: 'P06' })
    const ts = tasksFrom(d.chain, d.properties, d.rulesets[0], '2026-11-13T08:00:00.000Z').filter(t => t.seq === 4)
    expect(ts.map(t => t.id)).toEqual(['bnb-review:4:1'])
    expect(ts[0].owner).toEqual({ kind: 'user', userId: 'u-ooh-1', name: 'Dele Adeyemi', role: 'ooh_officer' })
    expect(ts.find(t => t.kind === 'bnb_review')!.detail).toBe('No move-on plan was recorded under the earlier version.')
  })

  it('a phase 1 decision inside its hold can be taken through the lifecycle; nothing sealed is edited', async () => {
    let d = v2()
    const before = JSON.stringify(d.chain)
    const ctx = { user: STAFF.find(s => s.id === 'u-ta-1')!, now: '2026-11-12T15:00:00.000Z', today: '2026-11-12' }
    d = (await cmdTransition(d, ctx, 1, { action: 'confirm_provider', contactName: 'Mo Patel', providerReference: 'NL-55' })).data
    expect(JSON.stringify(d.chain.slice(0, 4))).toBe(before)
    expect(placementOf(d.chain, decisionRecords(d.chain)[0], NOW)!.state).toBe('provider_confirmed')
    expect(await verifyChain(d.chain)).toEqual({ ok: true, checked: 5 })
  })

  it('the phase 1 consent event reads through the same description as new events', () => {
    const e = v2().chain[2].snapshot
    expect(isDecisionSnapshot(e)).toBe(false)
    expect(describeEvent(e as never)).toBe('Consent changed: Consent given by Adult 2, by phone.')
    expect(recordKind(v2().chain[2])).toBe('Consent update for #2')
  })
})

describe('records made before phase 3 (no journey or subsidy provenance)', () => {
  for (const [name, fixture] of [
    ['schema 1', schema1],
    ['schema 2 (phase 1)', schema2],
  ] as const) {
    it(`${name}: journeys read as the estimate, subsidy as illustrative, and every export builds`, async () => {
      const d = migrate(structuredClone(fixture), NOW)!
      const recs = decisionRecords(d.chain)
      expect(recs.length).toBeGreaterThan(0)
      for (const r of recs) {
        const s = r.snapshot.search
        expect(s.travelProvider.outcome).toBeUndefined()
        const j = journeyView(s)
        expect(j).toMatchObject({ legacy: true, outcome: 'estimated', tone: 'info' })
        expect(s.candidates[0].journeys.every(x => journeySourceOf(x, s.travelProvider) === 'estimate')).toBe(true)
        expect(subsidyOfSearch(s, r.snapshot.ruleset)).toMatchObject({ status: 'illustrative', label: 'Illustrative subsidy figures' })
        const note = caseNoteText(d.chain, r, NOW)
        expect(note).toContain(`CASE ${s.household.caseRef}`)
        expect(note).toContain('Subsidy figures: Illustrative subsidy figures.')
      }
      for (const s of d.searches) expect(journeyView(s).legacy).toBe(true)
      expect(placementsCsv(d.chain, NOW).rows).toBe(recs.filter(r => r.snapshot.decision.chosenPropertyId).length)
      // An export appended to old data keeps the old records verifying.
      const ex = await cmdExport(d, officer, { format: 'decision_json', seq: recs[0].seq, delivery: 'clipboard' })
      expect(await verifyChain(ex.data.chain)).toEqual({ ok: true, checked: d.chain.length + 1 })
    })
  }
})
