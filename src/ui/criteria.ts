import type { CriterionKey } from '../engine/types'

export const CRITERIA_ORDER: { key: CriterionKey; label: string }[] = [
  { key: 'school_journey', label: 'School journey' },
  { key: 'work_journey', label: 'Journey to work' },
  { key: 'medical_journey', label: 'Journey to treatment' },
  { key: 'support_journey', label: 'Care or support' },
  { key: 'location_tier', label: 'Location' },
  { key: 'facilities', label: 'Facilities' },
  { key: 'condition', label: 'Condition' },
  { key: 'stability', label: 'Covers the stay' },
]

export const UNIT_LABEL = {
  self_contained_nightly: 'Self-contained, nightly paid',
  psl: 'Private sector lease',
  council_hostel: 'Council hostel',
  annex_shared: 'Shared annex',
  bnb: 'Bed and breakfast',
} as const

export const BUDGET_LABEL = { ta_budget: 'TA budget', education: 'Education', household: 'Household' } as const
