import { describe, expect, it } from 'vitest'
import { statutoryClocks } from '../src/engine/clocks'
import { buildConsentRecord, validateConsent, validateDecision, type DecisionInput } from '../src/engine/decision'
import { actorRef } from '../src/engine/permissions'
import { seedProperties } from '../src/data/properties'
import { defaultRuleset } from '../src/data/ruleset'
import { STAFF } from '../src/data/staff'
import type { ConsentRecord, DecisionV2 } from '../src/engine/types'
import { NOW, scenarioSearch, TODAY } from './fixtures'

const officer = actorRef(STAFF[0])

describe('validateConsent', async () => {
  const h = (await scenarioSearch('brief')).household
  const paths = (x: Parameters<typeof validateConsent>[0]) => validateConsent(x, h).map(i => i.path)
  it('has no default: an empty answer is an error', () => {
    expect(paths(undefined)).toEqual(['consent-status'])
    expect(paths({})).toEqual(['consent-status'])
  })
  it('given needs which adult and how', () => {
    expect(paths({ status: 'given' })).toEqual(['consent-givenBy', 'consent-method'])
    expect(paths({ status: 'given', givenBy: 'Child 1', method: 'phone' })).toEqual(['consent-givenBy'])
    expect(paths({ status: 'given', givenBy: 'Adult 1', method: 'phone' })).toEqual([])
  })
  it('refused needs which adult and how', () => {
    expect(paths({ status: 'refused', givenBy: 'Adult 1' })).toEqual(['consent-method'])
    expect(paths({ status: 'refused', givenBy: 'Adult 1', method: 'in_person' })).toEqual([])
  })
  it('not asked needs a reason', () => {
    expect(paths({ status: 'not_asked' })).toEqual(['consent-reason'])
    expect(paths({ status: 'not_asked', reason: 'short' })).toEqual(['consent-reason'])
    expect(paths({ status: 'not_asked', reason: 'Parent asleep when placed at 01:30.' })).toEqual([])
  })
  it('the record keeps who recorded it and when, and only the fields for its status', () => {
    expect(buildConsentRecord({ status: 'given', givenBy: 'Adult 1', method: 'phone', reason: 'ignored', note: ' ' }, officer, NOW)).toEqual({
      status: 'given',
      givenBy: 'Adult 1',
      method: 'phone',
      recordedBy: officer,
      recordedAt: NOW,
    })
  })
})

describe('validateDecision', async () => {
  const s = await scenarioSearch('brief')
  const ok: DecisionInput = {
    outcome: 'accepted',
    chosenPropertyId: s.recommendedId,
    reasonText: '',
    startDate: TODAY,
    confirmedFullListReviewed: true,
    consent: { status: 'given', givenBy: 'Adult 1', method: 'in_person' },
  }
  const paths = (x: Partial<DecisionInput>) => validateDecision(s, { ...ok, ...x }).map(i => i.path)
  it('accepts a complete decision', () => expect(paths({})).toEqual([]))
  it('requires consent for a household with children', () => expect(paths({ consent: undefined })).toEqual(['consent-status']))
  it('requires the officer to confirm the review', () => expect(paths({ confirmedFullListReviewed: false })).toEqual(['confirm']))
  it('requires a reason of 20 characters to override', () => {
    const other = s.candidates.find(c => c.eligible && c.propertyId !== s.recommendedId)!.propertyId
    expect(paths({ outcome: 'override', chosenPropertyId: other, overrideReason: 'household_preference', reasonText: 'too short' })).toEqual(['reasonText'])
    expect(paths({ outcome: 'override', chosenPropertyId: other, reasonText: 'The household asked for it after a viewing.' })).toEqual(['reason'])
  })
  it('refuses an "accepted" outcome for something other than the recommendation', () => {
    const other = s.candidates.find(c => c.eligible && c.propertyId !== s.recommendedId)!.propertyId
    expect(paths({ chosenPropertyId: other })).toEqual(['choice'])
  })
  it('refuses a property that was ruled out', () => {
    expect(paths({ chosenPropertyId: s.candidates.find(c => !c.eligible)!.propertyId })).toEqual(['choice'])
  })
  it('refuses "no suitable option" when options passed', () => {
    expect(paths({ outcome: 'no_suitable', chosenPropertyId: null, reasonText: 'Rang every supplier on the list twice.' })).toEqual(['choice'])
  })
})

describe('consent and the statutory clocks', async () => {
  const s = await scenarioSearch('brief')
  const p = seedProperties(TODAY, NOW).find(x => x.id === s.recommendedId)!
  const rs = defaultRuleset(NOW)
  const decision = (consent: ConsentRecord): DecisionV2 => ({
    outcome: 'accepted',
    chosenPropertyId: p.id,
    reasonText: '',
    decidedAt: NOW,
    decidedBy: officer,
    reviewed: { resultsOpenedAt: NOW, propertiesOpened: [], comparisonOpened: false, confirmedFullListReviewed: true },
    startDate: TODAY,
    consent,
  })
  const keys = (c: ConsentRecord) => statutoryClocks(s.household, p, rs, decision(c)).map(k => `${k.key}:${k.due}`)
  it('given: the s213AA notification is due in 14 days', () => {
    expect(keys(buildConsentRecord({ status: 'given', givenBy: 'Adult 1', method: 'phone' }, officer, NOW))).toEqual(['s213aa:2026-11-16', 's202:2026-11-23'])
  })
  it('refused: no notification clock at all', () => {
    expect(keys(buildConsentRecord({ status: 'refused', givenBy: 'Adult 1', method: 'phone' }, officer, NOW))).toEqual(['s202:2026-11-23'])
  })
  it('not asked: a follow-up inside the s213AA window, then the notification', () => {
    expect(keys(buildConsentRecord({ status: 'not_asked', reason: 'Placed at 02:00; parent asleep.' }, officer, NOW))).toEqual([
      'consent-follow-up:2026-11-09',
      's213aa:2026-11-16',
      's202:2026-11-23',
    ])
  })
})
