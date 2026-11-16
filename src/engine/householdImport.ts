import { ACCESS_QUESTIONS, HOUSEHOLD_SUBJECT } from './access'
import type { AccessAssessment, AccessQuestion, Destination, DestinationKind, Household, LatLng, Person, PriorityFlag, SafeguardingZone, YesNo } from './types'

// Reading a household from a case system file (`placement-household/1`,
// documented in docs/INTEGRATION.md). This only reads: it never searches. The
// household then goes into the normal form, where `validateHousehold` (the
// same check `runSearch` enforces) shows what is missing or wrong.
//
// Nothing is dropped silently. Every field is either read, or reported as not
// understood with its path. A value of the wrong type is reported and left
// for the officer to enter; a value of the right type that breaks a rule
// (a negative age) is kept, so the form flags it.

export const HOUSEHOLD_FORMAT = 'placement-household/1'

export interface ImportNote {
  path: string
  note: string
}

export interface HouseholdImport {
  /** null when the file could not be read at all */
  household: Household | null
  /** Problems that stopped the import */
  problems: string[]
  /** What was read, as short lines for the officer */
  read: string[]
  /** Fields not understood, or not imported, with why */
  notUnderstood: ImportNote[]
  source: { system?: string; exportedAt?: string }
}

const KINDS: DestinationKind[] = ['school', 'work', 'medical', 'care', 'support']
const FLAGS: PriorityFlag[] = ['child_protection_plan', 'exam_year', 'ongoing_treatment', 'employment', 'caring_duties', 'domestic_abuse', 'disability']
const ACCESS_KEYS = ACCESS_QUESTIONS.map(q => q.key)

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

