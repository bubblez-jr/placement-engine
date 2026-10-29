import type { DestinationKind, LatLng } from '../engine/types'

// SYNTHETIC reference places for the demo. Names are invented; locations are
// plausible points in east London. In a pilot, schools come from the DfE
// register (GIAS), GP practices and hospitals from NHS ODS.

export interface Place {
  id: string
  kind: DestinationKind
  name: string
  refId: string
  location: LatLng
}

export const PLACES: Place[] = [
  { id: 'SCH-1', kind: 'school', name: 'Riverside Primary School', refId: 'URN 900101 (synthetic)', location: { lat: 51.5455, lng: 0.0251 } },
  { id: 'SCH-2', kind: 'school', name: 'Eastfield Academy', refId: 'URN 900102 (synthetic)', location: { lat: 51.539, lng: 0.005 } },
  { id: 'SCH-3', kind: 'school', name: 'Mill Lane Primary School', refId: 'URN 900103 (synthetic)', location: { lat: 51.556, lng: 0.042 } },
  { id: 'SCH-4', kind: 'school', name: 'Northgate High School', refId: 'URN 900104 (synthetic)', location: { lat: 51.56, lng: 0.01 } },
  { id: 'SCH-5', kind: 'school', name: 'Park View School (special)', refId: 'URN 900105 (synthetic)', location: { lat: 51.533, lng: 0.04 } },
  { id: 'SCH-6', kind: 'school', name: "St Columba's RC Primary", refId: 'URN 900106 (synthetic)', location: { lat: 51.525, lng: 0.015 } },
  { id: 'GP-1', kind: 'medical', name: 'Forest Road Medical Centre', refId: 'ODS F90001 (synthetic)', location: { lat: 51.548, lng: 0.028 } },
  { id: 'GP-2', kind: 'medical', name: 'Broadway Health Centre', refId: 'ODS F90002 (synthetic)', location: { lat: 51.542, lng: -0.001 } },
  { id: 'HOSP-1', kind: 'medical', name: 'East London General, renal unit', refId: 'ODS R90001 (synthetic)', location: { lat: 51.519, lng: -0.059 } },
  { id: 'HOSP-2', kind: 'medical', name: 'Northside Hospital, maternity', refId: 'ODS R90002 (synthetic)', location: { lat: 51.569, lng: 0.057 } },
  { id: 'WK-1', kind: 'work', name: 'Retail job, Stratford centre', refId: 'workplace', location: { lat: 51.5432, lng: -0.0063 } },
  { id: 'WK-2', kind: 'work', name: 'Office job, Canary Wharf', refId: 'workplace', location: { lat: 51.5054, lng: -0.0235 } },
  { id: 'WK-3', kind: 'work', name: 'Warehouse shifts, Barking', refId: 'workplace', location: { lat: 51.533, lng: 0.088 } },
  { id: 'WK-4', kind: 'work', name: 'Care work, Ilford', refId: 'workplace', location: { lat: 51.559, lng: 0.071 } },
  { id: 'SUP-1', kind: 'care', name: 'Grandparent (after-school childcare)', refId: 'family', location: { lat: 51.552, lng: 0.033 } },
  { id: 'SUP-2', kind: 'support', name: 'Family hub', refId: 'service', location: { lat: 51.544, lng: 0.02 } },
  { id: 'SUP-3', kind: 'support', name: 'Domestic abuse support service', refId: 'service', location: { lat: 51.538, lng: 0.01 } },
  { id: 'CARE-1', kind: 'care', name: 'Parent who needs daily care', refId: 'family', location: { lat: 51.535, lng: 0.052 } },
]

export const PLACE_KIND_LABEL: Record<DestinationKind, string> = {
  school: 'School',
  work: 'Work',
  medical: 'Medical or treatment',
  care: 'Caring or childcare',
  support: 'Support service',
}

export function placeById(id: string): Place | undefined {
  return PLACES.find(p => p.id === id)
}

/** Area presets for the home area and safeguarding zones (synthetic demo). */
export const AREAS: { id: string; label: string; location: LatLng }[] = [
  { id: 'forest-gate', label: 'Forest Gate, Demo Borough', location: { lat: 51.548, lng: 0.026 } },
  { id: 'plaistow', label: 'Plaistow, Demo Borough', location: { lat: 51.527, lng: 0.02 } },
  { id: 'manor-park', label: 'Manor Park, Demo Borough', location: { lat: 51.551, lng: 0.04 } },
  { id: 'stratford', label: 'Stratford, Demo Borough', location: { lat: 51.542, lng: 0.0 } },
  { id: 'leyton', label: 'Leyton (Waltham Forest)', location: { lat: 51.565, lng: -0.01 } },
  { id: 'ilford', label: 'Ilford (Redbridge)', location: { lat: 51.559, lng: 0.07 } },
  { id: 'barking', label: 'Barking (Barking and Dagenham)', location: { lat: 51.539, lng: 0.081 } },
  { id: 'walthamstow', label: 'Walthamstow (Waltham Forest)', location: { lat: 51.585, lng: -0.02 } },
]
