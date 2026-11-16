import { splitCsvLine } from './csvLine'
import { isRealDate } from './validate'
import type { IsoDate, Issue, Ruleset } from './types'

// Loading the official DWP January 2011 LHA table. Pure: the store runs the
// same checks before publishing, so the screen cannot skip them. The aim is
// to make a wrong table hard to load by mistake: the columns must be exactly
// the documented ones, every rate must look like a weekly figure, no area may
// appear twice, and the source must be cited and dated.

export type LhaTable = Ruleset['subsidy']['lhaJan2011Weekly']
type Size = '1' | '2' | '3' | '4'

/** The columns the file must have, in any order. */
export const LHA_COLUMNS = ['brma', '1_bed', '2_bed', '3_bed', '4_bed'] as const
/** Columns the DWP table may also carry; read and ignored (subsidy uses sizes 1 to 4). */
export const LHA_IGNORED_COLUMNS = ['shared', 'shared_room', '5_bed'] as const
/** Plausible weekly rates. Below looks like a typo or a daily figure; above looks like a monthly one. */
export const LHA_WEEKLY_RANGE = { min: 40, max: 2500 } as const
export const LHA_MAX_ROWS = 400
export const CITATION_MIN_CHARS = 10

export interface LhaChange {
  brma: string
  from: Record<Size, number>
  to: Record<Size, number>
}

export interface LhaParse {
  table: LhaTable | null
  rows: number
  /** Problems that stop the table loading, each naming its row */
  errors: string[]
  /** Worth a look, never blocking */
  warnings: string[]
  ignoredColumns: string[]
}

export interface LhaDiff {
  added: string[]
  removed: string[]
  changed: LhaChange[]
  unchanged: number
}

const SIZES: Size[] = ['1', '2', '3', '4']
const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_')

function rate(cell: string): number | null {
  const t = cell.replace(/^£/, '').replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Number(t)
}

/**
 * Read a CSV of January 2011 weekly LHA rates: one row per Broad Rental
 * Market Area, columns `brma,1_bed,2_bed,3_bed,4_bed`. `inventoryBrmas`
 * counts the properties in each area, so areas the inventory uses but the
 * table lacks are pointed out (their subsidy would be counted as £0).
 */
export function parseLhaCsv(text: string, inventoryBrmas: Map<string, number> = new Map()): LhaParse {
  const errors: string[] = []
  const warnings: string[] = []
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(x => x.l.trim().length > 0)
  const out: LhaParse = { table: null, rows: 0, errors, warnings, ignoredColumns: [] }
  if (lines.length < 2) {
    errors.push('The file needs a header row and at least one area.')
    return out
  }
  const header = splitCsvLine(lines[0].l).map(norm)
  const known = new Set<string>([...LHA_COLUMNS, ...LHA_IGNORED_COLUMNS])
  const unknown = header.filter(h => !known.has(h))
  const missing = LHA_COLUMNS.filter(c => !header.includes(c))
  const dupes = header.filter((h, i) => header.indexOf(h) !== i)
  if (unknown.length) errors.push(`Columns not recognised: ${unknown.map(h => h || '(blank)').join(', ')}. The columns are ${LHA_COLUMNS.join(', ')}.`)
  if (missing.length) errors.push(`Missing columns: ${missing.join(', ')}.`)
  if (dupes.length) errors.push(`Columns given twice: ${[...new Set(dupes)].join(', ')}.`)
  if (errors.length) return out
  out.ignoredColumns = header.filter(h => (LHA_IGNORED_COLUMNS as readonly string[]).includes(h))
  if (lines.length - 1 > LHA_MAX_ROWS) {
    errors.push(`The file has ${lines.length - 1} areas; at most ${LHA_MAX_ROWS} are expected. Check it is the right file.`)
    return out
  }

  const table: LhaTable = {}
  const seen = new Map<string, number>()
  for (const { l, n } of lines.slice(1)) {
    const cells = splitCsvLine(l)
    if (cells.length !== header.length) {
      errors.push(`Row ${n}: ${cells.length} values for ${header.length} columns.`)
      continue
    }
    const get = (c: string) => cells[header.indexOf(c)]
    const brma = get('brma').replace(/\s+/g, ' ').trim()
    if (!brma) {
      errors.push(`Row ${n}: the area (BRMA) name is blank.`)
      continue
    }
    if (brma.length > 80 || /^\d+$/.test(brma)) {
      errors.push(`Row ${n}: “${brma.slice(0, 40)}” does not look like an area name.`)
      continue
    }
    const key = brma.toLowerCase()
    if (seen.has(key)) {
      errors.push(`Row ${n}: ${brma} appears twice (first on row ${seen.get(key)}).`)
      continue
    }
    seen.set(key, n)
    const rates = {} as Record<Size, number>
    let ok = true
    for (const size of SIZES) {
      const raw = get(`${size}_bed`)
      const v = rate(raw)
      if (v === null) {
        errors.push(`Row ${n}, ${brma}, ${size} bedroom: “${raw}” is not an amount in pounds.`)
        ok = false
      } else if (v < LHA_WEEKLY_RANGE.min) {
        errors.push(`Row ${n}, ${brma}, ${size} bedroom: £${v} a week is too low for a weekly rate. Check the file holds weekly figures.`)
        ok = false
      } else if (v > LHA_WEEKLY_RANGE.max) {
        errors.push(`Row ${n}, ${brma}, ${size} bedroom: £${v} a week is too high for a weekly rate. It may be a monthly figure.`)
        ok = false
      } else rates[size] = v
    }
    if (!ok) continue
    if (!(rates['1'] <= rates['2'] && rates['2'] <= rates['3'] && rates['3'] <= rates['4']))
      warnings.push(`${brma}: the rates do not rise with the number of bedrooms. Check this row against the source.`)
    table[brma] = rates
  }
  out.rows = Object.keys(table).length
  if (errors.length) return out

  for (const [brma, count] of inventoryBrmas) {
    if (table[brma]) continue
    const near = Object.keys(table).find(k => k.toLowerCase() === brma.toLowerCase())
    warnings.push(
      near
        ? `${count} propert${count === 1 ? 'y is' : 'ies are'} in “${brma}”, but the file spells it “${near}”. Names must match exactly, or their subsidy is counted as £0.`
        : `${count} propert${count === 1 ? 'y is' : 'ies are'} in ${brma}, which is not in the file: their subsidy would be counted as £0.`,
    )
  }
  out.table = table
  return out
}

