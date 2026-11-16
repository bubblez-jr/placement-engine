import { describe, expect, it } from 'vitest'
import { verifyChain } from '../src/audit/chain'
import { approvalOf, decisionRecords, isSeeded, placementsFrom, statusLine, storyOf, tasksFrom, termsRows } from '../src/audit/records'
import { renderAuditPdf } from '../src/pdf/AuditPdf'
import { SCENARIOS } from '../src/data/households'
import { STAFF } from '../src/data/staff'
import { sharedStayDay } from '../src/engine/placement'
import { cmdSearch } from '../src/store/commands'
import { activeRulesetOf } from '../src/store/data'
import { seedDemo } from '../src/store/demo'
import { estimateProvider } from '../src/travel/estimate'

// The demo opens with genuine sealed history, made by the same commands as
// live use. Wednesday 18 Nov 2026, mid-morning.
const NOW = '2026-11-18T10:30:00.000Z'

describe('seeded demo history', async () => {
  const d = await seedDemo(NOW)
  const placements = placementsFrom(d.chain, NOW)
  const tasks = tasksFrom(d.chain, d.properties, activeRulesetOf(d), NOW)

  it('is a valid chain, every record labelled as seeded synthetic data', async () => {
    expect(await verifyChain(d.chain)).toEqual({ ok: true, checked: d.chain.length })
    expect(d.chain.every(isSeeded)).toBe(true)
    expect(d.chain.every(r => r.snapshot.notes.some(n => n.startsWith('SYNTHETIC DEMO DATA')))).toBe(true)
  })
  it('a family in B&B on day 31 of 42, with the ladder part-way: three reviews done, the manager step escalated', () => {
    const bnb = placements.find(p => p.caseRef === 'HN-26-0412')!
    expect(bnb).toMatchObject({ state: 'checked_in', propertyId: 'P04', sixWeekRule: true })
    expect(sharedStayDay(bnb, NOW)).toMatchObject({ day: 31, limit: 42, breached: false })
    const ladder = tasks.filter(t => t.seq === bnb.seq && t.kind.startsWith('bnb'))
    expect(ladder.map(t => `${t.id.replace(`:${bnb.seq}`, '')} ${t.status}/${t.escalation}`)).toEqual([
      'bnb-review:1 done/none',
      'bnb-review:2 done/none',
      'bnb-review:3 done/none',
      'bnb-manager open/escalated',
      'bnb-review:4 open/escalated',
      'bnb-review:5 open/none',
      'bnb-urgent open/none',
    ])
    expect(approvalOf(d.chain, decisionRecords(d.chain).find(r => r.seq === bnb.seq)!).status).toBe('approved')
  })
  it('an occupied property is ruled out of today’s search for the brief example, with its dates', async () => {
    const officer = { user: STAFF[0], now: NOW, today: '2026-11-18' }
    const { result } = await cmdSearch(d, officer, SCENARIOS.find(s => s.id === 'brief')!.household('2026-11-18'), { id: 'S-T', travel: estimateProvider })
    const c = result.candidates.find(x => x.propertyId === 'P08')!
    expect(c.blocks.map(b => b.message)).toEqual(['Occupied 29 Oct to 27 Apr'])
    expect(result.recommendedId).toBe('P01')
  })
  it('an override an hour ago is waiting for a manager, its property held', () => {
    const p = placements.find(x => x.caseRef === 'HN-26-0471')!
    expect(p).toMatchObject({ state: 'held', exceptions: ['not_recommended'] })
    expect(tasks.find(t => t.id === `approval:${p.seq}`)).toMatchObject({ status: 'open', owner: { kind: 'role', role: 'team_manager' } })
  })
  it('there are overdue and escalated tasks to show', () => {
    const open = tasks.filter(t => t.status === 'open')
    expect(open.filter(t => t.escalation === 'escalated').length).toBeGreaterThanOrEqual(2)
    expect(open.some(t => t.kind === 'certificate' && t.escalation !== 'none')).toBe(true)
    expect(tasks.find(t => t.kind === 's208')).toMatchObject({ status: 'done', completion: { reference: 'EMAIL-S208-0350' } })
  })
  it('the audit pack tells the B&B story in order, and the PDF renders it', async () => {
    const r = decisionRecords(d.chain).find(x => x.snapshot.search.household.caseRef === 'HN-26-0412')!
    const story = storyOf(d.chain, r).map(e => e.text.split(/[.:]/)[0])
    expect(story).toEqual([
      'Decision recorded; the property is held',
      'Placed out of hours, approval to follow',
      'Provider confirmed the booking',
      'Offered to the household (in person)',
      'The household accepted the offer',
      'The household moved in on 18 Oct 2026',
      'Approved by a manager',
      'Task done',
      'Task done',
      'Task done',
    ])
    expect(termsRows(r).map(([k]) => k)).toEqual(['Exceptions', 'Hold', 'Planned stay', 'Emergency reason', 'Move-on plan'])
    expect(statusLine(d.chain, r, NOW)).toBe('Placement: moved in. Exception approved.')
    expect((await renderAuditPdf(r, d.chain, NOW)).size).toBeGreaterThan(5000)
  }, 30_000)
})
