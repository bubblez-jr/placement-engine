# Architecture

A single-page React app (Vite, TypeScript, Tailwind v4) and two small serverless functions that hold the journey-time key. The engine is plain TypeScript with no UI or storage dependencies, so the same code can later run in a Supabase Edge Function or a Node service.

```
api/               Vercel functions (Node.js runtime, London region): the only code that sees the TravelTime key
  travel-matrix.ts   POST coordinates and arrival times → minutes and distances (wires _lib/handlers.ts)
  travel-status.ts   GET whether TravelTime is configured; ?check=1 makes one small real request
  _lib/contract.ts   the browser ↔ function contract and its strict validation (shared with the client)
  _lib/traveltime.ts everything TravelTime-specific: request builder, response parser, limits, error mapping
  _lib/handlers.ts   the functions' logic as plain functions of a Request, tested with a mocked fetch
src/
  engine/          pure decision logic (no I/O)
    types.ts         domain model: Household, Property, Ruleset, Candidate, SearchResult, Decision, staff and actors
    validate.ts      validateHousehold(): errors and warnings; runSearch refuses a household with errors
    journeys.ts      the day journeys are planned for; what a search records about where its journey times came from
    householdImport.ts  reading a placement-household/1 file into a household for the form (never searches)
    subsidyTable.ts  checks on an official LHA table (CSV): columns, plausibility, duplicates, citation; the diff
    csvLine.ts       one CSV line into cells
    access.ts        access needs per person: required questions, effective needs (union of "yes"), labels
    permissions.ts   can(user, action, context): the role × action matrix; assertCan() throws PermissionError
    decision.ts      decision and consent rules; exceptions; the six-week emergency reason and move-on plan
    placement.ts     placement state machine: steps, what each needs, approval gating, extensions, foldPlacement()
    occupancy.ts     who holds or occupies which property when, as night ranges; conflict messages
    tasks.ts         deriveTasks(): every task at `now`, idempotent, with escalation; completion rules
    policy.ts        hold, approval, ladder and task parameters (defaults for older policy versions)
    text.ts          quoting someone's words
    bedrooms.ts      LHA size criteria (bedroom need), family test
    gates.ts         hard gates with legal basis; required certificates
    scoring.ts       applicable factors, effective weights, value functions, location tiers
    cost.ts          subsidy, net TA cost, education and household costs, risks
    search.ts        runSearch(): journeys → gates → scores → cost → rank → sensitivity → explanation
    explain.ts       plain-English templates (recommendation, comparisons, rejections)
    clocks.ts        statutory deadlines from a decision
    dates.ts         dates, UK wall-clock time and working days, all from an instant passed in
  travel/
    provider.ts      TravelProvider interface: a matrix of minutes, each with its source, and a run summary
    estimate.ts      estimate from straight-line distance (the demo, and the fallback)
    traveltime.ts    the browser side of TravelTime: calls this site's functions, falls back to the estimate, says why
  places/
    postcodes.ts     a UK postcode to a location with postcodes.io (from the browser; postcode only)
  audit/
    canonical.ts     canonical JSON
    hash.ts          SHA-256 (Web Crypto)
    chain.ts         append-only hash chain + verification
    snapshot.ts      chain payloads: decision snapshots (v1, v2) and events
    records.ts       version-aware read views shared by every screen: decider, consent now, deadlines now,
                     placements, approvals, tasks, and the story of a decision for the audit pack
    provenance.ts    where a search's journey times and subsidy figures came from (older searches: estimate, illustrative)
    exports.ts       the case note, the placements CSV and the decision JSON, built from sealed records
    ruleset.ts       rule-set hashing
  auth/            AuthProvider interface, DemoAuth (labelled demo sign-in), session context
  data/            synthetic demo data (households, properties, places, staff) + CSV import/export
  store/
    data.ts          AppData (schema 2), seed
    migrate.ts       schema 1 → 2 on load
    commands.ts      every change: takes the actor from the session, checks permissions and rules, returns new data;
                     also the household import (read only), exports (sealed first) and the subsidy table
    demo.ts          synthetic demo history, sealed through the same commands; demo reset
    app.tsx          React context wiring commands to state and localStorage; the coarse clock; nav.tsx in-page router
  ui/              screens and shared components
  pdf/             audit pack PDF (@react-pdf/renderer, lazy-loaded)
tests/             Vitest: engine units, five end-to-end scenarios, audit chain, CSV, the functions and providers with a mocked fetch
scripts/           headless-browser walkthrough with screenshots (both builds; outside services answered by Playwright routes)
docs/examples/     two synthetic household files in the import format
```

## Data flow

