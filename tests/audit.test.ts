import { describe, expect, it } from 'vitest'
import { canonicalize } from '../src/audit/canonical'
import { appendRecord, verifyChain, type ChainRecord } from '../src/audit/chain'
import { hashRuleset } from '../src/audit/ruleset'
import { defaultRuleset } from '../src/data/ruleset'
import type { DecisionSnapshot } from '../src/audit/snapshot'
import { NOW } from './fixtures'

describe('canonical JSON', () => {
  it('sorts keys and drops undefined', () => {
    expect(canonicalize({ b: 1, a: { d: undefined, c: [1, 'x'] } })).toBe('{"a":{"c":[1,"x"]},"b":1}')
  })
  it('is order-independent', () => {
    expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }))
  })
})

describe('rule-set hash', () => {
  it('changes when a weight changes', async () => {
    const a = await hashRuleset(defaultRuleset(NOW))
    const rs = defaultRuleset(NOW)
    rs.criteria[0].weight = 23
    const b = await hashRuleset(rs)
    expect(a.hash).not.toBe(b.hash)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('hash chain', () => {
  const snap = (n: number) => ({ schema: 'placement-decision/1', frozenAt: NOW, councilName: 'Demo', notes: [`decision ${n}`] }) as unknown as DecisionSnapshot
  it('verifies an untouched chain and detects tampering', async () => {
    const chain: ChainRecord[] = []
    for (let i = 1; i <= 3; i++) chain.push(await appendRecord(chain, snap(i)))
    expect(await verifyChain(chain)).toEqual({ ok: true, checked: 3 })
    const tampered = structuredClone(chain)
    tampered[1].snapshot.notes = ['changed later']
    const check = await verifyChain(tampered)
    expect(check.ok).toBe(false)
    expect(check.brokenAt).toBe(2)
  })
})
