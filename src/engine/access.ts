import type { AccessNeed, AccessQuestion, Household } from './types'

// Access needs follow the person. A wheelchair user (or the household's
// disability flag) opens a set of explicit yes/no questions; the property
// checks use the union of every "yes", and name whose need each one is.

export const HOUSEHOLD_SUBJECT = 'household'

export const ACCESS_NEED_LABEL: Record<AccessNeed, string> = {
  wheelchair_accessible: 'Wheelchair accessible',
  step_free: 'Step-free access',
  ground_floor_or_lift: 'Ground floor or lift',
  adapted_bathroom: 'Adapted bathroom',
}

/** Questions in the order the panel asks them. */
export const ACCESS_QUESTIONS: { key: AccessQuestion; question: string }[] = [
  { key: 'wheelchair_accessible', question: 'Needs a wheelchair-accessible home' },
  { key: 'step_free', question: 'Needs step-free access to the home' },
  { key: 'ground_floor_or_lift', question: 'Needs a ground-floor home or a lift' },
  { key: 'adapted_bathroom', question: 'Needs an adapted bathroom' },
  { key: 'assistance_dog', question: 'Has an assistance dog that lives with the household' },
  { key: 'equipment_or_carer', question: 'Has equipment or a carer that could change the bedroom need' },
]

export const ACCESS_NEEDS: AccessNeed[] = ['wheelchair_accessible', 'step_free', 'ground_floor_or_lift', 'adapted_bathroom']

/**
 * Whose access answers the household must have: every wheelchair user, plus the
 * household as a whole when the disability flag is set and nobody is marked as
 * a wheelchair user.
 */
export function requiredAccessSubjects(h: Household): string[] {
  const people = (Array.isArray(h.members) ? h.members : []).filter(m => m.wheelchairUser).map(m => m.id)
  if ((Array.isArray(h.flags) ? h.flags : []).includes('disability') && people.length === 0) return [HOUSEHOLD_SUBJECT]
  return people
}

export function subjectLabel(h: Household, subject: string): string {
  if (subject === HOUSEHOLD_SUBJECT) return 'The household'
  return h.members.find(m => m.id === subject)?.label ?? 'Someone no longer in the household'
}

export function joinNames(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

export interface EffectiveNeed {
  need: AccessNeed
  /** Whose need it is, by pseudonymous label */
  who: string[]
}

/**
 * The household's effective access needs: the union of every "yes" answer,
 * plus any household-level needs carried from the earlier version.
 */
export function effectiveAccessNeeds(h: Household): EffectiveNeed[] {
  const out: EffectiveNeed[] = []
  for (const need of ACCESS_NEEDS) {
    const who: string[] = []
    for (const a of h.accessAssessments ?? []) if (a.answers[need] === 'yes') who.push(subjectLabel(h, a.subject))
    if ((h.accessNeeds ?? []).includes(need) && !who.includes('The household')) who.push('The household')
    if (who.length) out.push({ need, who })
  }
  return out
}

/** Labels of everyone with an assistance dog. */
export function assistanceDogFor(h: Household): string[] {
  return (h.accessAssessments ?? []).filter(a => a.answers.assistance_dog === 'yes').map(a => subjectLabel(h, a.subject))
}

const NEED_PHRASE: Record<AccessNeed, string> = {
  wheelchair_accessible: 'a wheelchair-accessible home',
  step_free: 'step-free access',
  ground_floor_or_lift: 'a ground floor or a lift',
  adapted_bathroom: 'an adapted bathroom',
}

/** "Adult 1 needs step-free access" */
export function needSentence(n: EffectiveNeed): string {
  return `${joinNames(n.who)} ${n.who.length === 1 ? 'needs' : 'need'} ${NEED_PHRASE[n.need]}`
}
