import { describe, expect, it } from 'vitest'
import { inWorkingHours, isWorkingDay, nextWorkingDayAt, ukDate, ukTimeToIso } from '../src/engine/dates'
import {
  ALLOWED_FROM,
  approvalBlock,
  foldApproval,
  foldPlacement,
  nextActions,
  sharedStayDay,
  TARGET,
  transitionDetails,
  validateApproval,
  validateDeferral,
  validateExtension,
  validateTransition,
  type Placement,
  type PlacementBase,
  type TransitionInput,
} from '../src/engine/placement'
import type { ActorRef, EventFact, PlacementAction, PlacementState } from '../src/engine/types'

const officer: ActorRef = { userId: 'u-ta-1', name: 'Sam Okafor', role: 'ta_officer', roleLabel: 'Temporary accommodation officer' }
const manager: ActorRef = { userId: 'u-mgr-1', name: 'Hannah Clarke', role: 'team_manager', roleLabel: 'Team manager' }
const DECIDED = '2026-11-02T10:00:00.000Z'
const NOW = '2026-11-02T12:00:00.000Z'

const base = (over: Partial<PlacementBase> = {}): PlacementBase => ({
  seq: 1,
  caseRef: 'HN-TEST',
  propertyId: 'P01',
  propertyLabel: 'Cedar Court 4',
  startDate: '2026-11-02',
  plannedEnd: '2026-12-02',
  decidedAt: DECIDED,
  decidedBy: { userId: officer.userId, name: officer.name, role: officer.role },
  decidedByName: officer.name,
  holdUntil: '2026-11-03T10:00:00.000Z',
  sixWeekRule: false,
  limitDays: 42,
  exceptions: [],
  approvalRequired: false,
  legacy: false,
  ...over,
})
const pl = (state: PlacementState, over: Partial<PlacementBase> = {}): Placement => ({
  ...foldPlacement(base(over), [], NOW),
  state,
  ...(state === 'checked_in' || state === 'moved_out' ? { checkedInOn: '2026-11-02' } : {}),
})
let seq = 10
const ev = (body: EventFact['body'], at = NOW, actor = officer): EventFact => ({ seq: seq++, at, actor, body })
const step = (from: PlacementState, details: Parameters<typeof transitionDetails>[0]): EventFact =>
  ev({ type: 'placement_transition', placementId: 'PL-1', from, to: TARGET[details.action], details: transitionDetails(details) })

/** A complete, valid input for each step. */
const VALID: Record<PlacementAction, TransitionInput> = {
  confirm_provider: { action: 'confirm_provider', contactName: 'Mo at Northside', providerReference: 'NL-4471' },
  offer: { action: 'offer', method: 'phone' },
  accept: { action: 'accept' },
  refuse: { action: 'refuse', householdReason: 'Too far from the children’s school.' },
  check_in: { action: 'check_in', checkedInOn: '2026-11-02' },
  move_out: { action: 'move_out', movedOutOn: '2026-11-02', reason: 'Offered a council tenancy', destination: 'settled_home' },
  cancel: { action: 'cancel', reason: 'Household found a place with family.' },
}
const STATES: PlacementState[] = ['held', 'provider_confirmed', 'offered', 'accepted', 'checked_in', 'moved_out', 'refused', 'cancelled', 'hold_expired']
const ACTIONS = Object.keys(ALLOWED_FROM) as PlacementAction[]

