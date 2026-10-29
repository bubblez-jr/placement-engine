import { addDays, formatDate, hoursBetween, parseDate } from './dates'
import { haversineKm } from './geo'
import { isFamilyHousehold } from './bedrooms'
import type { ComplianceItem, ComplianceType, GateCheck, Household, IsoDateTime, Property, Ruleset, Supplier } from './types'

// Legal references are what the research found; a solicitor should confirm
// the wording before a pilot (see docs/PILOT-READINESS.md).
export const LAW = {
  suitability: 'Housing Act 1996 s206 and s210; Homelessness Code of Guidance ch.17',
  order2012art3: 'Homelessness (Suitability of Accommodation) (England) Order 2012, art.3',
  bnb2003: 'Homelessness (Suitability of Accommodation) (England) Order 2003 (B&B and shared facilities for families)',
  affordability: 'Homelessness (Suitability of Accommodation) Order 1996 (affordability)',
  space: 'Housing Act 1996 s210; Housing Act 1985 Part 10 (overcrowding)',
  equality: 'Equality Act 2010 (reasonable adjustments); Code of Guidance ch.17',
  procurement: "Council's DPS / framework (Procurement Act 2023)",
  safeguarding: 'Code of Guidance ch.17 (risk of violence or abuse); council safeguarding policy',
  availability: 'Council placement policy',
  sizePolicy: 'Council placement policy (allocation of scarce supply)',
  pets: 'Council placement policy (assistance dogs must always be accommodated)',
  gas: 'Gas Safety (Installation and Use) Regulations 1998; 2012 Order art.3',
  eicr: 'Electrical Safety Standards in the Private Rented Sector (England) Regulations 2020; 2012 Order art.3',
  epc: 'Energy Performance of Buildings Regulations; MEES (band E or better); 2012 Order art.3',
  alarms: 'Smoke and Carbon Monoxide Alarm (England) Regulations 2015 (amended 2022); 2012 Order art.3',
  fire: 'Regulatory Reform (Fire Safety) Order 2005; 2012 Order art.3',
  hmo: 'Housing Act 2004 Part 2 (HMO licensing); 2012 Order art.3',
  inspection: 'Council policy: inspection before first use',
} as const

const COMPLIANCE_LABEL: Record<ComplianceType, string> = {
  gas_safety: 'Gas safety certificate',
  eicr: 'Electrical safety report (EICR)',
  epc: 'Energy performance certificate',
  smoke_co_alarms: 'Smoke and CO alarm check',
  fire_risk: 'Fire risk assessment',
  hmo_licence: 'HMO licence',
  inspection: 'Council inspection',
}

const COMPLIANCE_LAW: Record<ComplianceType, string> = {
  gas_safety: LAW.gas,
  eicr: LAW.eicr,
  epc: LAW.epc,
  smoke_co_alarms: LAW.alarms,
  fire_risk: LAW.fire,
  hmo_licence: LAW.hmo,
  inspection: LAW.inspection,
}

export function complianceLabel(t: ComplianceType): string {
  return COMPLIANCE_LABEL[t]
}

/** Which compliance items a property must hold. */
export function requiredCompliance(p: Property, rs: Ruleset): ComplianceType[] {
  const req: ComplianceType[] = ['eicr', 'epc', 'smoke_co_alarms']
  if (p.hasGas) req.push('gas_safety')
  if (p.isHmo || p.unitType === 'bnb' || p.unitType === 'annex_shared' || p.unitType === 'council_hostel') req.push('fire_risk')
  if (p.isHmo) req.push('hmo_licence')
  if (rs.requireInspection) req.push('inspection')
  return req
}

const EPC_OK = new Set(['A', 'B', 'C', 'D', 'E'])

function block(code: GateCheck['code'], passed: boolean, message: string, legalBasis: string): GateCheck {
  return { code, passed, severity: 'block', message, legalBasis }
}
function warn(code: GateCheck['code'], message: string, legalBasis: string): GateCheck {
  return { code, passed: false, severity: 'warn', message, legalBasis }
}

export function sharedFacilities(p: Property): boolean {
  return !p.selfContained || p.unitType === 'bnb' || p.unitType === 'annex_shared'
}

/**
 * Run every hard gate for one property. Returns all checks (passes included)
 * so the audit pack can show what was tested, not only what failed.
 */