1. Nothing renders until someone signs in. `auth/` holds the `AuthProvider` interface; today's `DemoAuth` lets you pick a synthetic staff member, with no password, for the length of the browser tab. A pilot adds a single sign-on implementation behind the same interface.
2. `store/app.tsx` loads demo data from localStorage (key `placement-engine/v2`), migrating schema-1 data from the MVP's key if that is all there is, or seeds it: one hashed rule-set, 26 properties, 6 suppliers and the synthetic demo history (below).
3. Every change goes through `store/commands.ts`. Each command takes the actor from the session, calls `assertCan()` and the engine's validation, and returns new data. The React layer only reads the clock and the session at the edge and saves the result.
4. **New placement** builds a `Household`, typed, or imported from a file (`cmdImportHousehold` reads it and stamps who imported it; it never searches), with places picked from the synthetic examples or found by postcode. `cmdSearch` works out occupancy at that moment and calls `runSearch()`, which validates the household first and refuses on errors, then asks the travel provider for journeys (below). The `SearchResult` keeps the warnings, who ran it, where its journey times came from and which subsidy figures its costs used.
5. Screens read the stored result. Opening the results, property details and the comparison updates a review log kept in memory.
6. `cmdDecide` checks the decision, consent and six-week rules, checks again that nobody has taken the property since the search ran, builds a `placement-decision/2` snapshot with the signed-in actor, the consent record and the decision's terms (exceptions, hold, planned end, move-on plan), computes statutory clocks, appends it to the hash chain and stores it. A later consent answer is a `placement-event/1` record pointing to the decision.
7. The placement page, the Tasks and Approvals screens and the properties screen show what `audit/records.ts` and the engine work out from the chain, the inventory and `now`: placements, occupancy, approvals and tasks. Each step, approval, extension and task completion is a command that appends a `placement-event/1` record (step 6).
8. The audit pack renders from the sealed records only, never from live data, through `audit/records.ts` so schema-1 and V2 records share one code path. The PDF does the same. Its only time-dependent line, where things stand now, is labelled as worked out when the pack was opened.
9. Exports (`cmdExport`) build the case note, CSV or JSON from sealed records, seal a `records_exported` event with a SHA-256 fingerprint of the content, and only then hand the content to the screen to download or copy ([INTEGRATION.md](INTEGRATION.md)).

## Journey times

`runSearch` works out the day to plan for from the date needed: the first Tuesday, Wednesday or Thursday on or after it, outside the summer, Christmas and Easter school holidays (`journeyPlanningDate`, pure). Each place keeps its own arrive-by time; the last settled area is planned for 09:00. It then calls the `TravelProvider` it was given.

- The **single-file demo** (`npm run build:demo`) always uses the estimate and contains no call to the functions.
- The **hosted build** uses `createTravelTimeProvider` (`src/travel/traveltime.ts`): it asks `/api/travel-status` once, and if TravelTime is configured posts coordinates and arrival times to `/api/travel-matrix` in pieces of at most 60 properties × 12 places. On any failure (not configured, the status check failing, a refused request, a bad key, a rate limit, a timeout, an answer of the wrong shape or size) it uses the estimate for every journey and records why. Pairs TravelTime does not answer are filled with the estimate and marked. A "no route" answer (nothing within 4 hours) is kept as no route.
- Seeded demo history and the tests use the estimate.

The search records, per journey, `source: 'traveltime' | 'estimate'`, and for the search: what was asked for, the outcome (`measured`, `estimated` or `mixed`), the fallback reason and how many journeys it covered, the planning day, and the counts. The results, the property page, the comparison, the audit pack, the PDF, the case note and the CSV say so in words. Searches recorded before phase 3 have none of these fields and read as the estimate.

**Unverified until a key exists.** `api/_lib/traveltime.ts` was written from TravelTime's public v4 `time-filter` documentation without a key or network access. Not verified: the request field names and nesting (`locations[].coords`, `arrival_searches[]` with `arrival_location_id`, `departure_location_ids`, `transportation.type`, `arrival_time`, `travel_time`, `properties`); the response shape (`results[].search_id`, `locations[].properties` as a list, `unreachable`); the limits used (4 hours as the most `travel_time`, 10 searches per request); whether `distance` comes back for public transport; which HTTP statuses mean a bad key, a rate limit or a bad request; and whether TravelTime plans on the exact date asked or maps it onto its own timetable period. Each wrong guess fails loudly (an error code, the estimate, a warning on the results) rather than producing plausible minutes. Also not verified: deployment on Vercel itself (the functions use the Web `Request`/`Response` handler signature and `.js` import specifiers for ESM; they compile and run under plain Node here, but no deployment was made).

**Switching it on:** a TravelTime account; `TRAVELTIME_APP_ID` and `TRAVELTIME_API_KEY` set as Vercel environment variables (Production); redeploy; open `/api/travel-status?check=1` and see `"configured": true` and `"check": { "ok": true, … }`; run a search and see "Public transport times from TravelTime" at the top of the results. Written permission from TravelTime to store their times in sealed records is still needed ([PILOT-READINESS.md](PILOT-READINESS.md)).

## Costs and the subsidy table