/** What changes against the table in use. */
export function diffLhaTables(current: LhaTable, next: LhaTable): LhaDiff {
  const added = Object.keys(next).filter(k => !current[k])
  const removed = Object.keys(current).filter(k => !next[k])
  const changed: LhaChange[] = []
  let unchanged = 0
  for (const k of Object.keys(next)) {
    if (!current[k]) continue
    if (SIZES.some(s => current[k][s] !== next[k][s])) changed.push({ brma: k, from: current[k], to: next[k] })
    else unchanged++
  }
  return { added, removed, changed, unchanged }
}

export interface SubsidyImportInput {
  csv?: string
  citation?: string
  /** The date of the source document */
  sourceDate?: string
  /** The head of service confirms this is the official table */
  confirmedOfficial?: boolean
}

/** Every check on an import, as form issues (paths are the form's control ids). */
export function validateSubsidyImport(
  input: SubsidyImportInput,
  today: IsoDate,
  inventoryBrmas: Map<string, number>,
): { issues: Issue[]; parsed: LhaParse | null } {
  const issues: Issue[] = []
  const error = (path: string, message: string) => issues.push({ path, message, severity: 'error' })
  let parsed: LhaParse | null = null
  if (!input.csv?.trim()) error('lha-file', 'Choose the CSV file of January 2011 LHA rates, or paste it.')
  else {
    parsed = parseLhaCsv(input.csv, inventoryBrmas)
    for (const e of parsed.errors) error('lha-file', e)
    for (const w of parsed.warnings) issues.push({ path: 'lha-file', message: w, severity: 'warning' })
  }
  const citation = (input.citation ?? '').trim()
  if (citation.length < CITATION_MIN_CHARS)
    error('lha-citation', `Cite where the table comes from (at least ${CITATION_MIN_CHARS} characters): the document's title and where it was published.`)
  if (!input.sourceDate) error('lha-sourceDate', 'Enter the date of the source document.')
  else if (!isRealDate(input.sourceDate)) error('lha-sourceDate', 'Enter the date of the source document as a real date.')
  else if (input.sourceDate > today) error('lha-sourceDate', 'The source document’s date cannot be in the future.')
  if (input.confirmedOfficial !== true) error('lha-confirm', 'Confirm that this is the official table from the source cited.')
  return { issues, parsed }
}

/** Properties per BRMA in an inventory. */
export function brmaCounts(properties: { brma: string }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of properties) m.set(p.brma, (m.get(p.brma) ?? 0) + 1)
  return m
}
