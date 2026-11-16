# Architecture

A single-page React app (Vite, TypeScript, Tailwind v4). The engine is plain TypeScript with no UI or storage dependencies, so the same code can later run in a Supabase Edge Function or a Node service.

```
src/
  engine/          pure decision logic (no I/O)
    types.ts         domain model: Household, Property, Ruleset, Candidate, SearchResult, Decision, staff and actors
    validate.ts      validateHousehold(): errors and warnings; runSearch refuses a household with errors
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
    provider.ts      TravelProvider interface (matrix of minutes)
    estimate.ts      demo estimate from straight-line distance
  audit/
    canonical.ts     canonical JSON
    hash.ts          SHA-256 (Web Crypto)
    chain.ts         append-only hash chain + verification
    snapshot.ts      chain payloads: decision snapshots (v1, v2) and events
    records.ts       version-aware read views shared by every screen: decider, consent now, deadlines now,
                     placements, approvals, tasks, and the story of a decision for the audit pack
    ruleset.ts       rule-set hashing
  auth/            AuthProvider interface, DemoAuth (labelled demo sign-in), session context
  data/            synthetic demo data (households, properties, places, staff) + CSV import/export
  store/
    data.ts          AppData (schema 2), seed
    migrate.ts       schema 1 → 2 on load
    commands.ts      every change: takes the actor from the session, checks permissions and rules, returns new data
    demo.ts          synthetic demo history, sealed through the same commands; demo reset
    app.tsx          React context wiring commands to state and localStorage; the coarse clock; nav.tsx in-page router
  ui/              screens and shared components
  pdf/             audit pack PDF (@react-pdf/renderer, lazy-loaded)
tests/             Vitest: engine units, five end-to-end scenarios, audit chain, CSV
scripts/           headless-browser walkthrough with screenshots
```

## Data flow

1. Nothing renders until someone signs in. `auth/` holds the `AuthProvider` interface; today's `DemoAuth` lets you pick a synthetic staff member, with no password, for the length of the browser tab. A pilot adds a single sign-on implementation behind the same interface.
2. `store/app.tsx` loads demo data from localStorage (key `placement-engine/v2`), migrating schema-1 data from the MVP's key if that is all there is, or seeds it: one hashed rule-set, 26 properties, 6 suppliers and the synthetic demo history (below).
3. Every change goes through `store/commands.ts`. Each command takes the actor from the session, calls `assertCan()` and the engine's validation, and returns new data. The React layer only reads the clock and the session at the edge and saves the result.
4. **New placement** builds a `Household`; `cmdSearch` works out occupancy at that moment and calls `runSearch()`, which validates the household first and refuses on errors. The `SearchResult` keeps the warnings and who ran it.
5. Screens read the stored result. Opening the results, property details and the comparison updates a review log kept in memory.
6. `cmdDecide` checks the decision, consent and six-week rules, checks again that nobody has taken the property since the search ran, builds a `placement-decision/2` snapshot with the signed-in actor, the consent record and the decision's terms (exceptions, hold, planned end, move-on plan), computes statutory clocks, appends it to the hash chain and stores it. A later consent answer is a `placement-event/1` record pointing to the decision.
7. The placement page, the Tasks and Approvals screens and the properties screen show what `audit/records.ts` and the engine work out from the chain, the inventory and `now`: placements, occupancy, approvals and tasks. Each step, approval, extension and task completion is a command that appends a `placement-event/1` record (step 6).
8. The audit pack renders from the sealed records only, never from live data, through `audit/records.ts` so schema-1 and V2 records share one code path. The PDF does the same. Its only time-dependent line, where things stand now, is labelled as worked out when the pack was opened.

## Time

The engine and the commands never read the clock: `now` is an argument. Hold expiry, due and escalation states, the six-week day counter and "10:00 the next working day" are all computed from it, in UK time (`Europe/London`, with summer time, from the standard time-zone data, so the answer is the same on every run).

The React store reads the clock at the edge. Screens use the store's `now`, which ticks every 30 seconds, when the tab regains focus and after every change, so a page left open does not go stale. Commands get a fresh time when they run. Nothing derived from the viewing time is sealed: a record holds only the time it was made and facts computed from that (a hold's end, an out-of-hours approval's due time).

## What is stored and what is worked out

Stored (sealed) facts: decisions with their terms, each placement step, changed planned ends, approvals and rejections, "placed out of hours", consent updates, and task completions, reassignments and cancellations. Worked out on demand by pure functions: a placement's state (including an expired hold), occupancy, the approval state, and the whole task list. Two derived things are sealed on purpose, as evidence of what applied at the time: a decision's terms (exceptions, hold end, planned end), and the title of a task when it is completed or moved, so a completed task still reads correctly after its trigger has gone.

## The chain and old data

A chain record is `{ seq, prevHash, rowHash, snapshot }` with `rowHash = sha256(seq|prevHash|canonical(snapshot))`, unchanged since the MVP. The payload under `snapshot` is a union: `placement-decision/1` (sealed by the MVP, read only), `placement-decision/2` (with `terms` from phase 2), or `placement-event/1` (consent updates, placement steps, changed planned ends, approvals, out-of-hours approval to follow, and task completions, reassignments and cancellations). An event points to its decision (`about`), or, for a task about a property, to the property (`about: null`, `propertyId`). The key keeps its MVP name so old records and exported JSON read the same way.

Migration (`store/migrate.ts`) never touches a sealed record; schema-1 records verify as they are. Schema 2 is written under a new key and the schema-1 copy is left in place, so returning to the earlier deployment loses nothing. Phase 2 adds no storage change: its records are new payload types in the same chain. Decisions sealed before phase 2 have no `terms` and are read as a placement held from the decision time under the default policy, with no exceptions (`placementBaseOf()` in `audit/records.ts`). `tests/fixtures/schema1-localstorage.json` was produced by the MVP code and `tests/fixtures/schema2-localstorage.json` by the phase 1 code; both are regression fixtures.

## Demo history

A fresh browser, and "Reset demo data", get synthetic history from `store/demo.ts`: the same commands an officer uses, run at backdated times as the synthetic staff member who would have acted, so every permission and rule is checked and every record verifies. Each record carries a "Seeded demo history" note and the placement page labels it.

## Moving to a pilot

| MVP                        | Pilot                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| localStorage per browser   | Supabase (London, eu-west-2): tables per entity, row-level security per council, MFA. Occupancy shared by every officer, with the decide-time check in one transaction |
| In-app reminders           | Scheduled job on the server works out tasks at its own `now` and emails owners and escalation targets                                                                  |
| Demo sign-in (no password) | Council single sign-on with MFA behind `AuthProvider`; the permission matrix enforced again on the server                                                              |
| Chain in JSON              | `decision_snapshot` insert-only table; trigger blocks UPDATE/DELETE; `chain_head` updated in the same transaction; nightly head hash to write-once storage             |
| `estimate-v1`              | TravelTime `time-filter/fast` with written storage rights, or self-hosted r5 on BODS + rail GTFS, behind the same `TravelProvider`                                     |
| Synthetic places           | GIAS schools, NHS ODS GP and hospital codes, postcodes.io / OS Open UPRN                                                                                               |
| CSV inventory              | Import from the council's Adam / DPS export and leased-stock list (council-sponsored API access)                                                                       |
| Typed household            | Pre-fill from the case system (Jigsaw, Locata, NEC) using H-CLIC code lists                                                                                            |
| Illustrative LHA table     | DWP January 2011 LHA rates + current subsidy caps, versioned in the rule-set                                                                                           |

The engine API doesn't change: `runSearch(input) → SearchResult`.
