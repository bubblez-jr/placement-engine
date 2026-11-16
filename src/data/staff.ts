import type { StaffUser } from '../engine/types'

// SYNTHETIC staff directory for the demo sign-in. Every name is invented.
// A pilot replaces this with the council's directory via single sign-on.

export const STAFF: StaffUser[] = [
  { id: 'u-ta-1', name: 'Sam Okafor', role: 'ta_officer', team: 'Housing Needs, placements' },
  { id: 'u-ta-2', name: 'Priya Raman', role: 'ta_officer', team: 'Housing Needs, placements' },
  { id: 'u-ooh-1', name: 'Dele Adeyemi', role: 'ooh_officer', team: 'Out-of-hours service' },
  { id: 'u-mgr-1', name: 'Hannah Clarke', role: 'team_manager', team: 'Housing Needs, placements' },
  { id: 'u-hos-1', name: 'Martin Osei', role: 'head_of_service', team: 'Housing Needs' },
  { id: 'u-sup-1', name: 'Jo Whitfield', role: 'compliance_officer', team: 'Supply and compliance' },
  { id: 'u-aud-1', name: 'Ruth Benson', role: 'auditor', team: 'Internal audit' },
  { id: 'u-adm-1', name: 'Alex Kim', role: 'admin', team: 'Digital services' },
]

export function staffById(id: string): StaffUser | undefined {
  return STAFF.find(s => s.id === id)
}