The rule-set's subsidy block has a status: `illustrative` (the shipped table, and every version published before phase 3, which has no status) or `official`, which also needs a citation, the source document's date and the day it was loaded (`subsidyStatusOf` in `engine/cost.ts`). The official table comes in only through `cmdPublishSubsidyTable`, which runs the CSV checks again and publishes a new signed version; the weights screen cannot change the table. Every cost basis, the cost explanation and every screen and record that shows a subsidy figure says which it is. School transport fares and taxi rates are labelled as the council's own assumptions.

## Time

The engine and the commands never read the clock: `now` is an argument. Hold expiry, due and escalation states, the six-week day counter and "10:00 the next working day" are all computed from it, in UK time (`Europe/London`, with summer time, from the standard time-zone data, so the answer is the same on every run).

The React store reads the clock at the edge. Screens use the store's `now`, which ticks every 30 seconds, when the tab regains focus and after every change, so a page left open does not go stale. Commands get a fresh time when they run. Nothing derived from the viewing time is sealed: a record holds only the time it was made and facts computed from that (a hold's end, an out-of-hours approval's due time).

## What is stored and what is worked out

Stored (sealed) facts: decisions with their terms, each placement step, changed planned ends, approvals and rejections, "placed out of hours", consent updates, and task completions, reassignments and cancellations. Worked out on demand by pure functions: a placement's state (including an expired hold), occupancy, the approval state, and the whole task list. Two derived things are sealed on purpose, as evidence of what applied at the time: a decision's terms (exceptions, hold end, planned end), and the title of a task when it is completed or moved, so a completed task still reads correctly after its trigger has gone.

## The chain and old data

A chain record is `{ seq, prevHash, rowHash, snapshot }` with `rowHash = sha256(seq|prevHash|canonical(snapshot))`, unchanged since the MVP. The payload under `snapshot` is a union: `placement-decision/1` (sealed by the MVP, read only), `placement-decision/2` (with `terms` from phase 2), or `placement-event/1` (consent updates, placement steps, changed planned ends, approvals, out-of-hours approval to follow, and task completions, reassignments and cancellations). An event points to its decision (`about`), or, for a task about a property, to the property (`about: null`, `propertyId`). The key keeps its MVP name so old records and exported JSON read the same way.

Migration (`store/migrate.ts`) never touches a sealed record; schema-1 records verify as they are. Schema 2 is written under a new key and the schema-1 copy is left in place, so returning to the earlier deployment loses nothing. Phase 2 adds no storage change: its records are new payload types in the same chain. Phase 3 adds none either: its new fields (journey provenance, the subsidy status, place sources, the import record) are optional and read with defaults, and the export record is a new event type (`records_exported`; `about` and `caseRef` are null for an export of every placement). Decisions sealed before phase 2 have no `terms` and are read as a placement held from the decision time under the default policy, with no exceptions (`placementBaseOf()` in `audit/records.ts`). `tests/fixtures/schema1-localstorage.json` was produced by the MVP code and `tests/fixtures/schema2-localstorage.json` by the phase 1 code; both are regression fixtures.

## Demo history

A fresh browser, and "Reset demo data", get synthetic history from `store/demo.ts`: the same commands an officer uses, run at backdated times as the synthetic staff member who would have acted, so every permission and rule is checked and every record verifies. Each record carries a "Seeded demo history" note and the placement page labels it.

## Moving to a pilot

| MVP                                           | Pilot                                                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| localStorage per browser                      | Supabase (London, eu-west-2): tables per entity, row-level security per council, MFA. Occupancy shared by every officer, with the decide-time check in one transaction        |
| In-app reminders                              | Scheduled job on the server works out tasks at its own `now` and emails owners and escalation targets                                                                         |
| Demo sign-in (no password)                    | Council single sign-on with MFA behind `AuthProvider`; the permission matrix enforced again on the server                                                                     |
| Chain in JSON                                 | `decision_snapshot` insert-only table; trigger blocks UPDATE/DELETE; `chain_head` updated in the same transaction; nightly head hash to write-once storage                    |
| Estimate, or TravelTime once the keys are set | TravelTime with written storage rights (verified with a live key), or self-hosted r5 on BODS + rail GTFS, behind the same `TravelProvider`; the functions behind real sign-in |
| Synthetic places and postcode lookup          | GIAS schools, NHS ODS GP and hospital codes as pick lists; postcodes.io or OS Open UPRN                                                                                       |
| CSV inventory                                 | Import from the council's Adam / DPS export and leased-stock list (council-sponsored API access)                                                                              |
| Typed or file-imported household              | A server-side connector to the case system (Jigsaw, Locata, NEC) producing the same `placement-household/1` format                                                            |
| Illustrative LHA table, official import built | The DWP January 2011 table loaded by the head of service, with the subsidy formula confirmed by the council's benefits team                                                   |
| Exports per browser                           | Exports recorded centrally; case notes pushed to the case system by a connector                                                                                               |

The engine API doesn't change: `runSearch(input) → SearchResult`.
