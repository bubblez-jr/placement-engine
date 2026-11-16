import { describe, expect, it } from 'vitest'
import { verifyChain } from '../src/audit/chain'
import { approvalOf, decisionRecords, describeEvent, placementOf, tasksFrom } from '../src/audit/records'
import { isPlacementEvent } from '../src/audit/snapshot'
import { SCENARIOS } from '../src/data/households'
import { STAFF } from '../src/data/staff'
import type { DecisionInput } from '../src/engine/decision'
import { OccupancyConflictError } from '../src/engine/occupancy'
import { PermissionError } from '../src/engine/permissions'
import { ValidationError } from '../src/engine/validate'
import {
  cmdCancelTask,
  cmdCompleteTask,
  cmdDecide,
  cmdDecideApproval,
  cmdExtendStay,
  cmdPlaceOutOfHours,
  cmdReassignTask,
  cmdSearch,
  cmdTransition,
  type CommandCtx,
} from '../src/store/commands'
import { activeRulesetOf, seed, type AppData } from '../src/store/data'
import { estimateProvider } from '../src/travel/estimate'

// The placement lifecycle, approvals and tasks through the same commands the
// React store calls, as each role, at fixed times. Monday 2 Nov 2026.
const TODAY = '2026-11-02'
const at = (hhmm: string, date = TODAY) => `${date}T${hhmm}:00.000Z`
const as = (id: string, now = at('10:00'), today = TODAY): CommandCtx => ({ user: STAFF.find(s => s.id === id)!, now, today })
const officer = as('u-ta-1')
const officer2 = as('u-ta-2')
const ooh = (now: string) => as('u-ooh-1', now)
const manager = as('u-mgr-1', at('11:00'))
const auditor = as('u-aud-1')
const review = { resultsOpenedAt: at('09:55'), propertiesOpened: [], comparisonOpened: false }
const household = (id: string) => SCENARIOS.find(s => s.id === id)!.household(TODAY)

const refused = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('expected the store to refuse')
}
async function search(d: AppData, ctx: CommandCtx, scenario: string, id: string) {
  const { data, result } = await cmdSearch(d, ctx, household(scenario), { id, travel: estimateProvider })
  return { d: data, s: result }
}
const accept = (propertyId: string, over: Partial<DecisionInput> = {}): DecisionInput => ({
  outcome: 'accepted',
  chosenPropertyId: propertyId,
  reasonText: '',
  startDate: TODAY,
  confirmedFullListReviewed: true,
  consent: { status: 'given', givenBy: 'Adult 1', method: 'in_person' },
  ...over,
})
const tasks = (d: AppData, now: string) => tasksFrom(d.chain, d.properties, activeRulesetOf(d), now)
const stateOf = (d: AppData, seq: number, now: string) => placementOf(d.chain, decisionRecords(d.chain).find(r => r.seq === seq)!, now)!

