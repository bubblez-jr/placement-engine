import { describe, expect, it } from 'vitest'
import schema1 from './fixtures/schema1-localstorage.json'
import { verifyChain } from '../src/audit/chain'
import { clocksNow, consentAtDecision, consentSummary, currentConsent, decisionRecords, deciderOf, recordKind } from '../src/audit/records'
import { isDecisionSnapshot } from '../src/audit/snapshot'
import { STAFF } from '../src/data/staff'
import { cmdDecide, cmdUpdateConsent, type CommandCtx } from '../src/store/commands'
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
