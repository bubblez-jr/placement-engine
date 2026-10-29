import { addDays, daysBetween } from './dates'
import { isFamilyHousehold } from './bedrooms'
import type { Decision, Household, Property, Ruleset, StatutoryClock } from './types'
import { sharedFacilities } from './gates'

/**
 * Statutory clocks that start when a placement begins. The legal references
 * are what the research found; a solicitor should confirm them before a pilot.
 */
export function statutoryClocks(h: Household, p: Property, rs: Ruleset, d: Decision): StatutoryClock[] {
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
    clocks.push({
      key: 's213aa',
      label: d.consentToNotifyServices
        ? "Notify the children's school(s), GP and health visitor"
        : 'Ask again for consent to notify school, GP and health visitor',
      due: addDays(start, 14),
      basis: 'Housing Act 1996 s213AA (Children’s Wellbeing and Schools Act 2026), in force 1 Sep 2026: notify within 14 days, with consent',
      status: 'open',
    })
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
