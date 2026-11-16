import type { ExceptionKind, PlacementPolicy, Ruleset } from './types'

// Placement, approval and task parameters. They are part of the council's
// versioned policy; these are the defaults the spec sets.

export const ALL_EXCEPTIONS: ExceptionKind[] = ['shared_family', 'out_of_area', 'not_recommended', 'beyond_bnb_limit', 'no_suitable']

export const DEFAULT_PLACEMENT_POLICY: PlacementPolicy = {
  holdHours: 24,
  holdWarningHours: 4,
  approvalExceptions: ALL_EXCEPTIONS,
  bnbReviewEveryDays: 7,
  bnbManagerDay: 28,
  bnbUrgentDay: 35,
  outOfHoursApprovalBy: '10:00',
  taskDueSoonHours: 24,
  taskEscalateAfterDays: 2,
  certificateWarningDays: 60,
  stayEndWarningDays: 14,
}

/**
 * The placement parameters of a policy version. A version published before
 * phase 2 has none, and is read with the defaults; it is never rewritten.
 */
export function placementPolicyOf(rs: Pick<Ruleset, 'placement'>): PlacementPolicy {
  return { ...DEFAULT_PLACEMENT_POLICY, ...(rs.placement ?? {}) }
}

/** Days a family may stay in B&B or shared accommodation: the six-week limit. */
export function bnbLimitDays(rs: Pick<Ruleset, 'bnbFamilyLimitWeeks'>): number {
  return rs.bnbFamilyLimitWeeks * 7
}

export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  shared_family: 'A family in B&B or shared accommodation (last resort)',
  out_of_area: 'Out of area (tier 4)',
  not_recommended: 'Not the recommended option',
  beyond_bnb_limit: 'Planned stay beyond the six-week limit for shared accommodation',
  no_suitable: 'No suitable option found',
}
