import { appendRecord, type ChainRecord } from '../audit/chain'
import { currentConsent, decisionRecords } from '../audit/records'
import { hashRuleset } from '../audit/ruleset'
import { isDecisionSnapshot, type ChainPayload, type DecisionSnapshotV2, type PlacementEvent } from '../audit/snapshot'
import { statutoryClocks } from '../engine/clocks'
import { buildConsentRecord, hasChildren, validateConsent, validateDecision, type ConsentInput, type DecisionInput } from '../engine/decision'
import { actorRef, assertCan } from '../engine/permissions'
import { runSearch } from '../engine/search'
import type { DecisionV2, Household, Property, Ruleset, SearchResult, StaffUser } from '../engine/types'
import { ValidationError, type OpenCase } from '../engine/validate'
import type { TravelProvider } from '../travel/provider'
import { activeRulesetOf, seed, type AppData, type HashedRuleset, type ReviewLog } from './data'

// Every change to app data goes through one of these. Each takes the actor
// from the signed-in session (never from a form field), checks the
// permission matrix first, and returns new data; nothing is changed in place.
// The React store (app.tsx) only wires them to state and storage.

export interface CommandCtx {
  user: StaffUser | null
  /** Full ISO timestamp */
  now: string
  /** The officer's calendar date, YYYY-MM-DD */
  today: string
}

export const EQUALITY_NOTE_MIN_CHARS = 30

/** Open work per case reference, so the form can point out a duplicate. */
export function openCases(d: AppData): OpenCase[] {
  const decided = new Set(decisionRecords(d.chain).map(r => r.snapshot.search.id))
  const out: OpenCase[] = d.searches
    .filter(s => !decided.has(s.id))
    .map(s => ({ caseRef: s.household.caseRef, kind: 'search' as const, at: s.createdAt, searchId: s.id }))
  for (const r of decisionRecords(d.chain)) {
    if (r.snapshot.decision.chosenPropertyId) out.push({ caseRef: r.snapshot.search.household.caseRef, kind: 'placement', at: r.snapshot.frozenAt, seq: r.seq })
  }
  return out
}

export async function cmdSearch(
  d: AppData,
  ctx: CommandCtx,
  household: Household,
  opts: { id: string; travel: TravelProvider },
): Promise<{ data: AppData; result: SearchResult }> {
  assertCan(ctx.user, 'run_search')
  const actor = actorRef(ctx.user!)
  // Answers that arrived without an officer stamp (an example household, an
  // import) are confirmed by the officer who runs the search.
  const stamped: Household = {
    ...household,
    accessAssessments: (household.accessAssessments ?? []).map(a => (a.answeredBy ? a : { ...a, answeredBy: actor, answeredAt: ctx.now })),
  }
  const rs = activeRulesetOf(d)
  const result = await runSearch({
    household: stamped,
    properties: d.properties,
    suppliers: d.suppliers,
    ruleset: rs,
    travel: opts.travel,
    now: ctx.now,
    today: ctx.today,
    dataVersions: { properties: d.propertiesVersion, reference: 'synthetic reference places v1' },
    id: opts.id,
    context: { openCases: openCases(d) },
    searchedBy: actor,
  })
  return { data: { ...d, searches: [result, ...d.searches].slice(0, 40) }, result }
}

export async function cmdDecide(
  d: AppData,
  ctx: CommandCtx,
  searchId: string,
  input: DecisionInput,
  review: ReviewLog,
): Promise<{ data: AppData; record: ChainRecord<DecisionSnapshotV2> }> {
  assertCan(ctx.user, 'record_decision')
  const search = d.searches.find(s => s.id === searchId)
  if (!search) throw new Error('This search is no longer held in this browser. Run the search again.')
  const already = decisionRecords(d.chain).find(r => r.snapshot.search.id === searchId)
  if (already) throw new Error(`A decision for this search is already sealed as record #${already.seq}. A later fact is a new record, not a second decision.`)
  const issues = validateDecision(search, input)
  if (issues.some(i => i.severity === 'error')) throw new ValidationError(issues)

  const rs = d.rulesets.find(r => r.hash === search.rulesetHash) ?? d.rulesets.find(r => r.version === search.rulesetVersion)
  if (!rs) throw new Error('The policy version this search used is no longer held. Run the search again.')
  const chosen = input.chosenPropertyId ? d.properties.find(p => p.id === input.chosenPropertyId) : undefined
  if (input.outcome !== 'no_suitable' && !chosen) throw new Error('This property is no longer in the inventory. Run the search again.')

  const actor = actorRef(ctx.user!)
  const placing = input.outcome !== 'no_suitable'
  const decision: DecisionV2 = {
    outcome: input.outcome,
    chosenPropertyId: placing ? input.chosenPropertyId : null,
    ...(input.outcome === 'override' ? { overrideReason: input.overrideReason } : {}),
    reasonText: input.reasonText.trim(),
    decidedBy: actor,
    decidedAt: ctx.now,
    reviewed: {
      resultsOpenedAt: review.resultsOpenedAt,
      propertiesOpened: [...review.propertiesOpened],
      comparisonOpened: review.comparisonOpened,
      confirmedFullListReviewed: input.confirmedFullListReviewed,
    },
    startDate: input.startDate,
    consent: placing && hasChildren(search.household) ? buildConsentRecord(input.consent!, actor, ctx.now) : null,
  }
  const snapshot: DecisionSnapshotV2 = {
    schema: 'placement-decision/2',
    frozenAt: ctx.now,
    councilName: rs.councilName,
    search,
    ruleset: rs,
    properties: d.properties.filter(p => search.candidates.some(c => c.propertyId === p.id)),
    decision,
    clocks: chosen ? statutoryClocks(search.household, chosen, rs, decision) : [],
    notes: ['SYNTHETIC DEMO DATA. Not a real household or property.', search.travelProvider.disclaimer, rs.subsidy.source],
  }
  const record = await appendRecord(d.chain, snapshot)
  return { data: { ...d, chain: [...d.chain, record] }, record }
}

