import { describe, expect, it } from 'vitest'
import { DEFAULT_PLACEMENT_POLICY } from '../src/engine/policy'
import { foldApproval, foldPlacement, type Placement, type PlacementBase } from '../src/engine/placement'
import { deriveTasks, dueText, escalationOf, escalationTarget, isMine, kindOfTaskId, type CaseFacts, type Task, type TaskInput } from '../src/engine/tasks'
import { defaultRuleset } from '../src/data/ruleset'
import { seedProperties } from '../src/data/properties'
import type { ActorRef, EventFact, PlacementState, Property } from '../src/engine/types'

const officer: ActorRef = { userId: 'u-ta-1', name: 'Sam Okafor', role: 'ta_officer', roleLabel: 'Temporary accommodation officer' }
const policy = DEFAULT_PLACEMENT_POLICY
const rs = defaultRuleset('2026-11-02T09:00:00.000Z')

// A family in B&B: moved in on Monday 2 Nov 2026. Day 7 is 9 Nov, day 28 is 30 Nov, day 35 is 7 Dec, day 42 is 14 Dec.
const bnb: PlacementBase = {
  seq: 3,
  caseRef: 'HN-BNB',
  propertyId: 'P04',
  propertyLabel: 'Atlas Lodge, room 3',
  startDate: '2026-11-02',
  plannedEnd: '2026-12-14',
  decidedAt: '2026-11-01T23:40:00.000Z',
  decidedBy: { userId: 'u-ooh-1', name: 'Dele Adeyemi', role: 'ooh_officer' },
  decidedByName: 'Dele Adeyemi',
  holdUntil: '2026-11-02T23:40:00.000Z',
  sixWeekRule: true,
  limitDays: 42,
  exceptions: ['shared_family'],
  approvalRequired: true,
  emergency: { reasonCode: 'out_of_hours', reasonText: 'Family excluded at 23:00; nothing self-contained tonight.' },
  moveOnPlan: { targetDate: '2026-12-07', route: 'self_contained_ta', owner: { userId: 'u-ta-2', name: 'Priya Raman', role: 'ta_officer' } },
  legacy: false,
}
let seq = 100
const fact = (body: EventFact['body'], at: string, actor = officer): EventFact => ({ seq: seq++, at, actor, body })
const movedIn = (now: string, state: PlacementState = 'checked_in'): Placement => ({
  ...foldPlacement(bnb, [], now),
  state,
  checkedInOn: '2026-11-02',
  approval: foldApproval(bnb, [
    fact({ type: 'approval', outcome: 'approved', exceptions: ['shared_family'], reason: 'Agreed as a last resort.' }, '2026-11-02T10:00:00.000Z'),
  ]),
})
const caseOf = (p: Placement, over: Partial<CaseFacts> = {}): CaseFacts => ({
  seq: p.seq,
  caseRef: p.caseRef,
  decidedAt: p.decidedAt,
  decider: { kind: 'user', ...p.decidedBy! },
  outcome: 'accepted',
  placement: p,
  approval: p.approval,
  clocks: [],
  consent: { atDecision: 'not_applicable', now: 'not_applicable' },
  policy,
  ...over,
})
const input = (now: string, cases: CaseFacts[], events: EventFact[] = [], properties: Property[] = []): TaskInput => ({
  now,
  cases,
  properties,
  ruleset: rs,
  policy,
  events,
})
const ladder = (now: string, state: PlacementState = 'checked_in') => deriveTasks(input(now, [caseOf(movedIn(now, state))])).filter(t => t.id.startsWith('bnb'))
const brief = (ts: Task[]) => ts.map(t => `${t.id} ${t.status}/${t.escalation}`)

