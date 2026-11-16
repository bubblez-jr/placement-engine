# Architecture

A single-page React app (Vite, TypeScript, Tailwind v4). The engine is plain TypeScript with no UI or storage dependencies, so the same code can later run in a Supabase Edge Function or a Node service.

```
src/
  engine/          pure decision logic (no I/O)
    types.ts         domain model: Household, Property, Ruleset, Candidate, SearchResult, Decision, staff and actors
    validate.ts      validateHousehold(): errors and warnings; runSearch refuses a household with errors
    access.ts        access needs per person: required questions, effective needs (union of "yes"), labels
    permissions.ts   can(user, action, context): the role × action matrix; assertCan() throws PermissionError
    decision.ts      decision and consent rules (validateDecision, validateConsent, the consent record)
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
    snapshot.ts      chain payloads: decision snapshots (v1, v2) and events
    records.ts       version-aware read views shared by every screen (decider, consent now, deadlines now)
    ruleset.ts       rule-set hashing
  auth/            AuthProvider interface, DemoAuth (labelled demo sign-in), session context
  data/            synthetic demo data (households, properties, places, staff) + CSV import/export
  store/
    data.ts          AppData (schema 2), seed
    migrate.ts       schema 1 → 2 on load
    commands.ts      every change: takes the actor from the session, checks permissions, returns new data
    app.tsx          React context wiring commands to state and localStorage; nav.tsx in-page router
  ui/              screens and shared components
  pdf/             audit pack PDF (@react-pdf/renderer, lazy-loaded)
tests/             Vitest: engine units, five end-to-end scenarios, audit chain, CSV
scripts/           headless-browser walkthrough with screenshots
```

## Data flow

1. Nothing renders until someone signs in. `auth/` holds the `AuthProvider` interface; today's `DemoAuth` lets you pick a synthetic staff member, with no password, for the length of the browser tab. A pilot adds a single sign-on implementation behind the same interface.
2. `store/app.tsx` loads demo data from localStorage (key `placement-engine/v2`), migrating schema-1 data from the MVP's key if that is all there is, or seeds it: one hashed rule-set, 26 properties, 6 suppliers.
3. Every change goes through `store/commands.ts`. Each command takes the actor from the session, calls `assertCan()` and the engine's validation, and returns new data. The React layer only reads the clock and the session at the edge and saves the result.
4. **New placement** builds a `Household`; `cmdSearch` calls `runSearch()`, which validates it first and refuses on errors. The `SearchResult` keeps the warnings and who ran it.
5. Screens read the stored result. Opening the results, property details and the comparison updates a review log kept in memory.
6. `cmdDecide` checks the decision and consent rules, builds a `placement-decision/2` snapshot with the signed-in actor and the consent record, computes statutory clocks, appends it to the hash chain and stores it. A later consent answer is a `placement-event/1` record pointing to the decision.
7. The audit pack renders from the sealed records only, never from live data, through `audit/records.ts` so schema-1 and V2 records share one code path. The PDF does the same.

## The chain and old data

A chain record is `{ seq, prevHash, rowHash, snapshot }` with `rowHash = sha256(seq|prevHash|canonical(snapshot))`, unchanged since the MVP. The payload under `snapshot` is now a union: `placement-decision/1` (sealed by the MVP, read only), `placement-decision/2`, or `placement-event/1` (consent updates now; placement transitions, approvals and task completions are typed for phase 2). The key keeps its MVP name so old records and exported JSON read the same way.

Migration (`store/migrate.ts`) never touches a sealed record; schema-1 records verify as they are. Schema 2 is written under a new key and the schema-1 copy is left in place, so returning to the earlier deployment loses nothing. `tests/fixtures/schema1-localstorage.json` was produced by the MVP code and is the regression fixture.

## Moving to a pilot

| MVP                        | Pilot                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| localStorage per browser   | Supabase (London, eu-west-2): tables per entity, row-level security per council, MFA                                                                       |
| Demo sign-in (no password) | Council single sign-on with MFA behind `AuthProvider`; the permission matrix enforced again on the server                                                  |
| Chain in JSON              | `decision_snapshot` insert-only table; trigger blocks UPDATE/DELETE; `chain_head` updated in the same transaction; nightly head hash to write-once storage |
| `estimate-v1`              | TravelTime `time-filter/fast` with written storage rights, or self-hosted r5 on BODS + rail GTFS, behind the same `TravelProvider`                         |
| Synthetic places           | GIAS schools, NHS ODS GP and hospital codes, postcodes.io / OS Open UPRN                                                                                   |
| CSV inventory              | Import from the council's Adam / DPS export and leased-stock list (council-sponsored API access)                                                           |
| Typed household            | Pre-fill from the case system (Jigsaw, Locata, NEC) using H-CLIC code lists                                                                                |
| Illustrative LHA table     | DWP January 2011 LHA rates + current subsidy caps, versioned in the rule-set                                                                               |

The engine API doesn't change: `runSearch(input) → SearchResult`.
