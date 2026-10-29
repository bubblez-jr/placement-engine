import { addDays } from '../engine/dates'
import type { Destination, Household } from '../engine/types'
import { placeById } from './places'

// SYNTHETIC example households. Pseudonymous case references and labels only:
// the council's case system holds identities.

function dest(id: string, personId: string, placeId: string, arriveBy = '08:45', daysPerWeek = 5): Destination {
  const p = placeById(placeId)!
  return { id, personId, kind: p.kind, name: p.name, refId: p.refId, location: p.location, arriveBy, daysPerWeek }
}

export interface Scenario {
  id: string
  title: string
  summary: string
  household: (today: string) => Household
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'brief',
    title: 'Parent and three children, needed tonight',
    summary: "The brief's example: keep the children at their schools. Shows the cheaper option losing on suitability.",
    household: today => ({
      caseRef: 'HN-26-0317',
      members: [
        { id: 'a1', label: 'Adult 1', role: 'adult', age: 34, sex: 'F' },
        { id: 'c1', label: 'Child 1', role: 'child', age: 13, sex: 'F' },
        { id: 'c2', label: 'Child 2', role: 'child', age: 9, sex: 'M' },
        { id: 'c3', label: 'Child 3', role: 'child', age: 4, sex: 'F' },
      ],
      destinations: [dest('d1', 'c1', 'SCH-2'), dest('d2', 'c2', 'SCH-1'), dest('d3', 'c3', 'SCH-1'), dest('d4', 'a1', 'SUP-1', '15:30', 5)],
      homeArea: { lat: 51.548, lng: 0.026 },
      homeAreaLabel: 'Forest Gate, Demo Borough',
      needFrom: today,
      expectedNights: 180,
      accessNeeds: [],
      petsMustBeAccommodated: false,
      flags: [],
      safeguardingZones: [],
      maxHouseholdContributionWeekly: 20,
      notes: 'Eviction from private rented home (section 21 served before 1 May 2026). Grandmother does after-school childcare.',
    }),
  },
  {
    id: 'dialysis',
    title: 'Single adult on dialysis, working',
    summary: 'Treatment three days a week and warehouse shifts. Shows priority flags raising the medical and work weights.',
    household: today => ({
      caseRef: 'HN-26-0402',
      members: [{ id: 'a1', label: 'Adult 1', role: 'adult', age: 52, sex: 'M', employed: true }],
      destinations: [dest('d1', 'a1', 'HOSP-1', '07:30', 3), dest('d2', 'a1', 'WK-3', '13:00', 2)],
      homeArea: { lat: 51.527, lng: 0.02 },
      homeAreaLabel: 'Plaistow, Demo Borough',
      needFrom: addDays(today, 3),
      expectedNights: 120,
      accessNeeds: [],
      petsMustBeAccommodated: false,
      flags: ['ongoing_treatment', 'employment'],
      safeguardingZones: [],
      maxHouseholdContributionWeekly: 15,
      notes: 'Planned move from an emergency hotel placement.',
    }),
  },
  {
    id: 'access',
    title: 'Wheelchair user and two children, fleeing abuse',
    summary: 'Hard access needs, an assistance dog and a safeguarding exclusion zone.',
    household: today => ({
      caseRef: 'HN-26-0388',
      members: [
        { id: 'a1', label: 'Adult 1', role: 'adult', age: 41, sex: 'F', wheelchairUser: true },
        { id: 'c1', label: 'Child 1', role: 'child', age: 11, sex: 'M' },
        { id: 'c2', label: 'Child 2', role: 'child', age: 7, sex: 'M' },
      ],
      destinations: [dest('d1', 'c1', 'SCH-4'), dest('d2', 'c2', 'SCH-6'), dest('d3', 'a1', 'SUP-3', '10:00', 1), dest('d4', 'a1', 'GP-1', '10:00', 1)],
      homeArea: { lat: 51.556, lng: 0.012 },
      homeAreaLabel: 'Demo Borough (restricted)',
      needFrom: today,
      expectedNights: 240,
      accessNeeds: ['wheelchair_accessible', 'adapted_bathroom', 'step_free'],
      petsMustBeAccommodated: true,
      flags: ['domestic_abuse', 'disability'],
      safeguardingZones: [{ id: 'z1', center: { lat: 51.565, lng: -0.01 }, radiusKm: 2 }],
      maxHouseholdContributionWeekly: 10,
      notes: 'Assistance dog. Exclusion zone set on MARAC advice; details held in the case system.',
    }),
  },
  {
    id: 'large',
    title: 'Two adults and five children, exam year',
    summary: 'Scarce four-bedroom supply, a GCSE year and a child at a special school. Shows the education transport cost of far placements.',
    household: today => ({
      caseRef: 'HN-26-0291',
      members: [
        { id: 'a1', label: 'Adult 1', role: 'adult', age: 45, sex: 'M', partnerOf: 'a2', employed: true },
        { id: 'a2', label: 'Adult 2', role: 'adult', age: 42, sex: 'F', partnerOf: 'a1' },
        { id: 'c1', label: 'Child 1', role: 'child', age: 15, sex: 'F', examYear: true },
        { id: 'c2', label: 'Child 2', role: 'child', age: 13, sex: 'M', send: true },
        { id: 'c3', label: 'Child 3', role: 'child', age: 10, sex: 'M' },
        { id: 'c4', label: 'Child 4', role: 'child', age: 6, sex: 'F' },
        { id: 'c5', label: 'Child 5', role: 'child', age: 2, sex: 'F' },
      ],
      destinations: [dest('d1', 'c1', 'SCH-2'), dest('d2', 'c2', 'SCH-5'), dest('d3', 'c3', 'SCH-3'), dest('d4', 'c4', 'SCH-3'), dest('d5', 'a1', 'WK-1', '09:00', 5)],
      homeArea: { lat: 51.551, lng: 0.04 },
      homeAreaLabel: 'Manor Park, Demo Borough',
      needFrom: today,
      expectedNights: 270,
      accessNeeds: [],
      petsMustBeAccommodated: false,
      flags: ['exam_year'],
      safeguardingZones: [],
      maxHouseholdContributionWeekly: 30,
      notes: 'Overcrowded private let; landlord selling.',
    }),
  },
  {
    id: 'outofhours',
    title: 'Pregnant, alone, out of hours',
    summary: 'Needed tonight and nothing self-contained is free. Shows the last-resort rule and the six-week clock.',
    household: today => ({
      caseRef: 'HN-26-0455',
      members: [{ id: 'a1', label: 'Adult 1', role: 'adult', age: 24, sex: 'F', pregnant: true }],
      destinations: [dest('d1', 'a1', 'HOSP-2', '10:00', 1)],
      homeArea: { lat: 51.553, lng: 0.05 },
      homeAreaLabel: 'Demo Borough',
      needFrom: today,
      expectedNights: 56,
      accessNeeds: [],
      petsMustBeAccommodated: false,
      flags: [],
      safeguardingZones: [],
      maxHouseholdContributionWeekly: 15,
      notes: 'Family exclusion at 23:40. Antenatal care at Northside Hospital.',
    }),
  },
]
