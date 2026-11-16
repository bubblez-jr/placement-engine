import { ACCESS_QUESTIONS, HOUSEHOLD_SUBJECT, requiredAccessSubjects, subjectLabel } from './access'
import { formatDate, parseDate, toIsoDate } from './dates'
import type { Household, IsoDate, IsoDateTime, Issue } from './types'

// Household validation. Pure, and enforced by runSearch, so a household that
// arrives any other way (an import, a test, a future API) gets the same checks
// as the form. Each issue's `path` is the id of the form control where the
// officer fixes it, so the form can link the error summary to the field.

export const CASE_REF_MAX = 40
export const MAX_STAY_NIGHTS = 730
export const ZONE_RADIUS_KM = { min: 0.1, max: 50 } as const

/** Thrown by runSearch (and the store) when entered or imported data has errors. */
export class ValidationError extends Error {
  readonly issues: Issue[]
  constructor(issues: Issue[]) {
    const errors = issues.filter(i => i.severity === 'error')
    super(`There ${errors.length === 1 ? 'is 1 problem' : `are ${errors.length} problems`} to fix: ${errors.map(e => e.message).join(' ')}`)
    this.name = 'ValidationError'
    this.issues = issues
  }
}

/** Other work already open for a case reference, so a duplicate can be pointed out. */
export interface OpenCase {
  caseRef: string
  kind: 'search' | 'placement'
  at: IsoDateTime
  searchId?: string
  seq?: number
}

export interface ValidationContext {
  openCases?: OpenCase[]
}

const isWhole = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max

