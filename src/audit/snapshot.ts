import type { Decision, Property, Ruleset, SearchResult, StatutoryClock } from '../engine/types'

/**
 * Everything frozen at the moment of decision. The record of what the officer
 * saw and decided — including every rejected option and why — is the evidence
 * a review, Ombudsman complaint or court will ask for.
 */
export interface DecisionSnapshot {
  schema: 'placement-decision/1'
  frozenAt: string
  councilName: string
  search: SearchResult
  ruleset: Ruleset
  /** The properties as they stood at search time */
  properties: Property[]
  decision: Decision
  clocks: StatutoryClock[]
  notes: string[]
}
