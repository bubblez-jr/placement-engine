import type { Person } from './types'

/**
 * Bedrooms needed under the size criteria used for housing benefit (LHA):
 * one bedroom each for a couple; any other person aged 16 or over;
 * two children of the same sex under 16; two children under 10 regardless of sex;
 * any other child. Finds the fewest bedrooms by trying every pairing of children.
 */
export function bedroomNeed(members: Person[]): number {
  let rooms = 0
  const seen = new Set<string>()
  const adults = members.filter(m => m.age >= 16)
  for (const a of adults) {
    if (seen.has(a.id)) continue
    seen.add(a.id)
    if (a.partnerOf) {
      const p = adults.find(x => x.id === a.partnerOf)
      if (p) seen.add(p.id)
    }
    rooms++
  }
  const kids = members.filter(m => m.age < 16)
  return rooms + minRoomsForChildren(kids)
}

function canShare(a: Person, b: Person): boolean {
  if (a.age < 10 && b.age < 10) return true
  return a.sex === b.sex && a.sex !== 'X'
}

function minRoomsForChildren(kids: Person[]): number {
  if (kids.length === 0) return 0
  const [first, ...rest] = kids
  // first child sleeps alone
  let best = 1 + minRoomsForChildren(rest)
  // or shares with one compatible child
  for (let i = 0; i < rest.length; i++) {
    if (canShare(first, rest[i])) {
      const others = rest.filter((_, j) => j !== i)
      best = Math.min(best, 1 + minRoomsForChildren(others))
    }
  }
  return best
}

/** Children (under 16) or a pregnant member make this a family household for the B&B rule. */
export function isFamilyHousehold(members: Person[]): boolean {
  return members.some(m => m.role === 'child' || m.age < 16 || m.pregnant)
}
