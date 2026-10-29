# Architecture

A single-page React app (Vite, TypeScript, Tailwind v4). The engine is plain TypeScript with no UI or storage dependencies, so the same code can later run in a Supabase Edge Function or a Node service.

```
src/
  engine/          pure decision logic (no I/O)
    types.ts         domain model: Household, Property, Ruleset, Candidate, SearchResult, Decision
    bedrooms.ts      LHA size criteria (bedroom need), family test
    gates.ts         hard gates with legal basis; required certificates
    scoring.ts       applicable factors, effective weights, value functions, location tiers
    cost.ts          subsidy, net TA cost, education and household costs, risks
    search.ts        runSearch(): journeys → gates → scores → cost → rank → sensitivity → explanation
    explain.ts       plain-English templates (recommendation, comparisons, rejections)
    clocks.ts        statutory deadlines from a decision
  travel/
    provider.ts      TravelProvider interface (matrix of minutes)
    estimate.ts      demo estimate from straight-line distance
  audit/
    canonical.ts     canonical JSON
    hash.ts          SHA-256 (Web Crypto)
    chain.ts         append-only hash chain + verification
    snapshot.ts      what a decision freezes
    ruleset.ts       rule-set hashing
  data/            synthetic demo data + CSV import/export
  store/           React context: app data (localStorage), in-page router
  ui/              screens and shared components
  pdf/             audit pack PDF (@react-pdf/renderer, lazy-loaded)
tests/             Vitest: engine units, five end-to-end scenarios, audit chain, CSV
scripts/           headless-browser walkthrough with screenshots
```

## Data flow

1. `store/app.tsx` loads demo data from localStorage, or seeds it: one hashed rule-set, 26 properties, 6 suppliers.
2. **New placement** builds a `Household` and calls `search()`. That calls `runSearch()` with the active rule-set and a travel provider, then stores the `SearchResult`.
3. Screens read the stored result. Opening the results, property details and the comparison updates a review log kept in memory.
4. `decide()` builds a `DecisionSnapshot`, computes statutory clocks, appends it to the hash chain and stores it.
5. The audit pack renders from the snapshot only, never from live data. The PDF does the same.

## Moving to a pilot

| MVP                      | Pilot                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| localStorage per browser | Supabase (London, eu-west-2): tables per entity, row-level security per council, MFA                                                                       |
| Chain in JSON            | `decision_snapshot` insert-only table; trigger blocks UPDATE/DELETE; `chain_head` updated in the same transaction; nightly head hash to write-once storage |
| `estimate-v1`            | TravelTime `time-filter/fast` with written storage rights, or self-hosted r5 on BODS + rail GTFS, behind the same `TravelProvider`                         |
| Synthetic places         | GIAS schools, NHS ODS GP and hospital codes, postcodes.io / OS Open UPRN                                                                                   |
| CSV inventory            | Import from the council's Adam / DPS export and leased-stock list (council-sponsored API access)                                                           |
| Typed household          | Pre-fill from the case system (Jigsaw, Locata, NEC) using H-CLIC code lists                                                                                |
| Illustrative LHA table   | DWP January 2011 LHA rates + current subsidy caps, versioned in the rule-set                                                                               |

The engine API doesn't change: `runSearch(input) → SearchResult`.
