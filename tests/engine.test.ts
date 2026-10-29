import { describe, expect, it } from 'vitest'
import { bedroomNeed } from '../src/engine/bedrooms'
import { piecewise } from '../src/engine/valueFns'
import { subsidyPerNight } from '../src/engine/cost'
import { defaultRuleset } from '../src/data/ruleset'
import { seedProperties } from '../src/data/properties'
import { estimatePublicTransportMinutes } from '../src/travel/estimate'
import { addDays, daysBetween } from '../src/engine/dates'
import type { Person } from '../src/engine/types'
import { NOW, TODAY } from './fixtures'

const p = (id: string, age: number, sex: 'F' | 'M', extra: Partial<Person> = {}): Person => ({ id, label: id, role: age < 16 ? 'child' : 'adult', age, sex, ...extra })

describe('bedroom need', () => {
  it('single adult needs 1', () => expect(bedroomNeed([p('a', 30, 'F')])).toBe(1))
  it('couple shares', () => expect(bedroomNeed([p('a', 30, 'F', { partnerOf: 'b' }), p('b', 31, 'M', { partnerOf: 'a' })])).toBe(1))
  it('two under-10s share regardless of sex', () => expect(bedroomNeed([p('a', 30, 'F'), p('c', 4, 'F'), p('d', 8, 'M')])).toBe(2))
  it('a girl of 12 and a boy of 11 do not share', () => expect(bedroomNeed([p('a', 30, 'F'), p('c', 12, 'F'), p('d', 11, 'M')])).toBe(3))
  it('finds the best pairing', () => expect(bedroomNeed([p('a', 40, 'F'), p('c1', 15, 'F'), p('c2', 13, 'M'), p('c3', 10, 'M'), p('c4', 6, 'F'), p('c5', 2, 'F')])).toBe(4))
  it('a 17-year-old gets their own room', () => expect(bedroomNeed([p('a', 40, 'F'), p('c', 17, 'M'), p('d', 14, 'M')])).toBe(3))
})

describe('value functions', () => {
  const bp: [number, number][] = [[15, 1], [30, 0.8], [45, 0.5], [75, 0]]
  it('clamps below', () => expect(piecewise(bp, 5)).toBe(1))
  it('interpolates', () => expect(piecewise(bp, 37.5)).toBeCloseTo(0.65))
  it('clamps above', () => expect(piecewise(bp, 120)).toBe(0))
})

describe('subsidy', () => {
  const rs = defaultRuleset(NOW)
  const props = seedProperties(TODAY, NOW)
  it('uses 90% of the 3-bed Jan 2011 rate for a self-contained 3-bed', () => {
    const a = props.find(x => x.id === 'P01')!
    expect(subsidyPerNight(a, rs).perNight).toBeCloseTo((0.9 * 350) / 7, 1)
  })
  it('uses the one-bed rate when facilities are shared', () => {
    const bnb = props.find(x => x.id === 'P04')!
    expect(subsidyPerNight(bnb, rs).perNight).toBeCloseTo((0.9 * 250) / 7, 1)
  })
  it('never exceeds the charge', () => {
    const cheap = { ...props.find(x => x.id === 'P01')!, nightlyCharge: 20 }
    expect(subsidyPerNight(cheap, rs).perNight).toBe(20)
  })
  it('returns £0 with a reason when no LHA rate is loaded', () => {
    const x = { ...props.find(x => x.id === 'P01')!, brma: 'Nowhere' }
    const s = subsidyPerNight(x, rs)
    expect(s.perNight).toBe(0)
    expect(s.basis).toMatch(/No January 2011 LHA rate/)
  })
})

describe('journey estimate', () => {
  it('is monotonic in distance', () => {
    let last = 0
    for (const km of [0.3, 1, 2, 5, 10, 20, 40, 80]) {
      const m = estimatePublicTransportMinutes(km)
      expect(m).toBeGreaterThanOrEqual(last)
      last = m
    }
  })
})

describe('dates', () => {
  it('adds days across month ends', () => expect(addDays('2026-10-30', 3)).toBe('2026-11-02'))
  it('counts days', () => expect(daysBetween('2026-11-02', '2026-12-14')).toBe(42))
})
