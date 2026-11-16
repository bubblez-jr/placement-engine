import { seedProperties, SUPPLIERS } from '../src/data/properties'
import { defaultRuleset } from '../src/data/ruleset'
import { SCENARIOS } from '../src/data/households'
import { hashRuleset } from '../src/audit/ruleset'
import { runSearch, type SearchInput } from '../src/engine/search'
import type { Household } from '../src/engine/types'
import { estimateProvider } from '../src/travel/estimate'

export const TODAY = '2026-11-02'
export const NOW = '2026-11-02T10:00:00.000Z'

export async function searchHousehold(household: Household, id = 'S-TEST', extra: Partial<SearchInput> = {}) {
  const ruleset = await hashRuleset(defaultRuleset(NOW))
  return runSearch({
    ...extra,
    household,
    properties: seedProperties(TODAY, NOW),
    suppliers: SUPPLIERS,
    ruleset,
    travel: estimateProvider,
    now: NOW,
    dataVersions: { properties: 'test', reference: 'test' },
    id,
  })
}

export async function scenarioSearch(id: string) {
  const s = SCENARIOS.find(x => x.id === id)!
  return searchHousehold(s.household(TODAY), `S-TEST-${id}`)
}
