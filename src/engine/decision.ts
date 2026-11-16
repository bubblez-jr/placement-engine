import { isRealDate } from './validate'
import { addDays, formatDate } from './dates'
import { isFamilyHousehold } from './bedrooms'
import { sharedFacilities } from './gates'
import { bnbLimitDays, placementPolicyOf } from './policy'
import type {
  ActorRef,
  ConsentMethod,
  ConsentRecord,
  ConsentStatus,
  EmergencyReason,
  ExceptionKind,
  Household,
  IsoDate,
  IsoDateTime,
  Issue,
  MoveOnRoute,
  OverrideReason,
  Property,
  Ruleset,
  SearchResult,
  StaffUser,
} from './types'

// The rules for recording a decision and consent. Pure; the store runs them
// before anything is sealed, and the decision screen shows the same issues.

export const OVERRIDE_MIN_CHARS = 20
export const NO_SUITABLE_MIN_CHARS = 30
export const CONSENT_REASON_MIN_CHARS = 10

export const CONSENT_STATUS_LABEL: Record<ConsentStatus, string> = {
  given: 'Consent given',
  refused: 'Consent refused',
  not_asked: 'Not asked yet',
}

export const CONSENT_METHOD_LABEL: Record<ConsentMethod, string> = {
  in_person: 'In person',
  phone: 'By phone',
  written: 'In writing',
}

/** What the officer enters. Nothing is filled in for them. */
export interface ConsentInput {
  status?: ConsentStatus
  givenBy?: string
  method?: ConsentMethod
  reason?: string
  note?: string
}

export interface DecisionInput {
  outcome: 'accepted' | 'override' | 'no_suitable'
  chosenPropertyId: string | null
  overrideReason?: OverrideReason
  reasonText: string
  startDate: IsoDate
  confirmedFullListReviewed: boolean
  /** Required when the household has children; ignored otherwise */
  consent?: ConsentInput | null
  /** Required when the six-week rule applies (a family in B&B or shared accommodation) */
  emergency?: { reasonCode?: EmergencyReason | ''; reasonText?: string }
  moveOnPlan?: { targetDate?: string; route?: MoveOnRoute | ''; routeNote?: string; ownerUserId?: string }
}

/** What validateDecision needs beyond the search: the property as held now, the policy, and who can own a move-on plan. */
export interface DecisionContext {
  property?: Property
  ruleset: Ruleset
  owners: StaffUser[]
}

export const EMERGENCY_REASON_LABEL: Record<EmergencyReason, string> = {
  no_self_contained: 'Nothing self-contained was available',
  out_of_hours: 'Out-of-hours emergency: the household needed somewhere tonight',
  immediate_safeguarding: 'Immediate safeguarding risk at the current address',
  medical_nearby: 'A medical need means staying near treatment',
  other: 'Other',
}

export const MOVE_ON_ROUTE_LABEL: Record<MoveOnRoute, string> = {
  self_contained_ta: 'Self-contained temporary accommodation',
  leased_property: 'A leased property (PSL)',
  social_housing: 'A social housing offer',
  private_rented: 'A private rented home',
  supported_housing: 'Supported housing',
  other: 'Other',
}

export const EMERGENCY_TEXT_MIN_CHARS = 20

/** The six-week limit applies: a household with children or a pregnant member in B&B or shared accommodation. */
export function sixWeekRuleApplies(h: Household, p: Property | undefined): boolean {
  return !!p && isFamilyHousehold(h.members) && sharedFacilities(p)
}

/**
 * The exceptions a decision raises, for the policy's approval list. A family
 * in shared accommodation always needs approval, whatever the list says.
 */
export function exceptionsFor(
  s: SearchResult,
  input: Pick<DecisionInput, 'outcome' | 'chosenPropertyId'>,
  property: Property | undefined,
  rs: Ruleset,
): ExceptionKind[] {
  const policy = placementPolicyOf(rs)
  const found: ExceptionKind[] = []
  if (input.outcome === 'no_suitable') found.push('no_suitable')
  if (input.outcome === 'override') found.push('not_recommended')
  const c = s.candidates.find(x => x.propertyId === input.chosenPropertyId)
  if (input.outcome !== 'no_suitable' && c) {
    if (c.tier === 4) found.push('out_of_area')
    if (sixWeekRuleApplies(s.household, property)) {
      found.push('shared_family')
      if (s.household.expectedNights > bnbLimitDays(rs)) found.push('beyond_bnb_limit')
    }
  }
  return found.filter(e => e === 'shared_family' || policy.approvalExceptions.includes(e))
}

export function hasChildren(h: Household): boolean {
  return h.members.some(m => m.role === 'child')
}