describe('the six-week ladder, at fixed times', () => {
  it('day 0: nothing yet; the week 1 review opens a week ahead', () => {
    expect(brief(ladder('2026-11-02T12:00:00.000Z'))).toEqual(['bnb-review:3:1 open/none'])
  })
  it('day 6: week 1 review due soon, owned by the move-on plan’s named owner', () => {
    const [t] = ladder('2026-11-08T18:00:00.000Z')
    expect(t).toMatchObject({ id: 'bnb-review:3:1', escalation: 'due_soon', owner: { kind: 'user', userId: 'u-ta-2' }, due: '2026-11-09T17:00:00.000Z' })
  })
  it('day 21: the day-28 manager step opens; reviews keep coming weekly', () => {
    expect(brief(ladder('2026-11-23T12:00:00.000Z'))).toEqual([
      'bnb-review:3:1 open/escalated',
      'bnb-review:3:2 open/escalated',
      'bnb-review:3:3 open/due_soon',
      'bnb-manager:3 open/none',
      'bnb-review:3:4 open/none',
    ])
  })
  it('day 30: the manager step is overdue and escalated to the head of service', () => {
    const t = ladder('2026-12-02T18:00:00.000Z').find(x => x.kind === 'bnb_manager')!
    expect(t).toMatchObject({ owner: { kind: 'role', role: 'team_manager' }, escalation: 'escalated', escalatedTo: 'head_of_service' })
    expect(t.title).toMatch(/^Day 28 in shared accommodation/)
  })
  it('day 35: urgent, one week left', () => {
    const t = ladder('2026-12-07T12:00:00.000Z').find(x => x.kind === 'bnb_urgent')!
    expect(t).toMatchObject({ urgent: true, escalation: 'due_soon', title: expect.stringMatching(/^Urgent: 7 days left/) })
  })
  it('day 42: limit reached, the head of service owns it; day 43 records the breach', () => {
    const t42 = ladder('2026-12-14T12:00:00.000Z').find(x => x.kind === 'bnb_limit')!
    expect(t42).toMatchObject({ owner: { kind: 'role', role: 'head_of_service' }, urgent: true, detail: '42 of 42 days used.' })
    const t43 = ladder('2026-12-15T12:00:00.000Z').find(x => x.kind === 'bnb_limit')!
    expect(t43.detail).toMatch(/^Over the limit: 43 days used of 42/)
    expect(t43.escalation).toBe('overdue')
    expect(escalationTarget(t43.owner)).toBeUndefined()
  })
  it('the ladder stops when the family moves out', () => {
    expect(ladder('2026-12-02T12:00:00.000Z', 'moved_out')).toEqual([])
  })
  it('the ladder runs from the planned start before move-in is recorded, so an unrecorded move-in cannot hide it', () => {
    const p = { ...movedIn('2026-11-30T12:00:00.000Z', 'accepted'), checkedInOn: undefined }
    expect(deriveTasks(input('2026-11-30T12:00:00.000Z', [caseOf(p)])).some(t => t.kind === 'bnb_manager')).toBe(true)
  })
})

describe('escalation', () => {
  const due = '2026-11-10T17:00:00.000Z'
  it('none → due soon → overdue → escalated after the policy days', () => {
    expect(escalationOf(due, '2026-11-09T16:59:00.000Z', policy)).toBe('none')
    expect(escalationOf(due, '2026-11-09T17:00:00.000Z', policy)).toBe('due_soon')
    expect(escalationOf(due, '2026-11-10T17:00:00.000Z', policy)).toBe('overdue')
    expect(escalationOf(due, '2026-11-12T17:00:00.000Z', policy)).toBe('escalated')
  })
  it('an escalated task shows as mine to the manager it is raised to', () => {
    const t = ladder('2026-11-23T12:00:00.000Z')[0]
    expect(t.escalatedTo).toBe('team_manager')
    expect(isMine(t, { id: 'u-mgr-1', role: 'team_manager' })).toBe(true)
    expect(isMine(t, { id: 'u-ta-1', role: 'ta_officer' })).toBe(false)
    expect(isMine(t, { id: 'u-ta-2', role: 'ta_officer' })).toBe(true)
  })
  it('due text in plain words', () => {
    const t = { due, status: 'open' } as Task
    expect(dueText(t, '2026-11-08T17:00:00.000Z')).toBe('due in 2 days')
    expect(dueText(t, '2026-11-10T12:00:00.000Z')).toBe('due in 5 h')
    expect(dueText(t, '2026-11-12T18:00:00.000Z')).toBe('2 days overdue')
  })
})