describe('a placement from hold to move-out', () => {
  it('each step is a sealed record with who, when and what it needs; the chain verifies', async () => {
    let { d, s } = await search(await seed(at('09:00'), TODAY), officer, 'brief', 'S-1')
    const dec = await cmdDecide(d, officer, s.id, accept(s.recommendedId!), review)
    d = dec.data
    const seq = dec.record.seq
    expect(dec.record.snapshot.terms).toMatchObject({
      exceptions: [],
      approvalRequired: false,
      placement: { holdHours: 24, holdUntil: at('10:00', '2026-11-03'), plannedEnd: '2027-05-01', sixWeekRule: false },
    })
    expect(stateOf(d, seq, at('10:01')).state).toBe('held')

    expect(await refused(cmdTransition(d, auditor, seq, { action: 'confirm_provider', contactName: 'Mo', providerReference: 'NL-1' }))).toBeInstanceOf(
      PermissionError,
    )
    expect(((await refused(cmdTransition(d, officer, seq, { action: 'confirm_provider' }))) as ValidationError).issues.map(i => i.path)).toEqual([
      'pl-contactName',
      'pl-providerReference',
    ])
    expect(await refused(cmdTransition(d, officer, seq, { action: 'offer', method: 'phone' }))).toBeInstanceOf(ValidationError)

    const steps: [string, Parameters<typeof cmdTransition>[3]][] = [
      ['10:20', { action: 'confirm_provider', contactName: 'Mo Patel, Northside Lettings', providerReference: 'NL-2611-04' }],
      ['10:40', { action: 'offer', method: 'phone', note: 'Read the address and the school journey.' }],
      ['10:45', { action: 'accept' }],
      ['18:00', { action: 'check_in', checkedInOn: TODAY }],
    ]
    for (const [time, input] of steps) d = (await cmdTransition(d, as('u-ta-1', at(time)), seq, input)).data
    expect(stateOf(d, seq, at('18:01')).state).toBe('checked_in')
    // Moved in: the hold no longer matters.
    expect(stateOf(d, seq, at('10:00', '2026-11-20')).state).toBe('checked_in')
    const out = await cmdTransition(d, as('u-ta-2', at('12:00', '2026-12-10'), '2026-12-10'), seq, {
      action: 'move_out',
      movedOutOn: '2026-12-10',
      reason: 'Offered a council tenancy',
      destination: 'settled_home',
    })
    d = out.data
    const p = stateOf(d, seq, at('12:00', '2026-12-11'))
    expect(p).toMatchObject({ state: 'moved_out', checkedInOn: TODAY, movedOutOn: '2026-12-10' })
    expect(p.steps.map(x => `${x.from}→${x.to} ${x.actor.name}`)).toEqual([
      'held→provider_confirmed Sam Okafor',
      'provider_confirmed→offered Sam Okafor',
      'offered→accepted Sam Okafor',
      'accepted→checked_in Sam Okafor',
      'checked_in→moved_out Priya Raman',
    ])
    expect(out.record.snapshot).toMatchObject({ schema: 'placement-event/1', about: { seq }, caseRef: 'HN-26-0317', at: at('12:00', '2026-12-10') })
    expect(describeEvent(out.record.snapshot)).toBe('The household moved out on 10 Dec 2026. Reason: Offered a council tenancy. Went to: a settled home.')
    expect(await verifyChain(d.chain)).toEqual({ ok: true, checked: 6 })
  })

  it('a hold nobody confirms expires at its end and frees the property', async () => {
    let { d, s } = await search(await seed(at('09:00'), TODAY), officer, 'brief', 'S-1')
    d = (await cmdDecide(d, officer, s.id, accept(s.recommendedId!), review)).data
    const late = as('u-ta-1', at('10:00', '2026-11-03'), '2026-11-03')
    const e = (await refused(cmdTransition(d, late, 1, { action: 'confirm_provider', contactName: 'Mo', providerReference: 'NL-1' }))) as ValidationError
    expect(e.issues[0].message).toMatch(/^The hold ended at 10:00 on 3 Nov/)
    const again = await cmdSearch(d, late, { ...household('brief'), needFrom: '2026-11-03' }, { id: 'S-2', travel: estimateProvider })
    expect(again.result.recommendedId).toBe(s.recommendedId)
  })

  it('a refusal is recorded in the household’s words and goes to a manager', async () => {
    let { d, s } = await search(await seed(at('09:00'), TODAY), officer, 'brief', 'S-1')
    d = (await cmdDecide(d, officer, s.id, accept(s.recommendedId!), review)).data
    d = (await cmdTransition(d, officer, 1, { action: 'confirm_provider', contactName: 'Mo', providerReference: 'NL-1' })).data
    d = (await cmdTransition(d, officer, 1, { action: 'offer', method: 'in_person' })).data
    d = (await cmdTransition(d, officer, 1, { action: 'refuse', householdReason: 'Two buses to the school; the eldest has exams.' })).data
    expect(stateOf(d, 1, at('10:05')).state).toBe('refused')
    const t = tasks(d, at('10:05')).find(x => x.kind === 'refusal_review')!
    expect(t).toMatchObject({ owner: { kind: 'role', role: 'team_manager' }, detail: expect.stringMatching(/draws no conclusion/) })
  })

  it('cancelling before move-in frees the property; after move-in it must be a move-out', async () => {
    let { d, s } = await search(await seed(at('09:00'), TODAY), officer, 'brief', 'S-1')
    d = (await cmdDecide(d, officer, s.id, accept(s.recommendedId!), review)).data
    d = (await cmdTransition(d, officer, 1, { action: 'cancel', reason: 'The family found a place with relatives.' })).data
    expect(stateOf(d, 1, at('10:05')).state).toBe('cancelled')
    expect(await refused(cmdTransition(d, officer, 1, { action: 'cancel', reason: 'Again, by mistake here.' }))).toBeInstanceOf(ValidationError)
  })
})

