// Domain types for the placement engine.
// Field names follow the legal tests they serve; see docs/DATA-MODEL.md.

export type IsoDate = string // YYYY-MM-DD
export type IsoDateTime = string // full ISO timestamp

export interface LatLng {
  lat: number
  lng: number
}

// ---------- Household ----------

export type Sex = 'F' | 'M' | 'X'

export interface Person {
  id: string
  /** Pseudonymous label shown on screen, e.g. "Adult 1", "Child 2". No names. */
  label: string
  role: 'adult' | 'child'
  age: number
  sex: Sex
  /** id of this person's partner, for the bedroom standard */
  partnerOf?: string
  pregnant?: boolean
  /** In a GCSE / A-level exam year */
  examYear?: boolean
  /** Special educational needs (affects home-to-school transport) */
  send?: boolean
  employed?: boolean
  wheelchairUser?: boolean
}

export type DestinationKind = 'school' | 'work' | 'medical' | 'care' | 'support'

export interface Destination {
  id: string
  personId: string
  kind: DestinationKind
  name: string
  /** e.g. a school URN or GP ODS code. Synthetic in the demo. */
  refId?: string
  location: LatLng
  /** Arrive-by time used for journey planning, HH:MM */
  arriveBy: string
  daysPerWeek: number
}

export type AccessNeed = 'step_free' | 'wheelchair_accessible' | 'ground_floor_or_lift' | 'adapted_bathroom'

export type PriorityFlag = 'child_protection_plan' | 'exam_year' | 'ongoing_treatment' | 'employment' | 'caring_duties' | 'domestic_abuse' | 'disability'

export interface SafeguardingZone {
  id: string
  center: LatLng
  radiusKm: number
}

export interface Household {
  /** Pseudonymous case reference. The case system holds the identity. */
  caseRef: string
  members: Person[]
  destinations: Destination[]
  /** Approximate area of the last settled address (used for distance and location tier) */
  homeArea: LatLng
  homeAreaLabel: string
  needFrom: IsoDate
  expectedNights: number
  accessNeeds: AccessNeed[]
  petsMustBeAccommodated: boolean
  flags: PriorityFlag[]
  safeguardingZones: SafeguardingZone[]
  /** Most the household can pay per week towards charges housing benefit does not cover */
  maxHouseholdContributionWeekly: number
  notes?: string
}

// ---------- Supply ----------

export type UnitType = 'self_contained_nightly' | 'psl' | 'council_hostel' | 'annex_shared' | 'bnb'

export type ComplianceType = 'gas_safety' | 'eicr' | 'epc' | 'smoke_co_alarms' | 'fire_risk' | 'hmo_licence' | 'inspection'

export interface ComplianceItem {
  type: ComplianceType
  issued?: IsoDate
  expires?: IsoDate
  /** EPC band A–G */
  rating?: string
  evidenceRef: string
}

export interface Supplier {
  id: string
  name: string
  /** On the council's DPS or framework: only these can be booked */
  approved: boolean
}

export interface Property {
  id: string
  uprn: string
  label: string
  address: string
  postcode: string
  location: LatLng
  district: string
  /** Broad Rental Market Area, for the housing benefit subsidy calculation */
  brma: string
  inLondon: boolean
  supplierId: string
  unitType: UnitType
  selfContained: boolean
  bedrooms: number
  maxOccupants: number
  floor: number
  lift: boolean
  stepFree: boolean
  wheelchairAccessible: boolean
  adaptedBathroom: boolean
  petsAllowed: boolean
  hasGas: boolean
  isHmo: boolean
  inspectionGrade?: 'A' | 'B' | 'C'
  /** Accessible unit ring-fenced for households who need its adaptations */
  reservedForAccessNeeds?: boolean
  /** Nightly charge to the council, £ */
  nightlyCharge: number
  /** Weekly charges the household pays that housing benefit does not cover (meals, utilities), £ */
  householdChargeWeekly: number
  availableFrom: IsoDate
  availableUntil?: IsoDate
  availabilityConfirmedAt: IsoDateTime
  availabilityConfirmedBy: string
  compliance: ComplianceItem[]
}

// ---------- Rule-set (the council's placement policy, versioned) ----------

export type CriterionKey =
  | 'school_journey'
  | 'work_journey'
  | 'medical_journey'
  | 'support_journey'
  | 'location_tier'
  | 'facilities'
  | 'condition'
  | 'stability'

/** Piecewise-linear value function: [x, value 0..1] points, sorted by x */
export type Breakpoints = [number, number][]

export interface CriterionConfig {
  key: CriterionKey
  label: string
  /** Which legal factor this criterion evidences */
  legalFactor: string
  /** Base weight; weights are renormalised to sum to 100 */
  weight: number
  /** For journey criteria: minutes → value. For tier: tier → value. */
  breakpoints?: Breakpoints
}

export interface PriorityMultiplier {
  flag: PriorityFlag
  criterion: CriterionKey
  multiplier: number
}

