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
  /** Opens the access needs questions for this person (see `accessAssessments`) */
  wheelchairUser?: boolean
}

// ---------- People who use the system ----------

export type StaffRole = 'ta_officer' | 'ooh_officer' | 'team_manager' | 'head_of_service' | 'compliance_officer' | 'auditor' | 'admin'

export interface StaffUser {
  id: string
  name: string
  role: StaffRole
  team: string
}

/** Who did something, as frozen into a record: always the signed-in person, never a form field. */
export interface ActorRef {
  userId: string
  name: string
  role: StaffRole
  /** The role as shown to people when the record was made */
  roleLabel: string
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

/** The questions an access needs panel asks: the four needs, plus two that change other checks. */
export type AccessQuestion = AccessNeed | 'assistance_dog' | 'equipment_or_carer'

export type YesNo = 'yes' | 'no'

/**
 * One person's (or the household's) access answers. Each question needs an
 * explicit yes or no; nothing is pre-selected. The gates use the union of the
 * "yes" answers, so a declared need cannot be ignored.
 */
export interface AccessAssessment {
  /** A member id, or 'household' when the household's disability flag opened the panel */
  subject: string
  answers: Partial<Record<AccessQuestion, YesNo>>
  /** What the equipment or carer is, when that answer is yes */
  note?: string
  answeredBy?: ActorRef
  answeredAt?: IsoDateTime
}

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
  /**
   * Household-level needs from the earlier version (schema 1), when access was
   * a separate tick-box list. Still applied so old or imported data is never
   * silently ignored; new households use `accessAssessments`.
   */
  accessNeeds: AccessNeed[]
  /** Access answers per person (or the household). Absent in schema-1 records. */
  accessAssessments?: AccessAssessment[]
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
  /**
   * Holds, approvals, the B&B ladder and task reminders. Absent on policy
   * versions published before phase 2: `placementPolicyOf()` reads those with
   * the defaults, and the published version itself is never changed.
   */
  placement?: PlacementPolicy
  signOff: {
    by: string
    role: string
    at: IsoDateTime
    equalityNote: string
    /** The signed-in person who published this version (absent on the seeded version and schema-1 data) */
    actor?: ActorRef
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
  | 'ALREADY_BOOKED'

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
  /** Warnings about the household details, frozen at search time. Absent in schema-1 records. */
  validation?: Issue[]
  /** Who ran the search. Absent in schema-1 records. */
  searchedBy?: ActorRef
}

/** A problem with entered or imported data. `path` is the form control id the officer fixes it in. */
export interface Issue {
  path: string
  message: string
  severity: 'error' | 'warning'
  /** Optional pointer to related work, e.g. an open search for the same case */
  link?: { searchId?: string; seq?: number }
}

export type OverrideReason =
  | 'household_preference'
  | 'information_not_in_system'
  | 'supplier_unavailable'
  | 'safeguarding_advice'
  | 'reasonable_adjustment'
  | 'manager_instruction'
  | 'other'

export type ConsentStatus = 'given' | 'refused' | 'not_asked'
export type ConsentMethod = 'in_person' | 'phone' | 'written'

/**
 * Consent to tell the children's school, GP and health visitor about the
 * placement (Housing Act 1996 s213AA). Recorded by an officer who actually
 * asked; never assumed. A later change is a new chain event, not an edit.
 */
export interface ConsentRecord {
  status: ConsentStatus
  /** Label of the adult who gave or refused consent ("Adult 1"); given and refused only */
  givenBy?: string
  /** How it was asked; given and refused only */
  method?: ConsentMethod
  /** Why it has not been asked yet; not_asked only */
  reason?: string
  note?: string
  recordedBy: ActorRef
  recordedAt: IsoDateTime
}

interface DecisionBase {
  outcome: 'accepted' | 'override' | 'no_suitable'
  chosenPropertyId: string | null
  overrideReason?: OverrideReason
  reasonText: string
  decidedAt: IsoDateTime
  /** What the officer saw before deciding: the record of meaningful human review */
  reviewed: {
    resultsOpenedAt: IsoDateTime
    propertiesOpened: string[]
    comparisonOpened: boolean
    confirmedFullListReviewed: boolean
  }
  startDate: IsoDate
}

/** As sealed by schema 1 (`placement-decision/1`): free-text officer and a tick-box consent. Read only. */
export interface DecisionV1 extends DecisionBase {
  officer: string
  officerRole: string
  consentToNotifyServices: boolean
}

/** As sealed from V2 (`placement-decision/2`): the signed-in actor and a recorded consent. */
export interface DecisionV2 extends DecisionBase {
  decidedBy: ActorRef
  /** null when the household has no children, so s213AA does not apply */
  consent: ConsentRecord | null
}

export type Decision = DecisionV1 | DecisionV2

export function isDecisionV2(d: Decision): d is DecisionV2 {
  return 'decidedBy' in d
}

export interface StatutoryClock {
  key: string
  label: string
  due: IsoDate
  basis: string
  status: 'open' | 'done'
}

// ---------- Placements, approvals and tasks (phase 2) ----------

/** Situations where a decision needs a manager's approval before the household moves in. */
export type ExceptionKind = 'shared_family' | 'out_of_area' | 'not_recommended' | 'beyond_bnb_limit' | 'no_suitable'

export interface PlacementPolicy {
  /** How long a property is held for a decision before the provider must confirm it */
  holdHours: number
  /** A task to confirm with the provider appears this many hours before the hold ends */
  holdWarningHours: number
  /** Which exceptions need a manager's approval. A family in shared accommodation always does. */
  approvalExceptions: ExceptionKind[]
  /** Move-on review for a family in shared accommodation, every this many days */
  bnbReviewEveryDays: number
  /** Day of the stay on which the team manager is brought in */
  bnbManagerDay: number
  /** Day of the stay from which the move is urgent (one week left of six) */
  bnbUrgentDay: number
  /** UK time on the next working day by which an out-of-hours placement must be approved, HH:MM */
  outOfHoursApprovalBy: string
  /** A task counts as due soon this many hours before it is due */
  taskDueSoonHours: number
  /** An overdue task is escalated to the manager after this many days */
  taskEscalateAfterDays: number
  /** Certificates expiring within this many days on any property become a task */
  certificateWarningDays: number
  /** A task to arrange the move or an extension appears this many days before a stay or availability ends */
  stayEndWarningDays: number
}

export type PlacementState = 'held' | 'provider_confirmed' | 'offered' | 'accepted' | 'checked_in' | 'moved_out' | 'refused' | 'cancelled' | 'hold_expired'

export type PlacementAction = 'confirm_provider' | 'offer' | 'accept' | 'refuse' | 'check_in' | 'move_out' | 'cancel'

export type OfferMethod = 'in_person' | 'phone' | 'written'

export type MoveOutDestination = 'settled_home' | 'other_ta' | 'left' | 'other'

export type EmergencyReason = 'no_self_contained' | 'out_of_hours' | 'immediate_safeguarding' | 'medical_nearby' | 'other'

export type MoveOnRoute = 'self_contained_ta' | 'leased_property' | 'social_housing' | 'private_rented' | 'supported_housing' | 'other'

/** A named person, as frozen into a record (owners of plans and tasks). */
export interface PersonRef {
  userId: string
  name: string
  role: StaffRole
}

/** Why a family is going into shared accommodation, in the officer's words. */
export interface EmergencyRecord {
  reasonCode: EmergencyReason
  reasonText: string
}

/** How the family gets out of shared accommodation, and who owns that. */
export interface MoveOnPlan {
  targetDate: IsoDate
  route: MoveOnRoute
  routeNote?: string
  owner: PersonRef
}

/**
 * What applied to a decision when it was sealed (from phase 2). Kept in the
 * record as evidence of what the officer was told, so a later change to the
 * code or the policy cannot change how an old decision reads.
 */
export interface DecisionTerms {
  exceptions: ExceptionKind[]
  approvalRequired: boolean
  placement: {
    holdHours: number
    holdUntil: IsoDateTime
    plannedEnd: IsoDate
    /** Family in shared accommodation: the six-week limit applies */
    sixWeekRule: boolean
    limitDays: number
    emergency?: EmergencyRecord
    moveOnPlan?: MoveOnPlan
  } | null
}

/** What each step of a placement records. Who and when come from the chain event. */
export type TransitionDetails =
  | { action: 'confirm_provider'; contactName: string; providerReference: string }
  | { action: 'offer'; method: OfferMethod; note?: string }
  | { action: 'accept'; note?: string }
  | { action: 'refuse'; householdReason: string }
  | { action: 'check_in'; checkedInOn: IsoDate }
  | { action: 'move_out'; movedOutOn: IsoDate; reason: string; destination: MoveOutDestination; destinationNote?: string }
  | { action: 'cancel'; reason: string }

/** Who a task belongs to: a named person, or a role's shared queue. */
export type TaskOwner = { kind: 'user'; userId: string; name: string; role: StaffRole } | { kind: 'role'; role: StaffRole }

/**
 * A later fact about a sealed decision (or, for supply tasks, a property).
 * Sealed as `placement-event/1`. Nothing sealed is ever edited: a change is a
 * new record that points back to the one it is about.
 */
export type PlacementEventBody =
  | { type: 'consent_updated'; consent: ConsentRecord; previous: ConsentRecord | { legacyConsentToNotify: boolean } | null }
  | { type: 'placement_transition'; placementId: string; from: PlacementState; to: PlacementState; details: TransitionDetails }
  | { type: 'stay_extended'; placementId: string; previousEnd: IsoDate; newEnd: IsoDate; reason: string }
  | { type: 'approval'; outcome: 'approved' | 'rejected'; exceptions: ExceptionKind[]; reason: string }
  | {
      type: 'approval_deferred'
      exceptions: ExceptionKind[]
      reason: string
      /** When the manager's approval task falls due: the next working day at the policy's time */
      approveBy: IsoDateTime
      /** True if this route was used during working hours: shown so a manager can see it */
      duringWorkingHours: boolean
    }
  | { type: 'task_completed'; taskId: string; title: string; evidence: string; reference: string }
  | { type: 'task_reassigned'; taskId: string; title: string; from: TaskOwner; to: TaskOwner; note: string }
  | { type: 'task_cancelled'; taskId: string; title: string; reason: string }

/** A sealed event as the engine sees it: who, when, what. */
export interface EventFact {
  seq: number
  at: IsoDateTime
  actor: ActorRef
  body: PlacementEventBody
}