export function isRealDate(d: unknown): d is IsoDate {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  return toIsoDate(parseDate(d)) === d
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function validateHousehold(h: Household, today: IsoDate, context: ValidationContext = {}): Issue[] {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  const warning = (path: string, message: string, link?: Issue['link']) => issues.push({ path, message, severity: 'warning', ...(link ? { link } : {}) })

  // Case
  const ref = typeof h.caseRef === 'string' ? h.caseRef.trim() : ''
  if (!ref) error('caseRef', 'Enter the case reference.')
  else if (ref.length > CASE_REF_MAX) error('caseRef', `The case reference must be ${CASE_REF_MAX} characters or fewer.`)

  if (!h.needFrom) error('needFrom', 'Enter the date the accommodation is needed from.')
  else if (!isRealDate(h.needFrom)) error('needFrom', 'Enter the date needed as a real date.')
  else if (h.needFrom < today) error('needFrom', 'The date needed cannot be in the past.')

  if (!isWhole(h.expectedNights, 1, MAX_STAY_NIGHTS))
    error('expectedNights', `Enter the expected stay as a whole number of nights, from 1 to ${MAX_STAY_NIGHTS}.`)

  // People
  const members = Array.isArray(h.members) ? h.members : []
  if (members.length === 0) error('members', 'Add at least one person to the household.')
  const agesValid = members.every(m => isWhole(m.age, 0, 120))
  for (const m of members) {
    const path = `age-${m.id}`
    if (!isWhole(m.age, 0, 120)) {
      error(path, `Enter ${m.label}’s age as a whole number from 0 to 120.`)
      continue
    }
    if (m.role === 'adult' && m.age < 16)
      error(path, `${m.label} is recorded as an adult but is under 16. Correct the age, or remove them and add them as a child.`)
    if (m.role === 'child' && m.age >= 18)
      error(path, `${m.label} is recorded as a child but is 18 or over. Correct the age, or remove them and add them as an adult.`)
  }
  if (members.length > 0 && agesValid && !members.some(m => m.age >= 16)) error('members', 'The household needs at least one adult aged 16 or over.')

  for (const m of members) {
    if (!m.partnerOf) continue
    const path = `partner-${m.id}`
    const p = members.find(x => x.id === m.partnerOf)
    if (m.partnerOf === m.id) error(path, `${m.label} cannot be their own partner.`)
    else if (!p) error(path, `${m.label}’s partner is no longer in the household. Choose a partner again or choose None.`)
    else if (p.partnerOf !== m.id) error(path, `${m.label} and ${p.label} must both be recorded as each other’s partner.`)
  }

  // Places that matter
  for (const d of Array.isArray(h.destinations) ? h.destinations : []) {
    const who = members.find(m => m.id === d.personId)
    if (!d.personId) error(`who-${d.id}`, `Choose who goes to ${d.name}.`)
    else if (!who) error(`who-${d.id}`, `Choose who goes to ${d.name}: the person chosen is no longer in the household.`)
    else if (d.kind === 'school' && who.role === 'adult')
      warning(`who-${d.id}`, `${d.name} is a school but is set against ${who.label}, an adult. Check who goes there.`)
    if (typeof d.arriveBy !== 'string' || !TIME.test(d.arriveBy)) error(`arrive-${d.id}`, `Enter an arrive-by time for ${d.name}, for example 08:45.`)
    if (!isWhole(d.daysPerWeek, 1, 7)) error(`days-${d.id}`, `Enter how many days a week for ${d.name}, from 1 to 7.`)
  }

  // Money
  const c = h.maxHouseholdContributionWeekly
  if (typeof c !== 'number' || !Number.isFinite(c) || c < 0)
    error('afford', 'Enter what the household can pay towards charges each week, in pounds. Enter 0 if they can pay nothing.')

  // Safeguarding zones
  for (const z of Array.isArray(h.safeguardingZones) ? h.safeguardingZones : []) {
    const r = z.radiusKm
    if (typeof r !== 'number' || !Number.isFinite(r) || r < ZONE_RADIUS_KM.min || r > ZONE_RADIUS_KM.max)
      error(`radius-${z.id}`, `Enter the exclusion zone radius in kilometres, from ${ZONE_RADIUS_KM.min} to ${ZONE_RADIUS_KM.max}.`)
  }

  // Access needs follow the person: every required subject answers every question
  const assessments = h.accessAssessments ?? []
  for (const subject of requiredAccessSubjects(h)) {
    const label = subjectLabel(h, subject)
    const a = assessments.find(x => x.subject === subject)
    for (const q of ACCESS_QUESTIONS) {
      const answer = a?.answers[q.key]
      if (answer !== 'yes' && answer !== 'no') error(`access-${subject}-${q.key}`, `Access needs for ${label}: answer “${q.question.toLowerCase()}”.`)
    }
  }
  for (const a of assessments) {
    const label = subjectLabel(h, a.subject)
    if (a.subject !== HOUSEHOLD_SUBJECT && !members.some(m => m.id === a.subject)) {
      error('members', 'Access answers are recorded for someone who is no longer in the household. Remove them or add the person back.')
      continue
    }
    if (a.answers.equipment_or_carer === 'yes')
      warning(
        `access-${a.subject}-equipment_or_carer`,
        `${label} has equipment or a carer that could change the bedroom need. The bedroom count does not include it: check the number of bedrooms yourself.`,
      )
    const person = members.find(m => m.id === a.subject)
    if (person?.wheelchairUser && a.answers.wheelchair_accessible === 'no')
      warning(
        `access-${a.subject}-wheelchair_accessible`,
        `${label} uses a wheelchair but is recorded as not needing a wheelchair-accessible home. Check this is right.`,
      )
  }

  // The same case already has open work
  if (ref) {
    for (const o of context.openCases ?? []) {
      if (o.caseRef.trim().toLowerCase() !== ref.toLowerCase()) continue
      warning(
        'caseRef',
        o.kind === 'placement'
          ? `Case ${ref} already has a placement recorded (decision #${o.seq}, ${formatDate(o.at)}).`
          : `Case ${ref} already has an open search from ${formatDate(o.at)}.`,
        o.kind === 'placement' ? { seq: o.seq } : { searchId: o.searchId },
      )
    }
  }

  return issues
}
