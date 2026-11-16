import { formatDate, formatDateTime } from '../engine/dates'
import { STATE_LABEL } from '../engine/placement'
import type { ExportFormat } from '../engine/types'
import type { ChainRecord, DecisionRecord } from './chain'
import { journeyView, subsidyOfSearch } from './provenance'
import {
  approvalOf,
  consentAtDecision,
  currentConsent,
  consentSummary,
  decisionRecords,
  deciderOf,
  placementsFrom,
  statusLine,
  storyOf,
  termsRows,
} from './records'

// What leaves the system, built from sealed records only. The store builds
// these inside the export command, so every export is recorded with a
// fingerprint of exactly what was exported (docs/INTEGRATION.md).

const SYNTHETIC_LINE = 'SYNTHETIC DEMO DATA: an invented household and property. Not a real case.'

function isSynthetic(r: ChainRecord): boolean {
  return r.snapshot.notes.some(n => n.startsWith('SYNTHETIC'))
}

/** The sealed decision record exactly as held, with its seal: the format other systems can verify. */
export function decisionJson(r: DecisionRecord): string {
  return JSON.stringify({ seq: r.seq, prevHash: r.prevHash, rowHash: r.rowHash, snapshot: r.snapshot }, null, 2)
}

const APPROVAL_TEXT = {
  awaiting: 'waiting for a manager',
  out_of_hours: 'placed out of hours, approval to follow',
  approved: 'approved',
  rejected: 'rejected',
} as const

const OUTCOME: Record<string, string> = {
  accepted: 'Recommendation accepted',
  override: 'Officer chose another option',
  no_suitable: 'No suitable option available',
}

/** A plain-text case note to paste into the case system: the decision, its terms and everything since, in order. */
export function caseNoteText(chain: ChainRecord[], r: DecisionRecord, now: string): string {
  const s = r.snapshot
  const d = s.decision
  const by = deciderOf(s)
  const cand = s.search.candidates.find(c => c.propertyId === d.chosenPropertyId)
  const prop = s.properties.find(p => p.id === d.chosenPropertyId)
  const consent = currentConsent(chain, r)
  const approval = approvalOf(chain, r)
  const journeys = journeyView(s.search)
  const subsidy = subsidyOfSearch(s.search, s.ruleset)
  const lines: string[] = []
  lines.push(`PLACEMENT DECISION: CASE ${s.search.household.caseRef}`)
  lines.push(`Placement Engine record #${r.seq}, sealed ${formatDateTime(s.frozenAt)}. Seal ${r.rowHash}`)
  if (isSynthetic(r)) lines.push(SYNTHETIC_LINE)
  lines.push('')
  lines.push(`Outcome: ${OUTCOME[d.outcome]}.`)
  lines.push(`Decided by: ${by.name}, ${by.roleLabel}, ${formatDateTime(d.decidedAt)}${by.signedIn ? '' : ' (name typed under the earlier version)'}.`)
  if (cand && prop) lines.push(`Placement: ${cand.label}, ${prop.address}, from ${formatDate(d.startDate)}.`)
  if (d.outcome === 'override') {
    const rec = s.search.candidates.find(c => c.propertyId === s.search.recommendedId)
    if (rec) lines.push(`Recommended instead: ${rec.label}.`)
  }
  if (d.reasonText) lines.push(`${d.outcome === 'no_suitable' ? 'Search steps' : 'Officer’s words'}: “${d.reasonText}”`)
  for (const [k, v] of termsRows(r)) lines.push(`${k}: ${v}`)
  if (approval.status !== 'not_required') lines.push(`Manager approval: ${APPROVAL_TEXT[approval.status]}.`)
  if (consentAtDecision(s).kind !== 'not_applicable') lines.push(`Consent to notify school, GP and health visitor: ${consentSummary(consent.now)}.`)
  lines.push(`Policy: ${s.ruleset.name}, version ${s.ruleset.version}.`)
  lines.push(`Journey times: ${journeys.headline}`)
  lines.push(`Subsidy figures: ${subsidy.label}. ${subsidy.detail}`)
  lines.push('')
  lines.push('What happened next (each a sealed record):')
  for (const e of storyOf(chain, r)) lines.push(`#${e.seq} ${formatDateTime(e.at)}, ${e.who}: ${e.text}`)
  lines.push('')
  lines.push(`Status when exported, ${formatDateTime(now)}: ${statusLine(chain, r, now)} (worked out from the records above; not itself sealed)`)
  return lines.join('\n')
}

const CSV_HEADER = [
  'decision_record',
  'case_reference',
  'outcome',
  'property_id',
  'property',
  'state',
  'decided_at',
  'decided_by',
  'start_date',
  'planned_end',
  'moved_in_on',
  'moved_out_on',
  'approval',
  'six_week_rule',
  'journey_times',
  'subsidy_figures',
  'synthetic',
] as const

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v)
  // Quote anything with a comma, quote or newline; neutralise a leading formula character for spreadsheets.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** Every placement as one CSV row, worked out at `now` from the sealed records. */
export function placementsCsv(chain: ChainRecord[], now: string): { text: string; rows: number } {
  const recs = new Map(decisionRecords(chain).map(r => [r.seq, r]))
  const rows = placementsFrom(chain, now).map(p => {
    const r = recs.get(p.seq)!
    const s = r.snapshot
    return [
      p.seq,
      p.caseRef,
      s.decision.outcome,
      p.propertyId,
      p.propertyLabel,
      STATE_LABEL[p.state],
      p.decidedAt,
      p.decidedByName,
      p.startDate,
      p.currentEnd,
      p.checkedInOn ?? '',
      p.movedOutOn ?? '',
      p.approval.status,
      p.sixWeekRule ? 'yes' : 'no',
      journeyView(s.search).outcome,
      subsidyOfSearch(s.search, s.ruleset).status,
      isSynthetic(r) ? 'yes' : 'no',
    ]
      .map(csvCell)
      .join(',')
  })
  return { text: [CSV_HEADER.join(','), ...rows].join('\n'), rows: rows.length }
}

/** File names for downloads. */
export function exportFileName(format: ExportFormat, r: DecisionRecord | null, now: string): string {
  const day = now.slice(0, 10)
  if (format === 'placements_csv' || !r) return `placements-${day}.csv`
  const base = `placement-decision-${r.seq}-${r.snapshot.search.household.caseRef.replace(/[^A-Za-z0-9-]/g, '_')}`
  return format === 'decision_json' ? `${base}.json` : format === 'case_note' ? `${base}-case-note.txt` : `${base}.pdf`
}
