import type { ChainRecord } from '../audit/chain'
import { hashRuleset } from '../audit/ruleset'
import type { ChainPayload } from '../audit/snapshot'
import type { Property, Ruleset, SearchResult, Supplier } from '../engine/types'
import { seedProperties, SUPPLIERS } from '../data/properties'
import { defaultRuleset } from '../data/ruleset'

// What the app keeps in the browser. Schema 2 adds the chain payload union
// (decisions and events), the signed-in actor on every record, access answers
// and consent records. Schema-1 data is migrated on load (see migrate.ts).

export type HashedRuleset = Ruleset & { hash: string }

export interface AppData {
  schema: 2
  seededAt: string
  rulesets: HashedRuleset[]
  activeVersion: string
  properties: Property[]
  propertiesVersion: string
  suppliers: Supplier[]
  searches: SearchResult[]
  chain: ChainRecord[]
  /** Demo only: original payload kept while a tampering demo is active */
  tamperBackup?: { seq: number; snapshot: ChainPayload }
  /** Set when this data was carried over from an earlier schema */
  migratedFrom?: { schema: 1; at: string }
}

export interface ReviewLog {
  resultsOpenedAt: string
  propertiesOpened: string[]
  comparisonOpened: boolean
}

/** Empty demo data: the policy, the inventory, no searches or records. `policySignedAt` backdates the policy for seeded history. */
export async function seed(now: string, today: string, policySignedAt = now): Promise<AppData> {
  const rs = await hashRuleset(defaultRuleset(policySignedAt))
  return {
    schema: 2,
    seededAt: now,
    rulesets: [rs],
    activeVersion: rs.version,
    properties: seedProperties(today, now),
    propertiesVersion: `inventory ${now.slice(0, 16).replace('T', ' ')}`,
    suppliers: SUPPLIERS,
    searches: [],
    chain: [],
  }
}

export function activeRulesetOf(d: AppData): HashedRuleset {
  return d.rulesets.find(r => r.version === d.activeVersion) ?? d.rulesets[d.rulesets.length - 1]
}