describe('UK time and working days', () => {
  it('weekends are not working days (bank holidays are not in the demo)', () => {
    expect(['2026-11-16', '2026-11-20'].map(isWorkingDay)).toEqual([true, true])
    expect(['2026-11-21', '2026-11-22'].map(isWorkingDay)).toEqual([false, false])
  })
  it('turns UK wall-clock time into an instant, with summer time', () => {
    expect(ukTimeToIso('2026-11-17', '10:00')).toBe('2026-11-17T10:00:00.000Z')
    expect(ukTimeToIso('2026-07-01', '10:00')).toBe('2026-07-01T09:00:00.000Z')
    expect(ukDate('2026-07-01T23:30:00.000Z')).toBe('2026-07-02')
  })
  it('next working day at 10:00', () => {
    expect(nextWorkingDayAt('2026-11-17T02:00:00.000Z', '10:00')).toBe('2026-11-17T10:00:00.000Z') // Tue 02:00 → Tue 10:00
    expect(nextWorkingDayAt('2026-11-17T14:00:00.000Z', '10:00')).toBe('2026-11-18T10:00:00.000Z') // Tue 14:00 → Wed
    expect(nextWorkingDayAt('2026-11-20T23:00:00.000Z', '10:00')).toBe('2026-11-23T10:00:00.000Z') // Fri night → Mon
    expect(nextWorkingDayAt('2026-11-21T12:00:00.000Z', '10:00')).toBe('2026-11-23T10:00:00.000Z') // Sat → Mon
    expect(nextWorkingDayAt('2026-07-03T22:00:00.000Z', '10:00')).toBe('2026-07-06T09:00:00.000Z') // summer time
  })
  it('working hours are 09:00 to 17:00 UK on a working day', () => {
    expect(inWorkingHours('2026-11-17T09:00:00.000Z')).toBe(true)
    expect(inWorkingHours('2026-11-17T17:00:00.000Z')).toBe(false)
    expect(inWorkingHours('2026-11-21T11:00:00.000Z')).toBe(false)
  })
})

describe('the full transition table', () => {
  for (const state of STATES)
    for (const action of ACTIONS) {
      const allowed = ALLOWED_FROM[action].includes(state)
      it(`${state} ${allowed ? '→' : '✕'} ${action}`, () => {
        const issues = validateTransition(pl(state), VALID[action], NOW)
        if (allowed) expect(issues).toEqual([])
        else expect(issues.map(i => i.path)).toEqual(['pl-action'])
      })
    }
  it('next actions follow the table', () => {
    expect(nextActions(pl('held'))).toEqual(['confirm_provider', 'cancel'])
    expect(nextActions(pl('offered'))).toEqual(['accept', 'refuse', 'cancel'])
    expect(nextActions(pl('checked_in'))).toEqual(['move_out'])
    for (const s of ['moved_out', 'refused', 'cancelled', 'hold_expired'] as PlacementState[]) expect(nextActions(pl(s))).toEqual([])
  })
  it('cannot cancel after the household has moved in: that is a move-out', () => {
    expect(ALLOWED_FROM.cancel).not.toContain('checked_in')
  })
})

describe('what each step needs', () => {
  const paths = (state: PlacementState, input: TransitionInput, now = NOW) => validateTransition(pl(state), input, now).map(i => i.path)
  it('provider confirmation needs the contact’s name and a reference', () => {
    expect(paths('held', { action: 'confirm_provider' })).toEqual(['pl-contactName', 'pl-providerReference'])
    expect(paths('held', { action: 'confirm_provider', contactName: ' ', providerReference: 'ab' })).toEqual(['pl-contactName', 'pl-providerReference'])
  })
  it('an offer records how it was made', () => {
    expect(paths('provider_confirmed', { action: 'offer' })).toEqual(['pl-method'])
    expect(paths('provider_confirmed', { action: 'offer', method: 'carrier pigeon' })).toEqual(['pl-method'])
  })
  it('a refusal needs the household’s reason', () => {
    expect(paths('offered', { action: 'refuse', householdReason: 'no' })).toEqual(['pl-householdReason'])
  })
  it('move-in needs a real date, not in the future and not before the decision', () => {
    expect(paths('accepted', { action: 'check_in' })).toEqual(['pl-checkedInOn'])
    expect(paths('accepted', { action: 'check_in', checkedInOn: '2026-11-03' })).toEqual(['pl-checkedInOn'])
    expect(paths('accepted', { action: 'check_in', checkedInOn: '2026-11-01' })).toEqual(['pl-checkedInOn'])
  })
  it('move-out needs the date, the reason and where they went (and words for "other")', () => {
    expect(paths('checked_in', { action: 'move_out' })).toEqual(['pl-movedOutOn', 'pl-moveReason', 'pl-destination'])
    expect(paths('checked_in', { action: 'move_out', movedOutOn: '2026-11-01', reason: 'Moved on', destination: 'other' })).toEqual([
      'pl-movedOutOn',
      'pl-destinationNote',
    ])
  })
  it('cancelling needs a reason', () => {
    expect(paths('accepted', { action: 'cancel', reason: 'short' })).toEqual(['pl-cancelReason'])
  })
  it('the sealed details are trimmed and keep optional notes only when given', () => {
    expect(transitionDetails({ action: 'offer', method: 'written', note: '  ' })).toEqual({ action: 'offer', method: 'written' })
    expect(transitionDetails({ action: 'confirm_provider', contactName: ' Mo ', providerReference: ' R1 ' })).toEqual({
      action: 'confirm_provider',
      contactName: 'Mo',
      providerReference: 'R1',
    })
  })
})