describe('no double bookings', () => {
  it('a second search rules out the held property and says until when, without naming the other case', async () => {
    let { d, s } = await search(await seed(at('09:00'), TODAY), officer, 'brief', 'S-1')
    d = (await cmdDecide(d, officer, s.id, accept(s.recommendedId!), review)).data
    const { result } = await cmdSearch(d, officer2, { ...household('brief'), caseRef: 'HN-26-0999' }, { id: 'S-2', travel: estimateProvider })
    const c = result.candidates.find(x => x.propertyId === s.recommendedId)!
    expect(c.eligible).toBe(false)
    expect(c.blocks.map(b => `${b.code}: ${b.message}`)).toEqual(['ALREADY_BOOKED: Held for another case until 10:00 on 3 Nov'])
    expect(result.recommendedId).not.toBe(s.recommendedId)
  })
  it('recording a decision re-checks at that moment: a property taken since the search is refused', async () => {
    const base = await seed(at('09:00'), TODAY)
    // Two officers search for two families; both see the same flat as the recommendation.
    let { d, s: s1 } = await search(base, officer, 'brief', 'S-A')
    const r2 = await cmdSearch(d, officer2, { ...household('brief'), caseRef: 'HN-26-0999' }, { id: 'S-B', travel: estimateProvider })
    d = r2.data
    expect(r2.result.recommendedId).toBe(s1.recommendedId)
    // Officer 2 decides first.
    d = (await cmdDecide(d, as('u-ta-2', at('10:01')), 'S-B', accept(s1.recommendedId!), review)).data
    // Officer 1's search is a minute old: the store refuses, and says to search again.
    const e = await refused(cmdDecide(d, as('u-ta-1', at('10:02')), 'S-A', accept(s1.recommendedId!), review))
    expect(e).toBeInstanceOf(OccupancyConflictError)
    expect((e as Error).message).toMatch(/was taken after this search ran \(Held for another case until 10:01 on 3 Nov\)\. Run the search again/)
    expect(decisionRecords(d.chain)).toHaveLength(1)
  })
  it('an extension is refused when it runs into another booking, and allowed up to it', async () => {
    const short = { ...household('brief'), expectedNights: 30 }
    const first = await cmdSearch(await seed(at('09:00'), TODAY), officer, short, { id: 'S-1', travel: estimateProvider })
    const pid = first.result.recommendedId!
    let d = (await cmdDecide(first.data, officer, 'S-1', accept(pid), review)).data // 2 Nov to 2 Dec
    const later = { ...short, caseRef: 'HN-26-0998', needFrom: '2026-12-02' }
    const r = await cmdSearch(d, officer2, later, { id: 'S-2', travel: estimateProvider })
    expect(r.result.recommendedId).toBe(pid) // back-to-back: free from 2 Dec
    d = (await cmdDecide(r.data, officer2, 'S-2', accept(pid, { startDate: '2026-12-02' }), review)).data
    const e = (await refused(cmdExtendStay(d, officer, 1, { newEnd: '2026-12-09', reason: 'Move-on offer delayed by a week.' }))) as ValidationError
    expect(e.issues[0].message).toMatch(/not free for those dates: Held for another case until/)
    d = (await cmdExtendStay(d, officer, 1, { newEnd: '2026-11-30', reason: 'Settled home offered from 30 November.' })).data
    expect(stateOf(d, 1, at('10:30')).currentEnd).toBe('2026-11-30')
  })
})