/** Record a later consent answer as a new chain event. The decision record is not touched. */
export async function cmdUpdateConsent(
  d: AppData,
  ctx: CommandCtx,
  seq: number,
  input: ConsentInput,
): Promise<{ data: AppData; record: ChainRecord<PlacementEvent> }> {
  assertCan(ctx.user, 'record_consent')
  const rec = decisionRecords(d.chain).find(r => r.seq === seq)
  if (!rec) throw new Error(`Decision #${seq} not found.`)
  const h = rec.snapshot.search.household
  if (!rec.snapshot.decision.chosenPropertyId || !hasChildren(h))
    throw new Error('Consent to notify school and health services applies only to a placement of a household with children.')
  const issues = validateConsent(input, h)
  if (issues.some(i => i.severity === 'error')) throw new ValidationError(issues)
  const actor = actorRef(ctx.user!)
  const { now } = currentConsent(d.chain, rec)
  const event: PlacementEvent = {
    schema: 'placement-event/1',
    at: ctx.now,
    actor,
    caseRef: h.caseRef,
    about: { seq: rec.seq, rowHash: rec.rowHash },
    event: {
      type: 'consent_updated',
      consent: buildConsentRecord(input, actor, ctx.now),
      previous: now.kind === 'record' ? now.consent : now.kind === 'legacy' ? { legacyConsentToNotify: now.consented } : null,
    },
    notes: ['SYNTHETIC DEMO DATA. Not a real household.'],
  }
  const record = await appendRecord(d.chain, event)
  return { data: { ...d, chain: [...d.chain, record] }, record }
}

export function nextVersion(v: string): string {
  const [maj, min] = v.split('.').map(Number)
  return `${maj}.${(min ?? 0) + 1}`
}

export async function cmdPublishRuleset(d: AppData, ctx: CommandCtx, draft: Ruleset, equalityNote: string): Promise<{ data: AppData; ruleset: HashedRuleset }> {
  assertCan(ctx.user, 'publish_policy')
  if (equalityNote.trim().length < EQUALITY_NOTE_MIN_CHARS)
    throw new ValidationError([
      {
        path: 'equality',
        severity: 'error',
        message: `Record the equality assessment for this change (at least ${EQUALITY_NOTE_MIN_CHARS} characters): weights decide who gets placed where.`,
      },
    ])
  const actor = actorRef(ctx.user!)
  const latest = d.rulesets[d.rulesets.length - 1]
  const next = await hashRuleset({
    ...draft,
    version: nextVersion(latest.version),
    effectiveFrom: ctx.today,
    signOff: { by: actor.name, role: actor.roleLabel, at: ctx.now, equalityNote: equalityNote.trim(), actor },
    hash: undefined,
  })
  return { data: { ...d, rulesets: [...d.rulesets, next], activeVersion: next.version }, ruleset: next }
}

export function cmdReplaceProperties(d: AppData, ctx: CommandCtx, props: Property[], mode: 'add' | 'replace'): AppData {
  assertCan(ctx.user, 'edit_properties')
  const merged = mode === 'replace' ? props : [...d.properties.filter(p => !props.some(n => n.id === p.id)), ...props]
  return { ...d, properties: merged, propertiesVersion: `inventory ${ctx.now.slice(0, 16).replace('T', ' ')} (import by ${ctx.user!.name})` }
}

export function cmdConfirmAvailability(d: AppData, ctx: CommandCtx, propertyId: string): AppData {
  assertCan(ctx.user, 'confirm_availability')
  if (!d.properties.some(p => p.id === propertyId)) throw new Error('Property not found.')
  return {
    ...d,
    properties: d.properties.map(p => (p.id === propertyId ? { ...p, availabilityConfirmedAt: ctx.now, availabilityConfirmedBy: ctx.user!.name } : p)),
    propertiesVersion: `inventory ${ctx.now.slice(0, 16).replace('T', ' ')}`,
  }
}

/** Demo only: change record #1 without resealing it, so the seal check can show it. */
export function cmdTamper(d: AppData, ctx: CommandCtx): AppData {
  assertCan(ctx.user, 'run_tamper_demo')
  if (d.chain.length === 0 || d.tamperBackup) return d
  const target = d.chain[0]
  const altered: ChainPayload = structuredClone(target.snapshot)
  if (isDecisionSnapshot(altered)) altered.decision.reasonText = `${altered.decision.reasonText} [edited after the decision]`
  else altered.notes = [...altered.notes, '[edited after the event]']
  return {
    ...d,
    chain: d.chain.map(r => (r.seq === target.seq ? { ...r, snapshot: altered } : r)),
    tamperBackup: { seq: target.seq, snapshot: target.snapshot },
  }
}

export function cmdUndoTamper(d: AppData, ctx: CommandCtx): AppData {
  assertCan(ctx.user, 'run_tamper_demo')
  if (!d.tamperBackup) return d
  const b = d.tamperBackup
  return { ...d, chain: d.chain.map(r => (r.seq === b.seq ? { ...r, snapshot: b.snapshot } : r)), tamperBackup: undefined }
}

export async function cmdReset(ctx: CommandCtx): Promise<AppData> {
  assertCan(ctx.user, 'reset_demo')
  return seed(ctx.now, ctx.today)
}
