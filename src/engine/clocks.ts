import { addDays, daysBetween } from './dates'
import { isFamilyHousehold } from './bedrooms'
import type { DecisionV2, Household, Property, Ruleset, StatutoryClock } from './types'
import { sharedFacilities } from './gates'

/** Days after the start by which an officer should ask for consent that was not asked at placement. */
export const CONSENT_FOLLOW_UP_DAYS = 7

export const S213AA_BASIS = 'Housing Act 1996 s213AA (Children’s Wellbeing and Schools Act 2026), in force 1 Sep 2026: notify within 14 days, with consent'

/**
 * Statutory clocks that start when a placement begins. The legal references
 * are what the research found; a solicitor should confirm them before a pilot.
 * Schema-1 records keep the clocks they were sealed with; this builds new ones.
 */
export function statutoryClocks(h: Household, p: Property, rs: Ruleset, d: DecisionV2): StatutoryClock[] {
  const start = d.startDate
  const clocks: StatutoryClock[] = []
  if (p.district !== rs.homeDistrict) {
    clocks.push({
      key: 's208',
      label: `Notify ${p.district} of the placement`,
      due: addDays(start, 14),
      basis: 'Housing Act 1996 s208: notice to the receiving authority within 14 days',
      status: 'open',
    })
  }
  if (isFamilyHousehold(h.members) && sharedFacilities(p)) {
    clocks.push({
      key: 'bnb-limit',
      label: 'Move the family out of shared accommodation',
      due: addDays(start, rs.bnbFamilyLimitWeeks * 7),
      basis: `Homelessness (Suitability of Accommodation) (England) Order 2003: no more than ${rs.bnbFamilyLimitWeeks} weeks`,
      status: 'open',
    })
  }
  if (h.members.some(m => m.role === 'child')) {
    const consent = d.consent?.status ?? 'not_asked'
    if (consent === 'not_asked') {
      // Until tasks arrive (phase 2), the follow-up is a clock inside the s213AA window.
      clocks.push({
        key: 'consent-follow-up',
        label: 'Ask a parent for consent to notify the school, GP and health visitor',
        due: addDays(start, CONSENT_FOLLOW_UP_DAYS),
        basis: `Council practice: ask within ${CONSENT_FOLLOW_UP_DAYS} days so the s213AA notice can still go within 14 days`,
        status: 'open',
      })
    }
    if (consent !== 'refused') {
      clocks.push({
        key: 's213aa',
        label:
          consent === 'given'
            ? "Notify the children's school(s), GP and health visitor"
            : "Notify the children's school(s), GP and health visitor, if consent is given",
        due: addDays(start, 14),
        basis: S213AA_BASIS,
        status: 'open',
      })
    }
  }
  clocks.push({
    key: 's202',
    label: 'Last day for the household to ask for a suitability review',
    due: addDays(start, 21),
    basis: 'Housing Act 1996 s202: review request within 21 days of the decision',
    status: 'open',
  })
  if (p.availableUntil && daysBetween(start, p.availableUntil) < h.expectedNights) {
    clocks.push({
      key: 'availability-ends',
      label: 'Availability ends: arrange the next move',
      due: p.availableUntil,
      basis: 'Supplier availability on file',
      status: 'open',
    })
  }
  return clocks.sort((a, b) => a.due.localeCompare(b.due))
}