describe('tasks are derived and idempotent', () => {
  const now = '2026-11-23T12:00:00.000Z'
  it('the same inputs give the same tasks, in the same order', () => {
    const facts = caseOf(movedIn(now))
    const a = deriveTasks(input(now, [facts], [], seedProperties('2026-11-02', '2026-11-02T09:00:00.000Z')))
    const b = deriveTasks(input(now, [structuredClone(facts)], [], seedProperties('2026-11-02', '2026-11-02T09:00:00.000Z')))
    expect(b).toEqual(a)
    expect(new Set(a.map(t => t.id)).size).toBe(a.length)
  })
  it('completion, reassignment and cancellation are sealed facts that the list folds in', () => {
    const events = [
      fact(
        { type: 'task_completed', taskId: 'bnb-review:3:1', title: 'Week 1', evidence: 'Rang three PSL landlords.', reference: 'CALL-1' },
        '2026-11-09T11:00:00.000Z',
      ),
      fact(
        {
          type: 'task_reassigned',
          taskId: 'bnb-review:3:2',
          title: 'Week 2',
          from: { kind: 'user', userId: 'u-ta-2', name: 'Priya Raman', role: 'ta_officer' },
          to: { kind: 'user', userId: 'u-ta-1', name: 'Sam Okafor', role: 'ta_officer' },
          note: 'Priya on leave this week.',
        },
        '2026-11-12T09:00:00.000Z',
      ),
      fact({ type: 'task_cancelled', taskId: 'bnb-review:3:3', title: 'Week 3', reason: 'Combined with the week 4 review.' }, '2026-11-20T09:00:00.000Z'),
    ]
    const ts = deriveTasks(input(now, [caseOf(movedIn(now))], events))
    const [w1, w2, w3] = ['bnb-review:3:1', 'bnb-review:3:2', 'bnb-review:3:3'].map(id => ts.find(t => t.id === id)!)
    expect(w1).toMatchObject({ status: 'done', escalation: 'none', completion: { evidence: 'Rang three PSL landlords.', reference: 'CALL-1' } })
    expect(w2).toMatchObject({ status: 'open', owner: { userId: 'u-ta-1' }, reassignments: [{ note: 'Priya on leave this week.' }] })
    expect(w3).toMatchObject({ status: 'cancelled', cancellation: { reason: 'Combined with the week 4 review.' } })
  })
  it('a completed task stays on the list after its trigger has gone', () => {
    const events = [
      fact(
        { type: 'task_completed', taskId: 'bnb-review:3:1', title: 'Week 1 review', evidence: 'Rang landlords.', reference: 'C1' },
        '2026-11-09T11:00:00.000Z',
      ),
    ]
    const ts = deriveTasks(input('2026-12-20T12:00:00.000Z', [caseOf(movedIn('2026-12-20T12:00:00.000Z', 'moved_out'))], events))
    expect(ts.map(t => `${t.id} ${t.status}`)).toEqual(['approval:3 done', 'bnb-review:3:1 done'])
    expect(ts[1].kind).toBe('bnb_review')
    expect(kindOfTaskId('cert:P05:gas_safety:2026-10-01')).toBe('certificate')
  })
})