export function parseHouseholdImport(text: string): HouseholdImport {
  const out: HouseholdImport = { household: null, problems: [], read: [], notUnderstood: [], source: {} }
  const skip = (path: string, note: string) => out.notUnderstood.push({ path, note })
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    out.problems.push('The file is not valid JSON.')
    return out
  }
  if (!isObj(doc)) {
    out.problems.push('The file must hold one household as a JSON object.')
    return out
  }
  if (doc.format !== HOUSEHOLD_FORMAT) {
    out.problems.push(`The file must say "format": "${HOUSEHOLD_FORMAT}". This one says ${doc.format === undefined ? 'nothing' : JSON.stringify(doc.format)}.`)
    return out
  }
  if (!Array.isArray(doc.members) || doc.members.length === 0) {
    out.problems.push('The file has no "members" list: there is nobody to place.')
    return out
  }

  const TOP = new Set([
    'format',
    'source',
    'case_reference',
    'date_needed',
    'expected_stay_nights',
    'last_settled_area',
    'members',
    'household_access_needs',
    'places',
    'priority_flags',
    'pets_must_be_accommodated',
    'affordable_contribution_weekly',
    'safeguarding_zones',
    'notes',
  ])
  for (const k of Object.keys(doc)) if (!TOP.has(k)) skip(k, 'Not a field of this format.')

  if (doc.source !== undefined) {
    if (!isObj(doc.source)) skip('source', 'Expected an object with "system" and "exported_at".')
    else {
      for (const k of Object.keys(doc.source)) if (k !== 'system' && k !== 'exported_at') skip(`source.${k}`, 'Not a field of this format.')
      if (typeof doc.source.system === 'string') out.source.system = doc.source.system.slice(0, 80)
      if (typeof doc.source.exported_at === 'string') out.source.exportedAt = doc.source.exported_at.slice(0, 40)
    }
  }

  const str = (path: string, v: unknown): string | undefined => {
    if (v === undefined) return undefined
    if (typeof v === 'string') return v
    skip(path, `Expected text, found ${JSON.stringify(v)}.`)
    return undefined
  }
  const num = (path: string, v: unknown): number | undefined => {
    if (v === undefined) return undefined
    if (isNum(v)) return v
    skip(path, `Expected a number, found ${JSON.stringify(v)}: enter it on the form.`)
    return undefined
  }
  const bool = (path: string, v: unknown): boolean | undefined => {
    if (v === undefined) return undefined
    if (typeof v === 'boolean') return v
    skip(path, `Expected true or false, found ${JSON.stringify(v)}.`)
    return undefined
  }
  const point = (path: string, v: unknown): LatLng | undefined => {
    if (!isObj(v) || (v.lat === undefined && v.lng === undefined)) return undefined
    if (isNum(v.lat) && isNum(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180) return { lat: v.lat, lng: v.lng }
    skip(path, 'Expected "lat" and "lng" as numbers.')
    return undefined
  }
  const answers = (path: string, v: unknown): Partial<Record<AccessQuestion, YesNo>> => {
    const a: Partial<Record<AccessQuestion, YesNo>> = {}
    if (v === undefined) return a
    if (!isObj(v)) {
      skip(path, 'Expected an object of yes or no answers.')
      return a
    }
    for (const [k, val] of Object.entries(v)) {
      if (!ACCESS_KEYS.includes(k as AccessQuestion)) skip(`${path}.${k}`, 'Not one of the access questions.')
      else if (val === 'yes' || val === 'no') a[k as AccessQuestion] = val
      else skip(`${path}.${k}`, `Expected "yes" or "no", found ${JSON.stringify(val)}: answer it on the form.`)
    }
    return a
  }

  // People. Labels are this system's own (Adult 1, Child 1); the file's refs only link people to places.
  const MEMBER = new Set([
    'ref',
    'role',
    'age',
    'sex',
    'partner_ref',
    'pregnant',
    'employed',
    'exam_year',
    'send',
    'wheelchair_user',
    'access_needs',
    'access_note',
  ])
  const idOf = new Map<string, string>()
  const members: Person[] = []
  const assessments: AccessAssessment[] = []
  const partnerRefs: [Person, string][] = []
  let adults = 0
  let children = 0
  doc.members.forEach((raw, i) => {
    const path = `members[${i}]`
    if (!isObj(raw)) return skip(path, 'Expected an object for each person.')
    for (const k of Object.keys(raw)) if (!MEMBER.has(k)) skip(`${path}.${k}`, 'Not a field of this format.')
    const role = raw.role === 'adult' || raw.role === 'child' ? raw.role : null
    if (!role) return skip(path, `Not imported: "role" must be "adult" or "child", found ${JSON.stringify(raw.role)}. Add this person on the form.`)
    const ref = typeof raw.ref === 'string' && raw.ref.trim() ? raw.ref.trim() : `#${i + 1}`
    if (idOf.has(ref)) return skip(path, `Not imported: a second person with ref "${ref}".`)
    const id = role === 'adult' ? `a${++adults}` : `c${++children}`
    idOf.set(ref, id)
    const ageRaw = raw.age
    const age = isNum(ageRaw) ? ageRaw : NaN
    if (!isNum(ageRaw)) skip(`${path}.age`, `Expected a number, found ${JSON.stringify(ageRaw)}: enter the age on the form.`)
    const sex = raw.sex === 'F' || raw.sex === 'M' || raw.sex === 'X' ? raw.sex : 'X'
    if (raw.sex !== undefined && sex !== raw.sex)
      skip(`${path}.sex`, `Expected "F", "M" or "X", found ${JSON.stringify(raw.sex)}: recorded as other; check it on the form.`)
    if (raw.sex === undefined) skip(`${path}.sex`, 'Missing: recorded as other; check it on the form.')
    const p: Person = { id, label: role === 'adult' ? `Adult ${adults}` : `Child ${children}`, role, age, sex }
    const flags: [keyof Person, string][] = [
      ['pregnant', 'pregnant'],
      ['employed', 'employed'],
      ['examYear', 'exam_year'],
      ['send', 'send'],
      ['wheelchairUser', 'wheelchair_user'],
    ]
    for (const [key, field] of flags) {
      const b = bool(`${path}.${field}`, raw[field])
      if (b) (p as unknown as Record<string, unknown>)[key] = true
    }
    const pr = str(`${path}.partner_ref`, raw.partner_ref)
    if (pr) partnerRefs.push([p, pr])
    const a = answers(`${path}.access_needs`, raw.access_needs)
    const note = str(`${path}.access_note`, raw.access_note)
    if (Object.keys(a).length) assessments.push({ subject: id, answers: a, ...(note ? { note } : {}) })
    members.push(p)
  })
  for (const [p, ref] of partnerRefs) {
    const id = idOf.get(ref)
    // An unknown partner is kept as a broken link, so the form shows the error.
    p.partnerOf = id ?? `unknown:${ref}`
  }

  const ha = answers('household_access_needs', doc.household_access_needs)
  if (Object.keys(ha).length) assessments.push({ subject: HOUSEHOLD_SUBJECT, answers: ha })

  // Places
  const PLACE = new Set(['person_ref', 'kind', 'name', 'reference', 'lat', 'lng', 'postcode', 'arrive_by', 'days_per_week'])
  const destinations: Destination[] = []
  if (doc.places !== undefined && !Array.isArray(doc.places)) skip('places', 'Expected a list.')
  ;(Array.isArray(doc.places) ? doc.places : []).forEach((raw, i) => {
    const path = `places[${i}]`
    if (!isObj(raw)) return skip(path, 'Expected an object for each place.')
    for (const k of Object.keys(raw)) if (!PLACE.has(k)) skip(`${path}.${k}`, 'Not a field of this format.')
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : null
    const kind = KINDS.includes(raw.kind as DestinationKind) ? (raw.kind as DestinationKind) : null
    if (!name || !kind) return skip(path, `Not imported: a place needs a "name" and a "kind" (${KINDS.join(', ')}). Add it on the form.`)
    const loc = point(path, raw)
    const postcode = typeof raw.postcode === 'string' ? raw.postcode.trim().toUpperCase() : undefined
    if (!loc)
      return skip(
        path,
        `Not imported: ${name} has no coordinates${postcode ? ` (postcode ${postcode})` : ''}. Add it on the form${postcode ? ' with “Add a place by postcode”' : ''}.`,
      )
    const who = typeof raw.person_ref === 'string' ? idOf.get(raw.person_ref) : undefined
    if (raw.person_ref !== undefined && !who)
      skip(`${path}.person_ref`, `No person with ref ${JSON.stringify(raw.person_ref)}: choose who goes there on the form.`)
    const arriveBy = str(`${path}.arrive_by`, raw.arrive_by)
    const days = num(`${path}.days_per_week`, raw.days_per_week)
    const ref = str(`${path}.reference`, raw.reference)
    destinations.push({
      id: `d${destinations.length + 1}`,
      personId: who ?? '',
      kind,
      name,
      ...(ref ? { refId: ref.slice(0, 60) } : {}),
      location: loc,
      arriveBy: arriveBy ?? '',
      daysPerWeek: days ?? NaN,
      placeSource: 'import',
      ...(postcode ? { postcode } : {}),
    })
  })

  // Priority flags
  const flags: PriorityFlag[] = []
  if (doc.priority_flags !== undefined) {
    if (!Array.isArray(doc.priority_flags)) skip('priority_flags', 'Expected a list.')
    else
      for (const f of doc.priority_flags) {
        if (FLAGS.includes(f as PriorityFlag) && !flags.includes(f as PriorityFlag)) flags.push(f as PriorityFlag)
        else skip('priority_flags', `${JSON.stringify(f)} is not one of: ${FLAGS.join(', ')}.`)
      }
  }

  // Safeguarding zones
  const zones: SafeguardingZone[] = []
  if (doc.safeguarding_zones !== undefined && !Array.isArray(doc.safeguarding_zones)) skip('safeguarding_zones', 'Expected a list.')
  ;(Array.isArray(doc.safeguarding_zones) ? doc.safeguarding_zones : []).forEach((raw, i) => {
    const path = `safeguarding_zones[${i}]`
    if (!isObj(raw)) return skip(path, 'Expected an object for each zone.')
    for (const k of Object.keys(raw)) if (!['lat', 'lng', 'radius_km'].includes(k)) skip(`${path}.${k}`, 'Not a field of this format.')
    const c = point(path, raw)
    if (!c) return skip(path, 'Not imported: a zone needs "lat" and "lng". Add it on the form.')
    zones.push({ id: `z${zones.length + 1}`, center: c, radiusKm: num(`${path}.radius_km`, raw.radius_km) ?? NaN })
  })

  // Last settled area: kept unset when missing, so the form asks for it.
  let homeArea: LatLng = { lat: NaN, lng: NaN }
  let homeAreaLabel = ''
  if (doc.last_settled_area !== undefined) {
    const a = doc.last_settled_area
    if (!isObj(a)) skip('last_settled_area', 'Expected an object with "label", "lat" and "lng".')
    else {
      for (const k of Object.keys(a)) if (!['label', 'lat', 'lng'].includes(k)) skip(`last_settled_area.${k}`, 'Not a field of this format.')
      const p = point('last_settled_area', a)
      if (p) {
        homeArea = p
        homeAreaLabel = (typeof a.label === 'string' && a.label.trim() ? a.label.trim() : 'Imported area').slice(0, 80)
      }
    }
  }

  const caseRef = str('case_reference', doc.case_reference) ?? ''
  const needFrom = str('date_needed', doc.date_needed) ?? ''
  const nights = num('expected_stay_nights', doc.expected_stay_nights)
  const contribution = num('affordable_contribution_weekly', doc.affordable_contribution_weekly)
  const pets = bool('pets_must_be_accommodated', doc.pets_must_be_accommodated)
  const notes = str('notes', doc.notes)

  out.household = {
    caseRef,
    members,
    destinations,
    homeArea,
    homeAreaLabel,
    needFrom,
    expectedNights: nights ?? NaN,
    accessNeeds: [],
    accessAssessments: assessments,
    petsMustBeAccommodated: pets ?? false,
    flags,
    safeguardingZones: zones,
    maxHouseholdContributionWeekly: contribution ?? NaN,
    notes: notes?.slice(0, 2000) ?? '',
  }
  out.read = [
    `${members.length} ${members.length === 1 ? 'person' : 'people'} (${adults} adult${adults === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'})`,
    `${destinations.length} place${destinations.length === 1 ? '' : 's'} that matter${destinations.length === 1 ? 's' : ''}`,
    ...(assessments.length
      ? [`Access answers for ${assessments.length === 1 ? 'one person' : `${assessments.length} people`}: check them with the household`]
      : []),
    ...(flags.length ? [`Priority flags: ${flags.join(', ').replaceAll('_', ' ')}`] : []),
    ...(zones.length ? [`${zones.length} safeguarding exclusion zone${zones.length === 1 ? '' : 's'}`] : []),
  ]
  return out
}
