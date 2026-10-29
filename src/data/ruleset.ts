import type { Ruleset } from '../engine/types'

// The demo council's placement policy as a versioned rule-set.
// LHA figures are ILLUSTRATIVE: load the official DWP January 2011 table
// before any real use (docs/PILOT-READINESS.md).

export const INNER_LONDON_BRMAS = ['Central London', 'Inner East London', 'Inner North London', 'Inner South East London', 'Inner South West London', 'Inner West London']

export function defaultRuleset(signedAt: string): Ruleset {
  return {
    id: 'demo-borough-ta-placement',
    version: '1.0',
    name: 'Temporary accommodation placement policy',
    councilName: 'Demo Borough Council',
    effectiveFrom: signedAt.slice(0, 10),
    homeDistrict: 'Demo Borough',
    adjacentDistricts: ['Waltham Forest', 'Redbridge', 'Barking and Dagenham', 'Tower Hamlets', 'Hackney'],
    tierTravelLimitMins: 90,
    staleAvailabilityHours: 72,
    maxExtraBedrooms: 1,
    requireInspection: true,
    criteria: [
      { key: 'school_journey', label: 'School journey', legalFactor: '2012 Order art.2(b): disruption to education', weight: 22, breakpoints: [[15, 1], [30, 0.8], [45, 0.5], [75, 0]] },
      { key: 'work_journey', label: 'Journey to work', legalFactor: '2012 Order art.2(b): disruption to employment', weight: 10, breakpoints: [[20, 1], [45, 0.6], [90, 0]] },
      { key: 'medical_journey', label: 'Journey to treatment', legalFactor: '2012 Order art.2(c): access to medical facilities', weight: 12, breakpoints: [[15, 1], [30, 0.7], [60, 0.2], [90, 0]] },
      { key: 'support_journey', label: 'Journey to care or support', legalFactor: '2012 Order art.2(b)–(c): caring responsibilities and essential support', weight: 8, breakpoints: [[15, 1], [45, 0.5], [90, 0]] },
      { key: 'location_tier', label: 'Location', legalFactor: '2012 Order art.2(a): distance from the district', weight: 18, breakpoints: [[1, 1], [2, 0.75], [3, 0.35], [4, 0]] },
      { key: 'facilities', label: 'Facilities', legalFactor: 'Code of Guidance ch.17: space and arrangement', weight: 12 },
      { key: 'condition', label: 'Condition', legalFactor: '2012 Order art.3 and s210: physical condition', weight: 10 },
      { key: 'stability', label: 'Covers the stay', legalFactor: 'Council policy: avoid further moves', weight: 8 },
    ],
    priorityMultipliers: [
      { flag: 'exam_year', criterion: 'school_journey', multiplier: 1.5 },
      { flag: 'ongoing_treatment', criterion: 'medical_journey', multiplier: 1.75 },
      { flag: 'disability', criterion: 'medical_journey', multiplier: 1.3 },
      { flag: 'employment', criterion: 'work_journey', multiplier: 1.3 },
      { flag: 'child_protection_plan', criterion: 'location_tier', multiplier: 1.5 },
      { flag: 'child_protection_plan', criterion: 'support_journey', multiplier: 1.3 },
      { flag: 'caring_duties', criterion: 'support_journey', multiplier: 1.5 },
      { flag: 'domestic_abuse', criterion: 'support_journey', multiplier: 1.3 },
    ],
    facilitiesValues: { self_contained: 1, shared_kitchen: 0.4, shared_all: 0.15 },
    conditionValues: { A: 1, B: 0.7, C: 0.35, unknown: 0.5 },
    costTieBreakBand: 3,
    subsidy: {
      rate: 0.9,
      weeklyCapInnerLondon: 500,
      weeklyCapElsewhere: 375,
      innerLondonBrmas: INNER_LONDON_BRMAS,
      lhaJan2011Weekly: {
        'Inner East London': { '1': 250, '2': 300, '3': 350, '4': 420 },
        'Outer North East London': { '1': 180, '2': 220, '3': 265, '4': 330 },
        'Outer East London': { '1': 170, '2': 210, '3': 250, '4': 310 },
        'Outer South London': { '1': 175, '2': 215, '3': 260, '4': 325 },
        'Harlow & Stortford': { '1': 140, '2': 170, '3': 210, '4': 270 },
        Basildon: { '1': 135, '2': 165, '3': 200, '4': 255 },
        Luton: { '1': 115, '2': 140, '3': 165, '4': 215 },
        'Milton Keynes': { '1': 125, '2': 150, '3': 180, '4': 235 },
        Chelmsford: { '1': 140, '2': 175, '3': 215, '4': 275 },
      },
      source: 'ILLUSTRATIVE figures for the demo. Load the DWP January 2011 LHA table and current subsidy caps before real use.',
    },
    schoolTransport: {
      funding: 'council_discretionary',
      budgetHolder: 'Education: home-to-school transport',
      fundIfMinutesOver: 45,
      busFarePerChildDay: 4,
      sendTaxiPerKm: 2.2,
    },
    bnbFamilyLimitWeeks: 6,
    signOff: {
      by: 'Head of Housing Needs (demo)',
      role: 'Policy owner',
      at: signedAt,
      equalityNote:
        'Equality impact assessment EIA-TA-2026-04 (demo): weights reviewed for indirect effects on large families, disabled people and survivors of domestic abuse. No protected characteristic is used as a negative weight.',
    },
  }
}