export function runGates(h: Household, p: Property, supplier: Supplier | undefined, rs: Ruleset, bedroomsNeeded: number, now: IsoDateTime): GateCheck[] {
  const checks: GateCheck[] = []
  const decisionDate = h.needFrom
  const stayEnd = addDays(h.needFrom, h.expectedNights)

  // Approved supply only
  checks.push(
    block(
      'SUPPLIER_NOT_APPROVED',
      !!supplier?.approved,
      supplier?.approved
        ? `Supplier ${supplier.name} is on the approved list`
        : `Supplier ${supplier?.name ?? 'unknown'} is not on the council's approved list`,
      LAW.procurement,
    ),
  )

  // Availability
  const availOk = parseDate(p.availableFrom) <= parseDate(decisionDate)
  checks.push(
    block(
      'NOT_AVAILABLE',
      availOk,
      availOk ? `Available from ${formatDate(p.availableFrom)}` : `Not available until ${formatDate(p.availableFrom)}; needed ${formatDate(decisionDate)}`,
      LAW.availability,
    ),
  )
  if (p.availableUntil) {
    const stillOpen = parseDate(p.availableUntil) > parseDate(decisionDate)
    checks.push(
      block(
        'AVAILABILITY_ENDED',
        stillOpen,
        stillOpen ? `Available until ${formatDate(p.availableUntil)}` : `Availability ended ${formatDate(p.availableUntil)}`,
        LAW.availability,
      ),
    )
  }
  const ageHours = hoursBetween(p.availabilityConfirmedAt, now)
  if (ageHours > rs.staleAvailabilityHours) {
    checks.push(
      warn(
        'STALE_AVAILABILITY',
        `Availability last confirmed ${Math.round(ageHours / 24)} days ago by ${p.availabilityConfirmedBy}; ring to confirm before booking`,
        LAW.availability,
      ),
    )
  }

  // Space
  checks.push(
    block(
      'TOO_FEW_BEDROOMS',
      p.bedrooms >= bedroomsNeeded,
      `${p.bedrooms} bedroom${p.bedrooms === 1 ? '' : 's'}; household needs ${bedroomsNeeded}`,
      LAW.space,
    ),
  )
  const maxRooms = bedroomsNeeded + rs.maxExtraBedrooms
  checks.push(
    block(
      'TOO_MANY_BEDROOMS',
      p.bedrooms <= maxRooms,
      p.bedrooms <= maxRooms ? `Size fits the household` : `${p.bedrooms} bedrooms for a household needing ${bedroomsNeeded}: kept for larger households`,
      LAW.sizePolicy,
    ),
  )
  if (p.reservedForAccessNeeds) {
    const needsIt = h.accessNeeds.includes('wheelchair_accessible') || h.accessNeeds.includes('adapted_bathroom')
    checks.push(
      block(
        'RESERVED_ACCESSIBLE',
        needsIt,
        needsIt ? 'Accessible unit, matched to the household’s needs' : 'Accessible unit reserved for households who need its adaptations',
        LAW.sizePolicy,
      ),
    )
  }
  checks.push(block('OVER_CAPACITY', p.maxOccupants >= h.members.length, `Sleeps ${p.maxOccupants}; household of ${h.members.length}`, LAW.space))

  // Access must-haves
  const access: [(typeof h.accessNeeds)[number], GateCheck['code'], boolean, string][] = [
    ['step_free', 'ACCESS_STEP_FREE', p.stepFree, 'Step-free access'],
    ['wheelchair_accessible', 'ACCESS_WHEELCHAIR', p.wheelchairAccessible, 'Wheelchair accessible'],
    ['ground_floor_or_lift', 'ACCESS_GROUND_OR_LIFT', p.floor === 0 || p.lift, 'Ground floor or lift'],
    ['adapted_bathroom', 'ACCESS_ADAPTED_BATHROOM', p.adaptedBathroom, 'Adapted bathroom'],
  ]
  for (const [need, code, ok, label] of access) {
    if (h.accessNeeds.includes(need)) {
      checks.push(block(code, ok, ok ? `${label}: yes` : `${label}: needed, not available`, LAW.equality))
    }
  }

  if (h.petsMustBeAccommodated) {
    checks.push(block('PETS', p.petsAllowed, p.petsAllowed ? 'Pets accepted' : 'Pets not accepted', LAW.pets))
  }

  // Compliance on the decision date
  for (const type of requiredCompliance(p, rs)) {
    const item: ComplianceItem | undefined = p.compliance.find(c => c.type === type)
    const label = COMPLIANCE_LABEL[type]
    if (!item) {
      checks.push(block('COMPLIANCE_MISSING', false, `${label}: no record`, COMPLIANCE_LAW[type]))
      continue
    }
    if (type === 'epc') {
      const ok = !!item.rating && EPC_OK.has(item.rating)
      checks.push(block('EPC_BELOW_E', ok, `EPC band ${item.rating ?? '?'}`, COMPLIANCE_LAW[type]))
    }
    if (item.expires) {
      const valid = parseDate(item.expires) >= parseDate(decisionDate)
      checks.push(
        block(
          'COMPLIANCE_EXPIRED',
          valid,
          valid ? `${label}: valid to ${formatDate(item.expires)}` : `${label}: expired ${formatDate(item.expires)}`,
          COMPLIANCE_LAW[type],
        ),
      )
      if (valid && parseDate(item.expires) < parseDate(stayEnd)) {
        checks.push(warn('COMPLIANCE_EXPIRES_DURING_STAY', `${label} expires ${formatDate(item.expires)}, during the expected stay`, COMPLIANCE_LAW[type]))
      }
    } else {
      checks.push(block('COMPLIANCE_EXPIRED', true, `${label}: on file (${item.evidenceRef})`, COMPLIANCE_LAW[type]))
    }
  }

  // Families and shared facilities
  if (isFamilyHousehold(h.members) && sharedFacilities(p)) {
    checks.push(
      block(
        'SHARED_FACILITIES_FAMILY',
        false,
        `Shared facilities (${p.unitType === 'bnb' ? 'B&B' : 'shared annex'}): unsuitable for a family unless nothing else is available, and then for no more than ${rs.bnbFamilyLimitWeeks} weeks`,
        LAW.bnb2003,
      ),
    )
  }

  // Safeguarding exclusion zones. The reason stays off screen.
  const inZone = h.safeguardingZones.some(z => haversineKm(z.center, p.location) <= z.radiusKm)
  if (h.safeguardingZones.length > 0) {
    checks.push(block('SAFEGUARDING', !inZone, inZone ? 'Inside a safeguarding exclusion zone' : 'Outside safeguarding exclusion zones', LAW.safeguarding))
  }

  // Affordability for the household
  const affordable = p.householdChargeWeekly <= h.maxHouseholdContributionWeekly
  checks.push(
    block(
      'AFFORDABILITY',
      affordable,
      `Household pays £${p.householdChargeWeekly.toFixed(2)}/week in charges; assessed affordable £${h.maxHouseholdContributionWeekly.toFixed(2)}/week`,
      LAW.affordability,
    ),
  )

  return checks
}