describe('holds expire from the time passed in', () => {
  it('held until the hold ends, then expired; nothing is written', () => {
    expect(foldPlacement(base(), [], '2026-11-03T09:59:59.000Z').state).toBe('held')
    expect(foldPlacement(base(), [], '2026-11-03T10:00:00.000Z').state).toBe('hold_expired')
  })
  it('a confirmed hold does not expire', () => {
    const p = foldPlacement(base(), [step('held', VALID.confirm_provider)], '2026-11-09T10:00:00.000Z')
    expect(p.state).toBe('provider_confirmed')
  })
  it('an expired hold cannot be confirmed, and says why', () => {
    const p = foldPlacement(base(), [], '2026-11-04T10:00:00.000Z')
    expect(validateTransition(p, VALID.confirm_provider, '2026-11-04T10:00:00.000Z')[0].message).toMatch(/The hold ended at 10:00 on 3 Nov/)
  })
})

describe('approval gates the placement', () => {
  const needs = { exceptions: ['not_recommended' as const], approvalRequired: true }
  it('provider confirmation, offer and move-in wait for approval', () => {
    for (const [state, action] of [
      ['held', 'confirm_provider'],
      ['provider_confirmed', 'offer'],
      ['accepted', 'check_in'],
    ] as [PlacementState, PlacementAction][]) {
      const p = pl(state, needs)
      expect(approvalBlock(p, action)).toMatch(/Waiting for a manager/)
      expect(validateTransition(p, VALID[action], NOW).map(i => i.path)).toEqual(['pl-action'])
    }
    expect(approvalBlock(pl('held', needs), 'cancel')).toBeNull()
  })
  it('approved, or placed out of hours, unblocks; rejected does not', () => {
    const approved = foldPlacement(
      base(needs),
      [ev({ type: 'approval', outcome: 'approved', exceptions: needs.exceptions, reason: 'Household preference is sound.' })],
      NOW,
    )
    expect(validateTransition(approved, VALID.confirm_provider, NOW)).toEqual([])
    const ooh = foldPlacement(
      base(needs),
      [ev({ type: 'approval_deferred', exceptions: needs.exceptions, reason: 'Family at the door at 02:00.', approveBy: NOW, duringWorkingHours: false })],
      NOW,
    )
    expect(ooh.approval.status).toBe('out_of_hours')
    expect(validateTransition(ooh, VALID.confirm_provider, NOW)).toEqual([])
  })
  it('a rejection releases the hold before move-in', () => {
    const p = foldPlacement(
      base(needs),
      [ev({ type: 'approval', outcome: 'rejected', exceptions: needs.exceptions, reason: 'Recommendation was suitable.' }, NOW, manager)],
      NOW,
    )
    expect(p.state).toBe('cancelled')
    expect(p.cancellation).toMatchObject({ byRejection: true, reason: 'Exception rejected by Hannah Clarke: Recommendation was suitable.' })
  })
  it('a rejection after an out-of-hours move-in leaves the family where they are', () => {
    const p = foldPlacement(
      base(needs),
      [
        ev({ type: 'approval_deferred', exceptions: needs.exceptions, reason: 'Family at the door at 02:00.', approveBy: NOW, duringWorkingHours: false }),
        step('held', VALID.confirm_provider),
        step('provider_confirmed', VALID.offer),
        step('offered', VALID.accept),
        step('accepted', VALID.check_in),
        ev({ type: 'approval', outcome: 'rejected', exceptions: needs.exceptions, reason: 'Not an emergency.' }, NOW, manager),
      ],
      NOW,
    )
    expect(p.state).toBe('checked_in')
    expect(p.approval.status).toBe('rejected')
  })
  it('approval and deferral rules', () => {
    const awaiting = foldApproval(needs, [])
    expect(validateApproval(awaiting, {}).map(i => i.path)).toEqual(['ap-outcome', 'ap-reason'])
    expect(validateApproval(awaiting, { outcome: 'approved', reason: 'Agreed: the reasons hold.' })).toEqual([])
    expect(validateApproval(foldApproval({ exceptions: [], approvalRequired: false }, []), { outcome: 'approved', reason: 'x'.repeat(20) })[0].message).toBe(
      'This decision does not need approval.',
    )
    expect(validateDeferral(awaiting, pl('held', needs), { reason: 'short' }).map(i => i.path)).toEqual(['ooh-reason'])
    expect(validateDeferral(awaiting, pl('held', needs), { reason: 'Family at the door at 02:00, no manager on call.' })).toEqual([])
    expect(validateDeferral(awaiting, pl('hold_expired', needs), { reason: 'Family at the door at 02:00, no manager on call.' })[0].message).toMatch(
      /Only a live placement/,
    )
  })
})

