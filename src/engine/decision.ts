import { isRealDate } from './validate'
import type { ActorRef, ConsentMethod, ConsentRecord, ConsentStatus, Household, IsoDate, IsoDateTime, Issue, OverrideReason, SearchResult } from './types'

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

export function validateDecision(s: SearchResult, input: DecisionInput): Issue[] {
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
  if (!input.confirmedFullListReviewed) error('confirm', 'Confirm that you reviewed the options before recording the decision.')
  return issues
}
