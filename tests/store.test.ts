import { describe, expect, it } from 'vitest'
import { verifyChain } from '../src/audit/chain'
import { clocksNow, currentConsent, decisionRecords, tasksFrom } from '../src/audit/records'
import { SCENARIOS } from '../src/data/households'
import { defaultRuleset } from '../src/data/ruleset'
import { STAFF } from '../src/data/staff'
import type { DecisionInput } from '../src/engine/decision'
import { PermissionError } from '../src/engine/permissions'
import { ValidationError } from '../src/engine/validate'
import {
  cmdConfirmAvailability,
  cmdDecide,
  cmdPublishRuleset,
  cmdReplaceProperties,
  cmdSearch,
  cmdTamper,
  cmdUpdateConsent,
  type CommandCtx,
} from '../src/store/commands'
import { seed, type AppData } from '../src/store/data'
import { cmdReset } from '../src/store/demo'
import { estimateProvider } from '../src/travel/estimate'
import { NOW, TODAY } from './fixtures'

// The store enforces the rules: these call the same commands the React store
// calls, as each role, with no UI in the way.

const as = (id: string): CommandCtx => ({ user: STAFF.find(s => s.id === id)!, now: NOW, today: TODAY })
const officer = as('u-ta-1')
const manager = as('u-mgr-1')
const head = as('u-hos-1')
const auditor = as('u-aud-1')
const supply = as('u-sup-1')
const admin = as('u-adm-1')
const review = { resultsOpenedAt: NOW, propertiesOpened: [], comparisonOpened: false }

async function searched(ctx = officer, scenario = 'brief'): Promise<{ d: AppData; id: string; rec: string }> {
  const h = SCENARIOS.find(s => s.id === scenario)!.household(TODAY)
  const { data, result } = await cmdSearch(await seed(NOW, TODAY), ctx, h, { id: `S-${scenario}`, travel: estimateProvider })
  return { d: data, id: result.id, rec: result.recommendedId! }
}
const accept = (rec: string, over: Partial<DecisionInput> = {}): DecisionInput => ({
  outcome: 'accepted',
  chosenPropertyId: rec,
  reasonText: '',
  startDate: TODAY,
  confirmedFullListReviewed: true,
  consent: { status: 'given', givenBy: 'Adult 1', method: 'in_person' },
  ...over,
})
const refused = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (e) {
    return e
  }
  return null
}

describe('the store refuses what a role may not do', () => {
  it('an auditor cannot run a search', async () => {
    const e = await refused(searched(auditor))
    expect(e).toBeInstanceOf(PermissionError)
  })
  it('an auditor cannot record a decision, even on a search an officer ran', async () => {
    const { d, id, rec } = await searched()
    expect(await refused(cmdDecide(d, auditor, id, accept(rec), review))).toBeInstanceOf(PermissionError)
  })
  it('an officer cannot publish policy; the head of service can', async () => {
    const d = await seed(NOW, TODAY)
    const note = 'No change to who is disadvantaged: the school weight moves by one point only.'
    expect(await refused(cmdPublishRuleset(d, officer, defaultRuleset(NOW), note))).toBeInstanceOf(PermissionError)
    expect(await refused(cmdPublishRuleset(d, manager, defaultRuleset(NOW), note))).toBeInstanceOf(PermissionError)
    const { ruleset } = await cmdPublishRuleset(d, head, defaultRuleset(NOW), note)
    expect(ruleset.signOff.actor).toEqual({ userId: 'u-hos-1', name: 'Martin Osei', role: 'head_of_service', roleLabel: 'Head of service (policy owner)' })
    expect(ruleset.signOff.by).toBe('Martin Osei')
  })
  it('publishing needs an equality note', async () => {
    expect(await refused(cmdPublishRuleset(await seed(NOW, TODAY), head, defaultRuleset(NOW), 'ok'))).toBeInstanceOf(ValidationError)
  })
  it('only supply/compliance and admin import properties; an auditor cannot even confirm availability', async () => {
    const d = await seed(NOW, TODAY)
    expect(await refused(() => cmdReplaceProperties(d, officer, d.properties.slice(0, 1), 'add'))).toBeInstanceOf(PermissionError)
    expect(cmdReplaceProperties(d, supply, d.properties.slice(0, 1), 'add').propertiesVersion).toMatch(/import by Jo Whitfield/)
    expect(await refused(() => cmdConfirmAvailability(d, auditor, 'P01'))).toBeInstanceOf(PermissionError)
    expect(cmdConfirmAvailability(d, officer, 'P01').properties.find(p => p.id === 'P01')!.availabilityConfirmedBy).toBe('Sam Okafor')
  })
  it('only admin resets the demo; an auditor cannot run the tamper demo', async () => {
    expect(await refused(cmdReset(officer))).toBeInstanceOf(PermissionError)
    expect((await cmdReset(admin)).schema).toBe(2)
    const d = await seed(NOW, TODAY)
    expect(await refused(() => cmdTamper(d, auditor))).toBeInstanceOf(PermissionError)
  })
  it('nobody signed in can do anything', async () => {
    expect(await refused(searched({ user: null, now: NOW, today: TODAY }))).toBeInstanceOf(PermissionError)
  })
})