describe('where tasks come from', () => {
  const now = '2026-11-02T12:00:00.000Z'
  const ordinary = (state: PlacementState, over: Partial<PlacementBase> = {}): Placement => ({
    ...foldPlacement({ ...bnb, sixWeekRule: false, exceptions: [], approvalRequired: false, emergency: undefined, moveOnPlan: undefined, ...over }, [], now),
    state,
  })
  it('approval waiting: the managers’ queue, due when the hold ends, closed only by approving', () => {
    const p = foldPlacement({ ...bnb, decidedAt: '2026-11-02T09:00:00.000Z', holdUntil: '2026-11-03T09:00:00.000Z' }, [], now)
    const t = deriveTasks(input(now, [caseOf(p)])).find(x => x.kind === 'approval')!
    expect(t).toMatchObject({ owner: { kind: 'role', role: 'team_manager' }, due: '2026-11-03T09:00:00.000Z', closesBy: 'approval', urgent: false })
  })
  it('out of hours: urgent, due 10:00 the next working day', () => {
    const deferredAt = '2026-11-06T23:30:00.000Z' // a Friday night
    const ev = fact(
      {
        type: 'approval_deferred',
        exceptions: ['shared_family'],
        reason: 'Family at the door.',
        approveBy: '2026-11-09T10:00:00.000Z',
        duringWorkingHours: false,
      },
      deferredAt,
    )
    const p = foldPlacement({ ...bnb, holdUntil: '2026-11-07T23:30:00.000Z' }, [ev], deferredAt)
    const t = deriveTasks(input(deferredAt, [caseOf(p)])).find(x => x.kind === 'approval')!
    expect(t).toMatchObject({ urgent: true, due: '2026-11-09T10:00:00.000Z', title: expect.stringMatching(/^Placed out of hours/) })
  })
  it('a hold about to end: a task for the deciding officer in the last hours', () => {
    const p = ordinary('held', { holdUntil: '2026-11-02T15:00:00.000Z' })
    expect(deriveTasks(input(now, [caseOf(p)])).find(t => t.kind === 'hold')).toMatchObject({ owner: { userId: 'u-ooh-1' }, due: '2026-11-02T15:00:00.000Z' })
    expect(deriveTasks(input(now, [caseOf(ordinary('held', { holdUntil: '2026-11-03T15:00:00.000Z' }))])).some(t => t.kind === 'hold')).toBe(false)
  })
  it('a refusal goes to a manager for review, and the task says the product draws no conclusion', () => {
    const p = { ...ordinary('refused'), refusal: { seq: 9, at: now, actor: officer, reason: 'Too far from school.' } }
    const t = deriveTasks(input(now, [caseOf(p)])).find(x => x.kind === 'refusal_review')!
    expect(t).toMatchObject({ owner: { kind: 'role', role: 'team_manager' }, due: '2026-11-02T17:00:00.000Z' })
    expect(t.detail).toMatch(/draws no conclusion/)
  })
  it('statutory notices and the consent follow-up, for the deciding officer', () => {
    const clocks = [
      { key: 's208', label: 'Notify Redbridge of the placement', due: '2026-11-16', basis: 's208', status: 'open' as const },
      { key: 's213aa', label: 'Notify school', due: '2026-11-16', basis: 's213AA', status: 'open' as const },
      { key: 's202', label: 'Review window', due: '2026-11-23', basis: 's202', status: 'open' as const },
    ]
    const notAsked = deriveTasks(input(now, [caseOf(ordinary('checked_in'), { clocks, consent: { atDecision: 'not_asked', now: 'not_asked' } })]))
    expect(notAsked.map(t => t.id)).toEqual(['consent:3', 's208:3'])
    expect(notAsked[0].due).toBe('2026-11-09T17:00:00.000Z')
    const given = deriveTasks(input(now, [caseOf(ordinary('checked_in'), { clocks, consent: { atDecision: 'not_asked', now: 'given', recordedSeq: 12 } })]))
    expect(brief(given)).toEqual(['consent:3 done/none', 's208:3 open/none', 's213aa:3 open/none'])
    expect(given[0].closedBy).toBe('Consent recorded, record #12')
  })
  it('no notices for a cancelled, refused or expired placement', () => {
    const clocks = [{ key: 's208', label: 'Notify', due: '2026-11-16', basis: 's208', status: 'open' as const }]
    for (const s of ['cancelled', 'hold_expired'] as PlacementState[]) expect(deriveTasks(input(now, [caseOf(ordinary(s), { clocks })]))).toEqual([])
  })
  it('the stay ending soon: arrange the move or extend', () => {
    const p = ordinary('checked_in', { plannedEnd: '2026-11-12' })
    expect(deriveTasks(input(now, [caseOf(p)])).map(t => t.id)).toEqual(['stay-end:3:2026-11-12'])
  })
  it('certificates expiring within 60 days on any property go to supply and compliance; during a live placement they are urgent', () => {
    const props = seedProperties('2026-11-02', '2026-11-02T09:00:00.000Z')
    const certs = deriveTasks(input(now, [], [], props)).filter(t => t.kind === 'certificate')
    expect(certs.length).toBeGreaterThan(0)
    expect(certs.every(t => t.owner.kind === 'role' && t.owner.role === 'compliance_officer')).toBe(true)
    const expired = certs.find(t => t.propertyId === 'P05')!
    expect(expired.title).toMatch(/^Expired: gas safety certificate for Larkspur Mews 3/)
    const target = certs[0]
    const live = ordinary('checked_in', { propertyId: target.propertyId!, plannedEnd: '2027-06-01' })
    const withLive = deriveTasks(input(now, [caseOf(live)], [], props)).find(t => t.id === target.id)!
    expect(withLive).toMatchObject({ urgent: true, seq: 3, caseRef: 'HN-BNB' })
  })
})