describe('extending a stay', () => {
  it('needs a new date after the start, a reason, and no clash', () => {
    const p = pl('checked_in')
    expect(validateExtension(p, { newEnd: '2027-01-10', reason: 'Move-on offer delayed by the landlord.' }, [])).toEqual([])
    expect(validateExtension(p, { newEnd: '2026-11-01', reason: 'x' }, []).map(i => i.path)).toEqual(['ext-newEnd', 'ext-reason'])
    expect(
      validateExtension(p, { newEnd: '2027-01-10', reason: 'Move-on offer delayed.' }, [{ message: 'Held for another case until 10:00 on 4 Dec' }])[0].message,
    ).toMatch(/not free for those dates: Held for another case/)
    expect(validateExtension(pl('moved_out'), { newEnd: '2027-01-10', reason: 'Move-on offer delayed.' }, [])[0].message).toMatch(/cannot be extended/)
  })
  it('an extension changes the planned end', () => {
    const p = foldPlacement(
      base(),
      [ev({ type: 'stay_extended', placementId: 'PL-1', previousEnd: '2026-12-02', newEnd: '2027-01-10', reason: 'Delay.' })],
      NOW,
    )
    expect(p.currentEnd).toBe('2027-01-10')
  })
})

describe('day counter for shared accommodation', () => {
  it('counts from move-in (or the planned start) and flags the breach after the limit', () => {
    const p = pl('checked_in', { sixWeekRule: true })
    expect(sharedStayDay(p, '2026-11-30T12:00:00.000Z')).toEqual({ day: 28, limit: 42, ended: false, breached: false })
    expect(sharedStayDay(p, '2026-12-14T12:00:00.000Z')).toMatchObject({ day: 42, breached: false })
    expect(sharedStayDay(p, '2026-12-15T12:00:00.000Z')).toMatchObject({ day: 43, breached: true })
    expect(sharedStayDay(pl('checked_in'), NOW)).toBeNull()
    expect(sharedStayDay(pl('cancelled', { sixWeekRule: true }), NOW)).toBeNull()
  })
})
