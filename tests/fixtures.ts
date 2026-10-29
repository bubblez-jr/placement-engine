import { seedProperties, SUPPLIERS } from '../src/data/properties'
import { defaultRuleset } from '../src/data/ruleset'
import { SCENARIOS } from '../src/data/households'
import { hashRuleset } from '../src/audit/ruleset'
import { runSearch } from '../src/engine/search'
import { estimateProvider } from '../src/travel/estimate'

export const TODAY = '2026-11-02'
export const NOW = '2026-11-02T10:00:00.000Z'

export async function scenarioSearch(id: string) {
  const s = SCENARIOS.find(x => x.id === id)!
  const ruleset = await hashRuleset(defaultRuleset(NOW))
  return runSearch({
    household: s.household(TODAY),
    properties: seedProperties(TODAY, NOW),
    suppliers: SUPPLIERS,
    ruleset,
    travel: estimateProvider,
    now: NOW,
    dataVersions: { properties: 'test', reference: 'test' },
    id: `S-TEST-${id}`,
  })
}
