import { money } from './valueFns'
import { sharedFacilities } from './gates'
import { isFamilyHousehold } from './bedrooms'
import type { CostBreakdown, CostLine, Household, JourneyResult, Property, Ruleset, SubsidyProvenance, SubsidyStatus } from './types'

/**
 * Official only when the table was loaded as official with its citation and
 * dates. Anything else, including every policy version published before
 * phase 3, is illustrative.
 */
export function subsidyStatusOf(rs: Pick<Ruleset, 'subsidy'>): SubsidyStatus {
  const s = rs.subsidy
  return s.status === 'official' && !!s.citation?.trim() && !!s.sourceDate && !!s.loadedOn ? 'official' : 'illustrative'
}

export const SUBSIDY_STATUS_LABEL: Record<SubsidyStatus, string> = {
  illustrative: 'Illustrative subsidy figures',
  official: 'Official subsidy table',
}

/** What the costs say about the subsidy figures behind them. */
export function subsidyProvenance(rs: Pick<Ruleset, 'subsidy'>): SubsidyProvenance {
  const status = subsidyStatusOf(rs)
  const s = rs.subsidy
  return {
    status,
    label: SUBSIDY_STATUS_LABEL[status],
    detail:
      status === 'official'
        ? `January 2011 LHA rates from ${s.citation!.trim()}, dated ${s.sourceDate}, loaded on ${s.loadedOn}. The caps and the 90% rate are the council’s policy settings.`
        : `${s.source.replace(/\s*$/, '')} These figures are not the official table: treat subsidy and net costs as examples.`,
  }
}

/** School days per calendar night: 5 days a week, 39 term weeks a year. */
export const SCHOOL_DAYS_PER_NIGHT = (5 / 7) * (39 / 52)

/**
 * Housing benefit subsidy a council can reclaim for a TA placement:
 * the lower of the charge, rate × the January 2011 LHA rate for the
 * property's size (one-bedroom rate if facilities are shared), and the weekly
 * cap. Figures come from the rule-set so the council loads the official table.
 */
export function subsidyPerNight(p: Property, rs: Ruleset): { perNight: number; basis: string } {
  const size = sharedFacilities(p) ? 1 : Math.min(4, Math.max(1, p.bedrooms))
  const table = rs.subsidy.lhaJan2011Weekly[p.brma]
  const lha = table?.[String(size) as '1' | '2' | '3' | '4']
  const tag = subsidyStatusOf(rs) === 'official' ? 'Official table' : 'Illustrative figures'
  if (lha === undefined) return { perNight: 0, basis: `${tag}: no January 2011 LHA rate loaded for ${p.brma}; subsidy counted as £0` }
  const cap = rs.subsidy.innerLondonBrmas.includes(p.brma) ? rs.subsidy.weeklyCapInnerLondon : rs.subsidy.weeklyCapElsewhere
  const weeklyCharge = p.nightlyCharge * 7
  const byRate = rs.subsidy.rate * lha
  const weekly = Math.min(weeklyCharge, byRate, cap)
  const limiter =
    weekly === weeklyCharge ? 'the charge' : weekly === cap ? `the £${cap}/week cap` : `${Math.round(rs.subsidy.rate * 100)}% of the Jan 2011 LHA rate`
  return {
    perNight: money(weekly / 7),
    basis: `${tag}: ${p.brma}, ${size}-bed rate${sharedFacilities(p) ? ' (shared facilities: one-bed rate)' : ''}: £${lha.toFixed(2)}/week × ${Math.round(
      rs.subsidy.rate * 100,
    )}% = £${byRate.toFixed(2)}/week; limited by ${limiter}`,
  }
}

/**
 * Cost of a placement split by who pays. The TA budget line is net of
 * subsidy. Travel to an existing school is costed only where it applies, and
 * charged to the budget that actually pays it (or to the family).
 */
