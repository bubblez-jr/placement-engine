import type { ComplianceItem, Property, UnitType } from '../engine/types'

// CSV import for the council's own stock or an export from its booking
// platform. One row per unit, keyed on UPRN. Certificates are given as
// expiry dates; a blank date means "no record".

export const CSV_COLUMNS = [
  'id',
  'uprn',
  'label',
  'address',
  'postcode',
  'lat',
  'lng',
  'district',
  'brma',
  'in_london',
  'supplier_id',
  'unit_type',
  'bedrooms',
  'max_occupants',
  'floor',
  'lift',
  'step_free',
  'wheelchair',
  'adapted_bathroom',
  'pets_allowed',
  'has_gas',
  'is_hmo',
  'grade',
  'nightly',
  'household_weekly',
  'available_from',
  'available_until',
  'gas_expires',
  'eicr_expires',
  'epc_band',
  'inspected',
] as const

const UNIT_TYPES: UnitType[] = ['self_contained_nightly', 'psl', 'council_hostel', 'annex_shared', 'bnb']

function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim())
}

const bool = (v: string) => /^(y|yes|true|1)$/i.test(v)
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

export interface CsvResult {
  properties: Property[]
  errors: string[]
}

export function parsePropertiesCsv(text: string, nowIso: string, confirmedBy: string): CsvResult {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return { properties: [], errors: ['The file needs a header row and at least one property.'] }
  const header = splitLine(lines[0]).map(h => h.toLowerCase())
  const missing = ['id', 'label', 'lat', 'lng', 'district', 'brma', 'bedrooms', 'nightly', 'available_from'].filter(c => !header.includes(c))
  if (missing.length) return { properties: [], errors: [`Missing columns: ${missing.join(', ')}.`] }
  const properties: Property[] = []
  const errors: string[] = []
  lines.slice(1).forEach((line, idx) => {
    const cells = splitLine(line)
    const get = (c: string) => cells[header.indexOf(c)] ?? ''
    const rowNo = idx + 2
    const lat = Number(get('lat'))
    const lng = Number(get('lng'))
    const bedrooms = Number(get('bedrooms'))
    const nightly = Number(get('nightly'))
    const unitType = (get('unit_type') || 'self_contained_nightly') as UnitType
    const problems: string[] = []
    if (!get('id')) problems.push('id is blank')
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) problems.push('lat/lng not valid')
    if (!Number.isInteger(bedrooms) || bedrooms < 0) problems.push('bedrooms not a whole number')
    if (!Number.isFinite(nightly) || nightly <= 0) problems.push('nightly charge not valid')
    if (!UNIT_TYPES.includes(unitType)) problems.push(`unit_type must be one of ${UNIT_TYPES.join(', ')}`)
    if (!date(get('available_from'))) problems.push('available_from must be YYYY-MM-DD')
    if (problems.length) {
      errors.push(`Row ${rowNo}: ${problems.join('; ')}.`)
      return
    }
    const compliance: ComplianceItem[] = []
    const id = get('id')
    if (date(get('gas_expires'))) compliance.push({ type: 'gas_safety', expires: get('gas_expires'), evidenceRef: `GS-${id}` })
    if (date(get('eicr_expires'))) compliance.push({ type: 'eicr', expires: get('eicr_expires'), evidenceRef: `EICR-${id}` })
    if (get('epc_band')) compliance.push({ type: 'epc', rating: get('epc_band').toUpperCase(), evidenceRef: `EPC-${id}` })
    compliance.push({ type: 'smoke_co_alarms', evidenceRef: `ALM-${id}` })
    const isHmo = bool(get('is_hmo'))
    if (isHmo || unitType === 'bnb' || unitType === 'annex_shared') compliance.push({ type: 'fire_risk', evidenceRef: `FRA-${id}` })
    if (isHmo) compliance.push({ type: 'hmo_licence', evidenceRef: `HMO-${id}` })
    if (bool(get('inspected'))) compliance.push({ type: 'inspection', evidenceRef: `INSP-${id}` })
    const grade = get('grade').toUpperCase()
    properties.push({
      id,
      uprn: get('uprn') || id,
      label: get('label'),
      address: get('address') || get('label'),
      postcode: get('postcode'),
      location: { lat, lng },
      district: get('district'),
      brma: get('brma'),
      inLondon: get('in_london') ? bool(get('in_london')) : true,
      supplierId: get('supplier_id') || 'SUP-NL',
      unitType,
      selfContained: unitType !== 'bnb' && unitType !== 'annex_shared',
      bedrooms,
      maxOccupants: Number(get('max_occupants')) || bedrooms * 2,
      floor: Number(get('floor')) || 0,
      lift: bool(get('lift')),
      stepFree: bool(get('step_free')),
      wheelchairAccessible: bool(get('wheelchair')),
      adaptedBathroom: bool(get('adapted_bathroom')),
      petsAllowed: bool(get('pets_allowed')),
      hasGas: get('has_gas') ? bool(get('has_gas')) : unitType !== 'bnb',
      isHmo,
      inspectionGrade: grade === 'A' || grade === 'B' || grade === 'C' ? grade : undefined,
      nightlyCharge: nightly,
      householdChargeWeekly: Number(get('household_weekly')) || 0,
      availableFrom: get('available_from'),
      availableUntil: date(get('available_until')),
      availabilityConfirmedAt: nowIso,
      availabilityConfirmedBy: confirmedBy,
      compliance,
    })
  })
  return { properties, errors }
}

export function propertiesToCsv(props: Property[]): string {
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const exp = (p: Property, t: string) => p.compliance.find(c => c.type === t)?.expires ?? ''
  const rows = props.map(p =>
    [
      p.id,
      p.uprn,
      p.label,
      p.address,
      p.postcode,
      p.location.lat,
      p.location.lng,
      p.district,
      p.brma,
      p.inLondon ? 'yes' : 'no',
      p.supplierId,
      p.unitType,
      p.bedrooms,
      p.maxOccupants,
      p.floor,
      p.lift ? 'yes' : 'no',
      p.stepFree ? 'yes' : 'no',
      p.wheelchairAccessible ? 'yes' : 'no',
      p.adaptedBathroom ? 'yes' : 'no',
      p.petsAllowed ? 'yes' : 'no',
      p.hasGas ? 'yes' : 'no',
      p.isHmo ? 'yes' : 'no',
      p.inspectionGrade ?? '',
      p.nightlyCharge,
      p.householdChargeWeekly,
      p.availableFrom,
      p.availableUntil ?? '',
      exp(p, 'gas_safety'),
      exp(p, 'eicr'),
      p.compliance.find(c => c.type === 'epc')?.rating ?? '',
      p.compliance.some(c => c.type === 'inspection') ? 'yes' : 'no',
    ]
      .map(esc)
      .join(','),
  )
  return [CSV_COLUMNS.join(','), ...rows].join('\n')
}
