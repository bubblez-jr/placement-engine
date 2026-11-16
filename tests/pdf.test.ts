import { describe, expect, it } from 'vitest'
import { decisionRecords } from '../src/audit/records'
import { renderAuditPdf } from '../src/pdf/AuditPdf'
import { STAFF } from '../src/data/staff'
import { cmdDecide, cmdUpdateConsent } from '../src/store/commands'
import { migrate } from '../src/store/migrate'
import schema1 from './fixtures/schema1-localstorage.json'

// The PDF renders from the sealed record only. Both record versions must render.
const NOW = '2026-11-16T09:00:00.000Z'
const ctx = { user: STAFF[0], now: NOW, today: '2026-11-16' }

describe('audit pack PDF', () => {
  it('renders a schema-1 record, and a V2 record with a later consent event', async () => {
    let d = migrate(structuredClone(schema1), NOW)!
    const old = decisionRecords(d.chain)[1]
    const a = await renderAuditPdf(old, d.chain)
    expect(a.size).toBeGreaterThan(5000)

    const s = d.searches.find(x => x.id === 'S-FIX-DIALYSIS')!
    d = (
      await cmdDecide(
        d,
        ctx,
        s.id,
        { outcome: 'accepted', chosenPropertyId: s.recommendedId, reasonText: '', startDate: '2026-11-16', confirmedFullListReviewed: true },
        { resultsOpenedAt: NOW, propertiesOpened: [], comparisonOpened: false },
      )
    ).data
    d = (await cmdUpdateConsent(d, ctx, 2, { status: 'refused', givenBy: 'Adult 1', method: 'written' })).data
    const b = await renderAuditPdf(decisionRecords(d.chain)[1], d.chain)
    expect(b.size).toBeGreaterThan(5000)
    const c = await renderAuditPdf(decisionRecords(d.chain)[2], d.chain)
    expect(c.size).toBeGreaterThan(5000)
  }, 30_000)
})