describe('manager approval of exceptions, through the store', () => {
  async function override(ctx = officer) {
    const { d, s } = await search(await seed(at('09:00'), TODAY), ctx, 'brief', 'S-1')
    const other = s.candidates.find(c => c.eligible && c.propertyId !== s.recommendedId)!.propertyId
    const input = accept(other, {
      outcome: 'override',
      overrideReason: 'household_preference',
      reasonText: 'Household asked to stay near the grandmother who does childcare.',
    })
    return { other, ...(await cmdDecide(d, ctx, s.id, input, review)) }
  }
  it('an override is recorded as awaiting approval; the property is held; the next steps wait', async () => {
    const { data: d, record } = await override()
    expect(record.snapshot.terms).toMatchObject({ exceptions: ['not_recommended'], approvalRequired: true })
    expect(approvalOf(d.chain, record).status).toBe('awaiting')
    const e = (await refused(cmdTransition(d, officer, 1, { action: 'confirm_provider', contactName: 'Mo', providerReference: 'NL-1' }))) as ValidationError
    expect(e.issues[0].message).toMatch(/^Waiting for a manager to approve/)
    expect(tasks(d, at('10:05')).find(t => t.kind === 'approval')).toMatchObject({ owner: { kind: 'role', role: 'team_manager' }, status: 'open' })
  })
  it('the officer cannot approve; nobody approves their own decision; a manager can', async () => {
    const { data: d } = await override()
    expect(await refused(cmdDecideApproval(d, officer2, 1, { outcome: 'approved', reason: 'Looks fine to me.' }))).toBeInstanceOf(PermissionError)
    const own = await override(as('u-mgr-1'))
    expect(((await refused(cmdDecideApproval(own.data, manager, 1, { outcome: 'approved', reason: 'Approving my own.' }))) as Error).message).toBe(
      'Nobody can approve their own decision.',
    )
    expect(((await refused(cmdDecideApproval(d, manager, 1, { outcome: 'approved', reason: 'ok' }))) as ValidationError).issues.map(i => i.path)).toEqual([
      'ap-reason',
    ])
    const ok = await cmdDecideApproval(d, manager, 1, { outcome: 'approved', reason: 'The childcare reason outweighs the score gap.' })
    expect(ok.record.snapshot).toMatchObject({
      actor: { userId: 'u-mgr-1' },
      event: { type: 'approval', outcome: 'approved', exceptions: ['not_recommended'] },
    })
    expect(await refused(cmdDecideApproval(ok.data, as('u-hos-1'), 1, { outcome: 'rejected', reason: 'Second opinion here.' }))).toBeInstanceOf(ValidationError)
    const next = await cmdTransition(ok.data, officer, 1, { action: 'confirm_provider', contactName: 'Mo', providerReference: 'NL-1' })
    expect(stateOf(next.data, 1, at('11:05')).state).toBe('provider_confirmed')
    expect(tasks(ok.data, at('11:05')).find(t => t.kind === 'approval')).toMatchObject({ status: 'done', closedBy: 'Approved by Hannah Clarke, record #2' })
  })
  it('rejection is a chain event and releases the hold', async () => {
    const { data: d, other } = await override()
    const r = await cmdDecideApproval(d, manager, 1, { outcome: 'rejected', reason: 'The recommended flat suits the children better.' })
    expect(stateOf(r.data, 1, at('11:05')).state).toBe('cancelled')
    const again = await cmdSearch(r.data, officer, household('brief'), { id: 'S-2', travel: estimateProvider })
    expect(again.result.candidates.find(c => c.propertyId === other)!.eligible).toBe(true)
  })
  it('an approval task cannot be closed by "complete" or cancelled', async () => {
    const { data: d } = await override()
    expect(((await refused(cmdCompleteTask(d, manager, 'approval:1', { evidence: 'Spoke to the officer.', reference: 'CALL-1' }))) as Error).message).toMatch(
      /closes when a manager approves/,
    )
    expect(await refused(cmdCancelTask(d, manager, 'approval:1', { reason: 'Not needed any more.' }))).toBeInstanceOf(Error)
  })
  it('“no suitable option” is an exception too', async () => {
    const d0 = await seed(at('09:00'), TODAY)
    const tight = { ...household('dialysis'), maxHouseholdContributionWeekly: 0, flags: [] as never[] }
    const { data, result } = await cmdSearch({ ...d0, properties: d0.properties.filter(p => p.householdChargeWeekly > 0) }, officer, tight, {
      id: 'S-N',
      travel: estimateProvider,
    })
    expect(result.recommendedId).toBeNull()
    const dec = await cmdDecide(
      data,
      officer,
      'S-N',
      {
        outcome: 'no_suitable',
        chosenPropertyId: null,
        reasonText: 'Rang all six suppliers twice between 10:00 and 11:30.',
        startDate: TODAY,
        confirmedFullListReviewed: true,
      },
      review,
    )
    expect(dec.record.snapshot.terms).toEqual({ exceptions: ['no_suitable'], approvalRequired: true, placement: null })
    expect(tasks(dec.data, at('10:05')).find(t => t.kind === 'approval')!.due).toBe(at('17:00', '2026-11-02'))
  })
})