export interface Ruleset {
  id: string
  version: string
  name: string
  councilName: string
  effectiveFrom: IsoDate
  homeDistrict: string
  adjacentDistricts: string[]
  /** Public transport minutes from the home area that counts as "within reach" (tier 3) */
  tierTravelLimitMins: number
  staleAvailabilityHours: number
  /** Most bedrooms above need before a home counts as too large (keeps big homes for big families) */
  maxExtraBedrooms: number
  requireInspection: boolean
  criteria: CriterionConfig[]
  priorityMultipliers: PriorityMultiplier[]
  facilitiesValues: Record<'self_contained' | 'shared_kitchen' | 'shared_all', number>
  conditionValues: Record<'A' | 'B' | 'C' | 'unknown', number>
  /** Suitability points within which the lower public cost picks between options */
  costTieBreakBand: number
  subsidy: {
    /** Share of the January 2011 LHA rate that subsidy covers (0.9) */
    rate: number
    weeklyCapInnerLondon: number
    weeklyCapElsewhere: number
    innerLondonBrmas: string[]
    /** January 2011 LHA weekly rates by BRMA and bedroom size (1–4) */
    lhaJan2011Weekly: Record<string, Record<'1' | '2' | '3' | '4', number>>
    /** Where the figures came from, shown on screen */
    source: string
  }
  schoolTransport: {
    /** Who pays for a child's travel to their existing school after a move */
    funding: 'council_discretionary' | 'family'
    budgetHolder: string
    /** Council funds travel only above this journey time */
    fundIfMinutesOver: number
    busFarePerChildDay: number
    sendTaxiPerKm: number
  }
  bnbFamilyLimitWeeks: number
  signOff: {
    by: string
    role: string
    at: IsoDateTime
    equalityNote: string
  }
  /** SHA-256 of the canonical rule-set without this field */
  hash?: string
}

// ---------- Engine output ----------

export type GateCode =
  | 'NOT_AVAILABLE'
  | 'AVAILABILITY_ENDED'
  | 'STALE_AVAILABILITY'
  | 'TOO_FEW_BEDROOMS'
  | 'TOO_MANY_BEDROOMS'
  | 'RESERVED_ACCESSIBLE'
  | 'OVER_CAPACITY'
  | 'ACCESS_STEP_FREE'
  | 'ACCESS_WHEELCHAIR'
  | 'ACCESS_GROUND_OR_LIFT'
  | 'ACCESS_ADAPTED_BATHROOM'
  | 'PETS'
  | 'COMPLIANCE_MISSING'
  | 'COMPLIANCE_EXPIRED'
  | 'COMPLIANCE_EXPIRES_DURING_STAY'
  | 'EPC_BELOW_E'
  | 'SHARED_FACILITIES_FAMILY'
  | 'SAFEGUARDING'
  | 'AFFORDABILITY'
  | 'SUPPLIER_NOT_APPROVED'

export interface GateCheck {
  code: GateCode
  passed: boolean
  /** block = removes the option; warn = shown to the officer, option stays */
  severity: 'block' | 'warn'
  message: string
  legalBasis: string
}

export interface JourneyResult {
  destinationId: string
  personId: string
  kind: DestinationKind
  name: string
  minutes: number | null
  distanceKm: number
}

export interface CriterionScore {
  key: CriterionKey
  label: string
  legalFactor: string
  applicable: boolean
  /** Raw measure, e.g. 51 (minutes) or 2 (tier) */
  raw: number | null
  rawLabel: string
  value: number
  weight: number
  contribution: number
}

export type BudgetHolder = 'ta_budget' | 'education' | 'household'

export interface CostLine {
  key: string
  label: string
  budgetHolder: BudgetHolder
  perUnit: number
  unit: 'night' | 'school day'
  stayTotal: number
  basis: string
}

export interface CostBreakdown {
  nightlyCharge: number
  subsidyPerNight: number
  subsidyBasis: string
  taNetPerNight: number
  lines: CostLine[]
  stayNights: number
  schoolDaysInStay: number
  taBudgetStay: number
  educationStay: number
  householdStay: number
  /** TA net + other public budgets, per night equivalent */
  publicPerNight: number
  publicStay: number
  risks: string[]
}

export interface Candidate {
  propertyId: string
  label: string
  district: string
  tier: 1 | 2 | 3 | 4
  checks: GateCheck[]
  blocks: GateCheck[]
  warnings: GateCheck[]
  eligible: boolean
  /** Shared-facility option admitted only because nothing else passed */
  lastResort: boolean
  journeys: JourneyResult[]
  homeAreaMinutes: number | null
  criteria: CriterionScore[]
  score: number
  cost: CostBreakdown
  rank?: number
  pareto?: boolean
}

export interface SensitivityFlip {
  criterion: CriterionKey
  change: '-20%' | '+20%'
  newRecommendationId: string
}

export interface Explanation {
  headline: string
  reasons: string[]
  cost: string[]
  caveats: string[]
}

export interface SearchResult {
  id: string
  createdAt: IsoDateTime
  household: Household
  rulesetId: string
  rulesetVersion: string
  rulesetHash: string
  travelProvider: { id: string; label: string; disclaimer: string; assumptions: string }
  bedroomNeed: number
  effectiveWeights: Record<CriterionKey, number>
  candidates: Candidate[]
  recommendedId: string | null
  topScoreId: string | null
  tieBreakApplied: boolean
  sensitivity: { status: 'robust' | 'close_call' | 'n/a'; flips: SensitivityFlip[] }
  explanation: Explanation
  dataVersions: { properties: string; reference: string }
}

export type OverrideReason =
  | 'household_preference'
  | 'information_not_in_system'
  | 'supplier_unavailable'
  | 'safeguarding_advice'
  | 'reasonable_adjustment'
  | 'manager_instruction'
  | 'other'

export interface Decision {
  outcome: 'accepted' | 'override' | 'no_suitable'
  chosenPropertyId: string | null
  overrideReason?: OverrideReason
  reasonText: string
  officer: string
  officerRole: string
  decidedAt: IsoDateTime
  /** What the officer saw before deciding: the record of meaningful human review */
  reviewed: {
    resultsOpenedAt: IsoDateTime
    propertiesOpened: string[]
    comparisonOpened: boolean
    confirmedFullListReviewed: boolean
  }
  startDate: IsoDate
  consentToNotifyServices: boolean
}

export interface StatutoryClock {
  key: string
  label: string
  due: IsoDate
  basis: string
  status: 'open' | 'done'
}