export function validateConsent(input: ConsentInput | null | undefined, h: Household): Issue[] {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  const status = input?.status
  if (status !== 'given' && status !== 'refused' && status !== 'not_asked') {
    error('consent-status', 'Record whether a parent consents to the council telling the children’s school, GP and health visitor.')
    return issues
  }
  if (status === 'not_asked') {
    if ((input?.reason ?? '').trim().length < CONSENT_REASON_MIN_CHARS)
      error('consent-reason', `Say why consent has not been asked yet (at least ${CONSENT_REASON_MIN_CHARS} characters).`)
    return issues
  }
  const adults = h.members.filter(m => m.role === 'adult').map(m => m.label)
  if (!input?.givenBy || !adults.includes(input.givenBy))
    error('consent-givenBy', status === 'given' ? 'Choose which adult gave consent.' : 'Choose which adult refused consent.')
  if (!input?.method || !(input.method in CONSENT_METHOD_LABEL)) error('consent-method', 'Choose how consent was asked: in person, by phone or in writing.')
  return issues
}

export function buildConsentRecord(input: ConsentInput, actor: ActorRef, at: IsoDateTime): ConsentRecord {
  const status = input.status!
  const note = input.note?.trim()
  return {
    status,
    ...(status === 'not_asked' ? { reason: input.reason!.trim() } : { givenBy: input.givenBy!, method: input.method! }),
    ...(note ? { note } : {}),
    recordedBy: actor,
    recordedAt: at,
  }
}

/** The emergency reason and move-on plan a family in shared accommodation needs. */
export function validateSixWeekPlan(input: DecisionInput, ctx: DecisionContext): Issue[] {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  const e = input.emergency ?? {}
  if (!e.reasonCode || !(e.reasonCode in EMERGENCY_REASON_LABEL)) error('emergency-reasonCode', 'Choose why this family has to go into shared accommodation.')
  if ((e.reasonText ?? '').trim().length < EMERGENCY_TEXT_MIN_CHARS)
    error('emergency-reasonText', `Explain the emergency in your own words (at least ${EMERGENCY_TEXT_MIN_CHARS} characters).`)
  const m = input.moveOnPlan ?? {}
  const limit = bnbLimitDays(ctx.ruleset)
  const lastDay = isRealDate(input.startDate) ? addDays(input.startDate, limit) : null
  if (!isRealDate(m.targetDate)) error('moveon-targetDate', 'Enter the date the family should move on by.')
  else if (isRealDate(input.startDate) && m.targetDate < input.startDate) error('moveon-targetDate', 'The move-on date cannot be before the placement starts.')
  else if (lastDay && m.targetDate > lastDay)
    error('moveon-targetDate', `The move-on date must be no later than ${formatDate(lastDay)}, the end of the ${limit / 7}-week limit.`)
  if (!m.route || !(m.route in MOVE_ON_ROUTE_LABEL)) error('moveon-route', 'Choose the route being pursued for the move.')
  else if (m.route === 'other' && (m.routeNote ?? '').trim().length < 5) error('moveon-routeNote', 'Describe the route being pursued.')
  if (!m.ownerUserId || !ctx.owners.some(o => o.id === m.ownerUserId)) error('moveon-owner', 'Choose the named person who owns the move-on plan.')
  return issues
}

export function validateDecision(s: SearchResult, input: DecisionInput, ctx?: DecisionContext): Issue[] {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  const eligible = s.candidates.filter(c => c.eligible)
  const rec = s.candidates.find(c => c.propertyId === s.recommendedId)
  const text = (input.reasonText ?? '').trim()

  if (input.outcome === 'no_suitable') {
    if (eligible.length > 0) error('choice', 'Some options passed every check: choose one, or go back and change the household’s needs.')
    if (text.length < NO_SUITABLE_MIN_CHARS) error('steps', `Describe the search steps taken (at least ${NO_SUITABLE_MIN_CHARS} characters).`)
  } else {
    const chosen = eligible.find(c => c.propertyId === input.chosenPropertyId)
    if (!chosen) error('choice', 'Choose one of the eligible options.')
    else if (input.outcome === 'accepted' && chosen.propertyId !== s.recommendedId)
      error('choice', 'This option is not the recommendation: record it as a different choice, with a reason.')
    else if (input.outcome === 'override') {
      if (chosen.propertyId === s.recommendedId) error('choice', 'This is the recommended option: accept it rather than overriding.')
      if (!input.overrideReason) error('reason', 'Choose the reason for not taking the recommendation.')
      if (text.length < OVERRIDE_MIN_CHARS)
        error('reasonText', `Give the reason for choosing this option over ${rec?.label ?? 'the recommendation'} (at least ${OVERRIDE_MIN_CHARS} characters).`)
    }
    if (!isRealDate(input.startDate)) error('startDate', 'Enter the date the placement starts.')
  }
  if (input.outcome !== 'no_suitable' && hasChildren(s.household)) issues.push(...validateConsent(input.consent, s.household))
  if (ctx && input.outcome !== 'no_suitable' && sixWeekRuleApplies(s.household, ctx.property)) issues.push(...validateSixWeekPlan(input, ctx))
  if (!input.confirmedFullListReviewed) error('confirm', 'Confirm that you reviewed the options before recording the decision.')
  return issues
}
