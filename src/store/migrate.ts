import type { AppData } from './data'

// Browsers already hold schema-1 data from the live demo, including sealed
// decision records. Migration never touches a sealed record: schema-1
// payloads stay byte-for-byte as they were, so their hashes still verify, and
// every screen reads them through the version-aware views in audit/records.ts.
//
// Schema 2 is stored under a new key and the schema-1 copy is left in place,
// so going back to the earlier deployment does not lose anything.

export const KEY_V1 = 'placement-engine/v1'
export const KEY_V2 = 'placement-engine/v2'

function looksLikeAppData(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    Array.isArray(o.rulesets) &&
    o.rulesets.length > 0 &&
    typeof o.activeVersion === 'string' &&
    Array.isArray(o.properties) &&
    Array.isArray(o.suppliers) &&
    Array.isArray(o.searches) &&
    Array.isArray(o.chain)
  )
}

/** Upgrade stored data to schema 2. Returns null when the data is not recognisable (the caller reseeds). */
export function migrate(raw: unknown, now: string): AppData | null {
  if (!looksLikeAppData(raw)) return null
  if (raw.schema === 2) return raw as unknown as AppData
  if (raw.schema === 1) {
    // Schema 1 → 2 is additive. Old searches and decisions keep their shape;
    // new fields (access answers, consent records, actors) are optional in
    // the types and every reader handles their absence.
    return { ...(raw as unknown as Omit<AppData, 'schema'>), schema: 2, migratedFrom: { schema: 1, at: now } }
  }
  return null
}

export interface StorageLike {
  load<T>(key: string): T | null
}

/** Load whichever schema this browser holds, upgraded to schema 2. */
export function loadStored(storage: StorageLike, now: string): AppData | null {
  const v2 = migrate(storage.load(KEY_V2), now)
  if (v2) return v2
  return migrate(storage.load(KEY_V1), now)
}
