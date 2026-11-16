import { describe, expect, it } from 'vitest'
import { foldPlacement, type Placement, type PlacementBase } from '../src/engine/placement'
import { conflictsFor, occupancyMessage, occupancyOf, overlaps } from '../src/engine/occupancy'
import { SCENARIOS } from '../src/data/households'
import type { PlacementState } from '../src/engine/types'
import { searchHousehold, TODAY } from './fixtures'

const NOW = '2026-11-02T12:00:00.000Z'
const base: PlacementBase = {
  seq: 7,
  caseRef: 'HN-OTHER',
  propertyId: 'P01',
  propertyLabel: 'Cedar Court 4',
  startDate: '2026-11-03',
  plannedEnd: '2027-05-02',
  decidedAt: '2026-11-02T09:00:00.000Z',
  decidedBy: { userId: 'u-ta-2', name: 'Priya Raman', role: 'ta_officer' },
  decidedByName: 'Priya Raman',
  holdUntil: '2026-11-03T09:00:00.000Z',
  sixWeekRule: false,
  limitDays: 42,
  exceptions: [],
  approvalRequired: false,
  legacy: false,
}
const at = (state: PlacementState, over: Partial<Placement> = {}): Placement => ({ ...foldPlacement(base, [], NOW), state, ...over })

describe('night ranges', () => {
  it('back-to-back stays on the same day do not overlap', () => {
    expect(overlaps({ from: '2026-11-01', to: '2026-11-10' }, { from: '2026-11-10', to: '2026-11-20' })).toBe(false)
    expect(overlaps({ from: '2026-11-10', to: '2026-11-20' }, { from: '2026-11-01', to: '2026-11-10' })).toBe(false)
    expect(overlaps({ from: '2026-11-01', to: '2026-11-11' }, { from: '2026-11-10', to: '2026-11-20' })).toBe(true)
  })
  it('an open-ended stay overlaps everything after its start', () => {
    expect(overlaps({ from: '2026-11-01', to: null }, { from: '2030-01-01', to: '2030-01-02' })).toBe(true)
    expect(overlaps({ from: '2026-11-01', to: null }, { from: '2026-10-01', to: '2026-11-01' })).toBe(false)
  })
})

describe('occupancy from placements', () => {
  it('a live hold counts until it expires, with its end time', () => {
    const [o] = occupancyOf([at('held')], NOW)
    expect(o).toMatchObject({ kind: 'hold', from: '2026-11-03', to: '2027-05-02', holdUntil: base.holdUntil })
    expect(occupancyMessage(o)).toBe('Held for another case until 09:00 on 3 Nov')
    expect(occupancyMessage(o, 'HN-OTHER')).toBe('Held for this case until 09:00 on 3 Nov')
    expect(occupancyOf([foldPlacement(base, [], '2026-11-03T09:00:00.000Z')], '2026-11-03T09:00:00.000Z')).toEqual([])
  })
  it('confirmed, offered and accepted placements are booked', () => {
    for (const s of ['provider_confirmed', 'offered', 'accepted'] as PlacementState[]) {
      const [o] = occupancyOf([at(s)], NOW)
      expect(occupancyMessage(o)).toBe('Booked 3 Nov to 2 May')
    }
  })
  it('refused, cancelled and expired placements free the dates', () => {
    expect(occupancyOf([at('refused'), at('cancelled'), at('hold_expired')], NOW)).toEqual([])
  })
  it('a household in residence past the planned end is open-ended until a move-out is recorded', () => {
    const p = at('checked_in', { checkedInOn: '2026-11-03', currentEnd: '2026-12-01' })
    expect(occupancyOf([p], '2026-11-20T12:00:00.000Z')[0].to).toBe('2026-12-01')
    const over = occupancyOf([p], '2026-12-05T12:00:00.000Z')[0]
    expect(over.to).toBeNull()
    expect(occupancyMessage(over)).toBe('Occupied since 3 Nov, past its planned end, with no move-out recorded')
    expect(conflictsFor([over], 'P01', '2027-03-01', '2027-03-10')).toHaveLength(1)
  })
  it('a move-out frees the property from the move-out date', () => {
    const [o] = occupancyOf([at('moved_out', { checkedInOn: '2026-11-03', movedOutOn: '2026-11-20' })], '2026-11-21T12:00:00.000Z')
    expect(conflictsFor([o], 'P01', '2026-11-20', '2026-12-01')).toEqual([])
    expect(conflictsFor([o], 'P01', '2026-11-19', '2026-12-01')).toHaveLength(1)
  })
  it('an extension moves the end', () => {
    const [o] = occupancyOf([at('accepted', { currentEnd: '2027-06-01' })], NOW)
    expect(conflictsFor([o], 'P01', '2027-05-20', '2027-05-25')).toHaveLength(1)
  })
  it('a placement never conflicts with itself', () => {
    const occ = occupancyOf([at('accepted')], NOW)
    expect(conflictsFor(occ, 'P01', '2026-11-03', '2026-12-01', 7)).toEqual([])
  })
})

describe('ALREADY_BOOKED gate', () => {
  const brief = SCENARIOS.find(s => s.id === 'brief')!.household(TODAY)
  it('removes an occupied property, with the dates and nothing about the other household', async () => {
    const free = await searchHousehold(brief)
    expect(free.recommendedId).toBe('P01')
    expect(free.candidates.find(c => c.propertyId === 'P01')!.checks.find(k => k.code === 'ALREADY_BOOKED')).toMatchObject({ passed: true })
    const occupancy = occupancyOf([at('accepted', { startDate: TODAY })], NOW)
    const taken = await searchHousehold(brief, 'S-OCC', { occupancy })
    const c = taken.candidates.find(x => x.propertyId === 'P01')!
    expect(c.eligible).toBe(false)
    expect(c.blocks.map(b => b.code)).toEqual(['ALREADY_BOOKED'])
    expect(c.blocks[0].message).toBe('Booked 2 Nov to 2 May')
    expect(taken.recommendedId).not.toBe('P01')
    expect(taken.explanation.caveats.join(' ') + taken.explanation.headline).not.toMatch(/HN-OTHER|Priya/)
  })
  it('a hold for later dates does not block a stay that ends before it', async () => {
    const occupancy = occupancyOf([at('held', { startDate: '2027-06-01', currentEnd: '2027-07-01' })], NOW)
    expect((await searchHousehold(brief, 'S-OCC2', { occupancy })).recommendedId).toBe('P01')
  })
})