describe('the actor comes from the session, never from input', () => {
  it('a decision records the signed-in officer, whatever else the input carries', async () => {
    const { d, id, rec } = await searched()
    const sneaky = {
      ...accept(rec),
      officer: 'Someone Else',
      officerRole: 'Director',
      decidedBy: { userId: 'x', name: 'Someone Else' },
    } as unknown as DecisionInput
    const { record } = await cmdDecide(d, officer, id, sneaky, review)
    expect(record.snapshot.decision.decidedBy).toEqual({
      userId: 'u-ta-1',
      name: 'Sam Okafor',
      role: 'ta_officer',
      roleLabel: 'Temporary accommodation officer',
    })
    expect(record.snapshot.decision).not.toHaveProperty('officer')
    expect(record.snapshot.decision.consent?.recordedBy.userId).toBe('u-ta-1')
  })
  it('the search records who ran it and stamps every access answer from the session, whatever stamp it arrived with', async () => {
    const h = SCENARIOS.find(s => s.id === 'access')!.household(TODAY)
    h.accessAssessments![0].answeredBy = { userId: 'u-hos-1', name: 'Martin Osei', role: 'head_of_service', roleLabel: 'Head of service' }
    h.accessAssessments![0].answeredAt = '2020-01-01T00:00:00Z'
    const { result } = await cmdSearch(await seed(NOW, TODAY), officer, h, { id: 'S-x', travel: estimateProvider })
    expect(result.searchedBy?.userId).toBe('u-ta-1')
    expect(result.household.accessAssessments?.[0]).toMatchObject({ answeredBy: { userId: 'u-ta-1' }, answeredAt: NOW })
  })
})

describe('decision rules run in the store', () => {
  it('a household with children cannot be decided without a consent answer', async () => {
    const { d, id, rec } = await searched()
    const e = await refused(cmdDecide(d, officer, id, accept(rec, { consent: undefined }), review))
    expect(e).toBeInstanceOf(ValidationError)
    expect((e as ValidationError).issues.map(i => i.path)).toEqual(['consent-status'])
  })
  it('the same search cannot be decided twice', async () => {
    const { d, id, rec } = await searched()
    const first = await cmdDecide(d, officer, id, accept(rec), review)
    expect(await refused(cmdDecide(first.data, manager, id, accept(rec), review))).toBeInstanceOf(Error)
  })
  it('a household with no children records no consent', async () => {
    const { d, id, rec } = await searched(officer, 'dialysis')
    const { record } = await cmdDecide(d, officer, id, accept(rec, { consent: undefined }), review)
    expect(record.snapshot.decision.consent).toBeNull()
  })
})

describe('consent can be updated later as a new chain event', () => {
  it('records who, when and what changed, leaves the decision untouched, and the chain verifies', async () => {
    const { d, id, rec } = await searched()
    const first = await cmdDecide(d, officer, id, accept(rec, { consent: { status: 'not_asked', reason: 'Placed at 02:00, parent asleep.' } }), review)
    const sealed = JSON.stringify(first.record)
    expect(first.record.snapshot.clocks.map(c => c.key)).not.toContain('consent-follow-up')
    const consentTask = (data: AppData) => tasksFrom(data.chain, data.properties, data.rulesets[0], NOW).find(t => t.id === `consent:${first.record.seq}`)
    expect(consentTask(first.data)).toMatchObject({ status: 'open', owner: { kind: 'user', userId: 'u-ta-1' } })

    expect(await refused(cmdUpdateConsent(first.data, auditor, first.record.seq, { status: 'given', givenBy: 'Adult 1', method: 'phone' }))).toBeInstanceOf(
      PermissionError,
    )
    expect(await refused(cmdUpdateConsent(first.data, manager, first.record.seq, { status: 'given' }))).toBeInstanceOf(ValidationError)

    const { data, record } = await cmdUpdateConsent(first.data, manager, first.record.seq, { status: 'refused', givenBy: 'Adult 1', method: 'phone' })
    expect(JSON.stringify(data.chain[0])).toBe(sealed)
    expect(record.snapshot).toMatchObject({
      schema: 'placement-event/1',
      actor: { userId: 'u-mgr-1' },
      at: NOW,
      event: { type: 'consent_updated', consent: { status: 'refused' }, previous: { status: 'not_asked' } },
    })
    expect(await verifyChain(data.chain)).toEqual({ ok: true, checked: 2 })
    const r = decisionRecords(data.chain)[0]
    expect(currentConsent(data.chain, r).now).toMatchObject({ kind: 'record', consent: { status: 'refused' } })
    const clocks = clocksNow(data.chain, r)
    expect(clocks.find(c => c.key === 'consent-follow-up')).toBeUndefined()
    expect(consentTask(data)).toMatchObject({ status: 'done', closedBy: `Consent recorded, record #${record.seq}` })
    expect(clocks.find(c => c.key === 's213aa')).toMatchObject({ status: 'done', label: expect.stringMatching(/Consent refused/) })
  })
})