describe('emergency and B&B placements', () => {
  // Friday 6 Nov 2026, 23:40: a pregnant woman with nowhere to go; nothing self-contained is free.
  const FRI = '2026-11-06'
  const night = at('23:40', FRI)
  async function bnbSearch() {
    const d0 = await seed(at('09:00', FRI), FRI)
    const { data, result } = await cmdSearch(d0, ooh(night), SCENARIOS.find(s => s.id === 'outofhours')!.household(FRI), {
      id: 'S-OOH',
      travel: estimateProvider,
    })
    expect(result.candidates.find(c => c.propertyId === result.recommendedId)!.lastResort).toBe(true)
    return { d: data, s: result }
  }
  const plan = {
    emergency: { reasonCode: 'out_of_hours' as const, reasonText: 'Excluded by family at 23:00; no self-contained unit free tonight.' },
    moveOnPlan: { targetDate: '2026-12-04', route: 'self_contained_ta' as const, ownerUserId: 'u-ta-2' },
  }
  it('needs a coded reason, the officer’s words and a move-on plan with a named owner, within the limit', async () => {
    const { d, s } = await bnbSearch()
    const e = (await refused(cmdDecide(d, ooh(night), s.id, accept(s.recommendedId!, { startDate: FRI }), review))) as ValidationError
    expect(e.issues.map(i => i.path)).toEqual(['emergency-reasonCode', 'emergency-reasonText', 'moveon-targetDate', 'moveon-route', 'moveon-owner'])
    const late = { ...plan, moveOnPlan: { ...plan.moveOnPlan, targetDate: '2026-12-20', ownerUserId: 'u-aud-1' } }
    const e2 = (await refused(cmdDecide(d, ooh(night), s.id, accept(s.recommendedId!, { startDate: FRI, ...late }), review))) as ValidationError
    expect(e2.issues.map(i => i.message)).toEqual([
      'The move-on date must be no later than 18 Dec 2026, the end of the 6-week limit.',
      'Choose the named person who owns the move-on plan.',
    ])
  })
  it('is always an exception; out of hours it goes ahead with an urgent manager task due 10:00 the next working day', async () => {
    const { d: d0, s } = await bnbSearch()
    const dec = await cmdDecide(d0, ooh(night), s.id, accept(s.recommendedId!, { startDate: FRI, ...plan }), review)
    expect(dec.record.snapshot.terms).toMatchObject({
      exceptions: ['shared_family', 'beyond_bnb_limit'],
      approvalRequired: true,
      placement: {
        sixWeekRule: true,
        limitDays: 42,
        moveOnPlan: { owner: { userId: 'u-ta-2', name: 'Priya Raman' } },
        emergency: { reasonCode: 'out_of_hours' },
      },
    })
    let d = dec.data
    expect(((await refused(cmdPlaceOutOfHours(d, ooh(at('23:45', FRI)), 1, { reason: 'urgent' }))) as ValidationError).issues[0].path).toBe('ooh-reason')
    const def = await cmdPlaceOutOfHours(d, ooh(at('23:45', FRI)), 1, { reason: 'Pregnant, no one to stay with, no manager reachable at midnight.' })
    expect(def.record.snapshot.event).toMatchObject({ type: 'approval_deferred', approveBy: at('10:00', '2026-11-09'), duringWorkingHours: false })
    d = def.data
    const steps: Parameters<typeof cmdTransition>[3][] = [
      { action: 'confirm_provider', contactName: 'Night desk, Atlas', providerReference: 'AT-88812' },
      { action: 'offer', method: 'in_person' },
      { action: 'accept' },
      { action: 'check_in', checkedInOn: FRI },
    ]
    for (const input of steps) d = (await cmdTransition(d, ooh(at('23:50', FRI)), 1, input)).data
    expect(stateOf(d, 1, at('23:55', FRI)).state).toBe('checked_in')
    const t = tasks(d, at('09:00', '2026-11-07')).find(x => x.kind === 'approval')!
    expect(t).toMatchObject({ urgent: true, due: at('10:00', '2026-11-09'), status: 'open', title: expect.stringMatching(/^Placed out of hours/) })
    // Monday: the manager approves; the task closes.
    d = (
      await cmdDecideApproval(d, as('u-mgr-1', at('09:30', '2026-11-09')), 1, { outcome: 'approved', reason: 'Agreed: nothing else was available that night.' })
    ).data
    expect(tasks(d, at('09:31', '2026-11-09')).find(x => x.kind === 'approval')!.status).toBe('done')
  })
})