export function costPlacement(h: Household, p: Property, rs: Ruleset, journeys: JourneyResult[], lastResort: boolean): CostBreakdown {
  const stayNights = h.expectedNights
  const schoolDaysInStay = Math.round(stayNights * SCHOOL_DAYS_PER_NIGHT)
  const sub = subsidyPerNight(p, rs)
  const taNet = money(p.nightlyCharge - sub.perNight)
  const lines: CostLine[] = [
    {
      key: 'charge',
      label: 'Nightly charge',
      budgetHolder: 'ta_budget',
      perUnit: p.nightlyCharge,
      unit: 'night',
      stayTotal: money(p.nightlyCharge * stayNights),
      basis: 'Supplier rate on file',
    },
    {
      key: 'subsidy',
      label: 'Housing benefit subsidy recovered',
      budgetHolder: 'ta_budget',
      perUnit: -sub.perNight,
      unit: 'night',
      stayTotal: money(-sub.perNight * stayNights),
      basis: sub.basis,
    },
  ]

  const st = rs.schoolTransport
  for (const j of journeys.filter(x => x.kind === 'school')) {
    const child = h.members.find(m => m.id === j.personId)
    if (!child || j.minutes === null) continue
    const londonFree = p.inLondon && child.age < 16
    if (st.funding === 'council_discretionary' && j.minutes > st.fundIfMinutesOver) {
      const perDay = child.send ? money(j.distanceKm * 2 * st.sendTaxiPerKm) : londonFree ? 0 : st.busFarePerChildDay
      lines.push({
        key: `school-${child.id}`,
        label: `${child.label}: travel to ${j.name}`,
        budgetHolder: 'education',
        perUnit: perDay,
        unit: 'school day',
        stayTotal: money(perDay * schoolDaysInStay),
        basis: child.send
          ? `SEND taxi, ${j.distanceKm} km × 2 × £${st.sendTaxiPerKm.toFixed(2)}/km (the council’s own assumption; ${st.budgetHolder})`
          : londonFree
            ? 'Under-16s travel free on London buses'
            : `Bus fare £${st.busFarePerChildDay.toFixed(2)}/day (the council’s own assumption; ${st.budgetHolder})`,
      })
    } else if (j.minutes > 20 && !londonFree) {
      lines.push({
        key: `school-${child.id}`,
        label: `${child.label}: travel to ${j.name}`,
        budgetHolder: 'household',
        perUnit: st.busFarePerChildDay,
        unit: 'school day',
        stayTotal: money(st.busFarePerChildDay * schoolDaysInStay),
        basis:
          st.funding === 'family'
            ? `Council policy: the family pays travel to an existing school (bus fare £${st.busFarePerChildDay.toFixed(2)}/day, the council’s own assumption)`
            : `Journey under ${st.fundIfMinutesOver} min: the family pays (bus fare £${st.busFarePerChildDay.toFixed(2)}/day, the council’s own assumption)`,
      })
    }
  }
  if (p.householdChargeWeekly > 0) {
    lines.push({
      key: 'household-charges',
      label: 'Charges not covered by housing benefit',
      budgetHolder: 'household',
      perUnit: money(p.householdChargeWeekly / 7),
      unit: 'night',
      stayTotal: money((p.householdChargeWeekly / 7) * stayNights),
      basis: 'Meals, heating or service charges on file',
    })
  }

  const total = (holder: CostLine['budgetHolder']) => money(lines.filter(l => l.budgetHolder === holder).reduce((a, l) => a + l.stayTotal, 0))
  const taBudgetStay = total('ta_budget')
  const educationStay = total('education')
  const householdStay = total('household')

  const risks: string[] = []
  if (lastResort && isFamilyHousehold(h.members)) {
    const limitNights = rs.bnbFamilyLimitWeeks * 7
    if (stayNights > limitNights) {
      const extraWeeks = Math.ceil((stayNights - limitNights) / 7)
      risks.push(
        `Stay planned beyond the ${rs.bnbFamilyLimitWeeks}-week limit for families in shared accommodation: Ombudsman remedies are typically £100–£200 a week over the limit (about £${extraWeeks * 100}–£${extraWeeks * 200} if the stay runs to plan).`,
      )
    }
  }

  return {
    nightlyCharge: p.nightlyCharge,
    subsidyPerNight: sub.perNight,
    subsidyBasis: sub.basis,
    taNetPerNight: taNet,
    lines,
    stayNights,
    schoolDaysInStay,
    taBudgetStay,
    educationStay,
    householdStay,
    publicPerNight: money((taBudgetStay + educationStay) / stayNights),
    publicStay: money(taBudgetStay + educationStay),
    risks,
  }
}
