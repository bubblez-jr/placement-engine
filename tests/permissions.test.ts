import { describe, expect, it } from 'vitest'
import { ACTIONS, assertCan, can, check, PermissionError, ROLES, type Action } from '../src/engine/permissions'
import { STAFF } from '../src/data/staff'
import type { StaffRole } from '../src/engine/types'

// The full role × action matrix, written out by hand so a change to the
// grants has to be a deliberate change to this table as well.
const Y = true
const N = false
//                          officer ooh   mgr   head  supply audit admin
const MATRIX: Record<Action, [boolean, boolean, boolean, boolean, boolean, boolean, boolean]> = {
  run_search: /*           */ [Y, Y, Y, Y, N, N, N],
  record_decision: /*      */ [Y, Y, Y, Y, N, N, N],
  record_consent: /*       */ [Y, Y, Y, Y, N, N, N],
  approve_exception: /*    */ [N, N, Y, Y, N, N, N],
  publish_policy: /*       */ [N, N, N, Y, N, N, Y],
  edit_properties: /*      */ [N, N, N, N, Y, N, Y],
  confirm_availability: /* */ [Y, Y, Y, Y, Y, N, Y],
  act_on_placement: /*     */ [Y, Y, Y, Y, N, N, N],
  complete_task: /*        */ [Y, Y, Y, Y, Y, N, N],
  reassign_task: /*        */ [N, N, Y, Y, N, N, Y],
  view_audit_log: /*       */ [Y, Y, Y, Y, Y, Y, Y],
  run_tamper_demo: /*      */ [Y, Y, Y, Y, Y, N, Y],
  reset_demo: /*           */ [N, N, N, N, N, N, Y],
  import_household: /*     */ [Y, Y, Y, Y, N, N, Y],
  export_records: /*       */ [Y, Y, Y, Y, Y, Y, Y],
}
const ORDER: StaffRole[] = ['ta_officer', 'ooh_officer', 'team_manager', 'head_of_service', 'compliance_officer', 'auditor', 'admin']

describe('permission matrix', () => {
  it('covers every role and every action', () => {
    expect([...ROLES].sort()).toEqual([...ORDER].sort())
    expect(Object.keys(MATRIX).sort()).toEqual([...ACTIONS].sort())
  })
  for (const action of ACTIONS) {
    ORDER.forEach((role, i) => {
      it(`${role} ${MATRIX[action][i] ? 'may' : 'may not'} ${action}`, () => {
        expect(can({ id: `u-${role}`, role }, action)).toBe(MATRIX[action][i])
      })
    })
  }
  it('the auditor changes nothing: only reading and exporting', () => {
    expect(ACTIONS.filter(a => can({ id: 'u', role: 'auditor' }, a)).sort()).toEqual(['export_records', 'view_audit_log'])
  })
  it('only the head of service and admin publish policy', () => {
    expect(ORDER.filter(r => can({ id: 'u', role: r }, 'publish_policy'))).toEqual(['head_of_service', 'admin'])
  })
})

describe('context rules', () => {
  it('nobody approves their own decision', () => {
    const mgr = { id: 'u-mgr-1', role: 'team_manager' as const }
    expect(can(mgr, 'approve_exception', { decidedByUserId: 'u-ta-1' })).toBe(true)
    const r = check(mgr, 'approve_exception', { decidedByUserId: 'u-mgr-1' })
    expect(r).toEqual({ ok: false, reason: 'Nobody can approve their own decision.' })
    expect(can({ id: 'u-hos-1', role: 'head_of_service' }, 'approve_exception', { decidedByUserId: 'u-hos-1' })).toBe(false)
  })
  it('a task assigned to someone else can be completed only by a manager', () => {
    expect(can({ id: 'u-ta-1', role: 'ta_officer' }, 'complete_task', { taskOwnerUserId: 'u-ta-1' })).toBe(true)
    expect(can({ id: 'u-ta-1', role: 'ta_officer' }, 'complete_task', { taskOwnerUserId: 'u-ta-2' })).toBe(false)
    expect(can({ id: 'u-mgr-1', role: 'team_manager' }, 'complete_task', { taskOwnerUserId: 'u-ta-2' })).toBe(true)
  })
  it('nobody signed in may do anything', () => {
    for (const a of ACTIONS) expect(can(null, a)).toBe(false)
  })
})

describe('assertCan', () => {
  it('throws a typed PermissionError with a plain reason', () => {
    const e = (() => {
      try {
        assertCan({ id: 'u-aud-1', role: 'auditor' }, 'record_decision')
      } catch (x) {
        return x
      }
    })()
    expect(e).toBeInstanceOf(PermissionError)
    expect((e as PermissionError).action).toBe('record_decision')
    expect((e as PermissionError).message).toBe('Your role (Auditor (read only)) cannot record a placement decision.')
  })
})

describe('synthetic staff directory', () => {
  it('has every role the spec lists, two TA officers, and unique ids', () => {
    expect(new Set(STAFF.map(s => s.role))).toEqual(new Set(ORDER))
    expect(STAFF.filter(s => s.role === 'ta_officer')).toHaveLength(2)
    expect(new Set(STAFF.map(s => s.id)).size).toBe(STAFF.length)
  })
})