describe('tasks through the store', () => {
  async function placed() {
    let { d, s } = await search(await seed(at('09:00'), TODAY), officer, 'brief', 'S-1')
    d = (
      await cmdDecide(d, officer, s.id, accept(s.recommendedId!, { consent: { status: 'not_asked', reason: 'Parent too distressed to ask tonight.' } }), review)
    ).data
    return d
  }
  it('completion needs evidence and a reference, and is sealed with who and when', async () => {
    const d = await placed()
    expect(tasks(d, at('10:05')).find(t => t.id === 'consent:1')).toMatchObject({ status: 'open', owner: { userId: 'u-ta-1' } })
    expect(((await refused(cmdCompleteTask(d, officer, 'consent:1', { evidence: 'done' }))) as ValidationError).issues.map(i => i.path)).toEqual([
      'task-evidence',
      'task-reference',
    ])
    expect(await refused(cmdCompleteTask(d, officer2, 'consent:1', { evidence: 'Rang the mother, no answer.', reference: 'CALL-77' }))).toBeInstanceOf(
      PermissionError,
    )
    expect(await refused(cmdCompleteTask(d, auditor, 'consent:1', { evidence: 'Rang the mother, no answer.', reference: 'CALL-77' }))).toBeInstanceOf(
      PermissionError,
    )
    const ok = await cmdCompleteTask(d, officer, 'consent:1', { evidence: 'Mother says she will decide after talking to the school.', reference: 'CALL-77' })
    expect(ok.record.snapshot).toMatchObject({ about: { seq: 1 }, event: { type: 'task_completed', taskId: 'consent:1', reference: 'CALL-77' } })
    expect(tasks(ok.data, at('10:06')).find(t => t.id === 'consent:1')).toMatchObject({ status: 'done', completion: { actor: { name: 'Sam Okafor' } } })
    expect(await refused(cmdCompleteTask(ok.data, officer, 'consent:1', { evidence: 'Again, twice.', reference: 'CALL-78' }))).toBeInstanceOf(Error)
  })
  it('only a manager reassigns (with a note) or cancels (with a reason)', async () => {
    const d = await placed()
    const to = { kind: 'user' as const, userId: 'u-ta-2', name: 'Priya Raman', role: 'ta_officer' as const }
    expect(await refused(cmdReassignTask(d, officer, 'consent:1', { to, note: 'Please pick this up.' }))).toBeInstanceOf(PermissionError)
    expect(((await refused(cmdReassignTask(d, manager, 'consent:1', { to, note: '' }))) as ValidationError).issues.map(i => i.path)).toEqual(['task-note'])
    const auditorTo = { kind: 'user' as const, userId: 'u-aud-1', name: 'Ruth Benson', role: 'auditor' as const }
    expect(
      ((await refused(cmdReassignTask(d, manager, 'consent:1', { to: auditorTo, note: 'Have a look at this one.' }))) as ValidationError).issues[0].message,
    ).toBe('That person or queue cannot take tasks.')
    const r = await cmdReassignTask(d, manager, 'consent:1', { to, note: 'Sam is on leave; Priya knows the family.' })
    expect(tasks(r.data, at('11:05')).find(t => t.id === 'consent:1')!.owner).toEqual(to)
    expect(await refused(cmdCancelTask(r.data, officer2, 'consent:1', { reason: 'Not needed any more.' }))).toBeInstanceOf(PermissionError)
    const c = await cmdCancelTask(r.data, manager, 'consent:1', { reason: 'Household moved to another council area.' })
    expect(tasks(c.data, at('11:05')).find(t => t.id === 'consent:1')!.status).toBe('cancelled')
  })
  it('a supply task about a property is sealed against the property, not a case', async () => {
    const d = await seed(at('09:00'), TODAY)
    const cert = tasks(d, at('10:00')).find(t => t.kind === 'certificate' && !t.seq)!
    expect(await refused(cmdCompleteTask(d, officer, cert.id, { evidence: 'Booked the gas engineer.', reference: 'GS-1' }))).toBeInstanceOf(PermissionError)
    const ok = await cmdCompleteTask(d, as('u-sup-1'), cert.id, { evidence: 'New certificate received and filed.', reference: 'GS-2026-118' })
    expect(ok.record.snapshot).toMatchObject({ about: null, caseRef: null, propertyId: cert.propertyId })
    expect(ok.data.chain.filter(r => isPlacementEvent(r.snapshot))).toHaveLength(1)
  })
  it('records sealed by the demo seed say so', async () => {
    const { d, s } = await search(await seed(at('09:00'), TODAY), officer, 'brief', 'S-1')
    const r = await cmdDecide(d, { ...officer, seeded: true }, s.id, accept(s.recommendedId!), review)
    expect(r.record.snapshot.notes.at(-1)).toMatch(/^Seeded demo history: synthetic/)
  })
})
