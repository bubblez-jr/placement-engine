# V2 build spec: Spenser's review (16 Nov 2026)

Spenser reviewed the MVP at placement.book-flo.com and sent ten points. This spec turns them into buildable work. It is the source of truth for the V2 build; if code and spec disagree, fix one of them in the same commit.

Read first: `CLAUDE.md`, `README.md`, `docs/HOW-IT-DECIDES.md`, `docs/ARCHITECTURE.md`.

## The ten points and what "done" means

| #   | Spenser's point                                                                                                  | Phase |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Form checks: no blank case references, negative ages or incomplete household details                             | 1     |
| 2   | Disability needs trigger the checks: "wheelchair user" asks what access is needed and properties are checked     | 1     |
| 3   | Prevent double bookings: a reserved or booked property stops appearing for overlapping dates                     | 2     |
| 4   | No pre-ticked consent: officers actively record whether consent was given, by whom and when                      | 1     |
| 5   | Emergency placements: where the 6-week B&B limit applies, require a reason, a move-on plan, escalating reminders | 2     |
| 6   | Staff logins and permissions: record the signed-in officer; only managers approve exceptions or change policy    | 1 + 2 |
| 7   | Warnings become tasks: owner, reminders, and completion with evidence                                            | 2     |
| 8   | Real travel and cost information in place of straight-line estimates and example subsidy figures                 | 3     |
| 9   | Complete the booking process: hold, provider confirmation, household acceptance/refusal, check-in, move-out      | 2     |
| 10  | Connect to council systems: import household details, export the decision record                                 | 3     |

## Ground rules for every phase

- Everything in `CLAUDE.md` holds. In particular: the engine stays deterministic and pure (`src/engine/` has no I/O, no `Date.now()`; time comes in as an argument); the officer decides; cost never rescues an unsuitable option; every gate cites a legal or policy basis; synthetic data is labelled.
- **Rules live in the engine, not the screens.** Validation, permissions, the placement state machine, occupancy and task generation are pure functions in `src/engine/` with unit tests. The store enforces them (throws on violation); the UI only presents them. A rule that is enforced only by hiding a button is a bug.
- **Old data must keep working.** Browsers already hold schema-1 demo data. Bump the stored schema to 2 with a migration (`src/store/migrate.ts`, tested with a schema-1 fixture). Schema-1 chain records must still verify and still render in the audit pack and PDF.
- **The chain stays append-only and backward compatible.** `rowHash = sha256(seq|prevHash|canonical(payload))` does not change. The payload becomes a union: a decision snapshot (`placement-decision/1` as today, `placement-decision/2` for new ones) or an event (`placement-event/1`: placement transitions, approvals, consent updates, task completions). Nothing sealed is ever edited; later facts are new records that reference earlier ones.
- **No invented facts.** Do not present any figure as official or real unless it was loaded from a cited source. Illustrative values stay labelled illustrative. No fake "live" integrations.
- **Honest limits.** There is no server yet. Do not fake security or email. Where a point needs a backend (real authentication, emailed reminders, live council connectors), build the part that works in the browser behind an interface that the backend will later implement, label the limit in the UI where an officer would otherwise be misled, and record the remaining step in `docs/PILOT-READINESS.md`.
- **Design system.** Use the tokens and component classes in `src/styles.css` and the pieces in `src/ui/bits.tsx` and `src/ui/icons.tsx`. Light, dark and 390px phone width all have to work; the walkthrough's overflow figure must be 0. Copy is written from the officer's side, in plain English.
- **Accessibility.** Every form error is announced: `aria-invalid`, `aria-describedby`, an error summary at the top of the form that links to each field, focus moved to the summary on a failed submit. Controls keep stable `id`s. Nothing depends on colour alone.
- **Tests.** Each rule gets a test. The five scenarios in `tests/scenarios.test.ts` stay green; if a ranking changes, say why in the commit. Extend `scripts/walkthrough.mjs` to drive every new flow.
- **Done for a phase** = `npm run check` passes, `npm run build` and `npm run build:demo` pass, `npm run walkthrough` passes with overflow 0 and no console errors, the screenshots have been looked at, docs are updated, and the work is committed on the branch `v2-officer-feedback`. Never push to `main`.

## Phase 1: people and data integrity (points 1, 2, 4, 6a)

### 1.1 Staff sign-in, roles and permissions (point 6, first half)

- Seed a synthetic staff directory: two TA officers, an out-of-hours officer, a team manager, a head of service (policy owner), a supply/compliance officer, an auditor (read-only) and an admin. Names are invented and labelled synthetic.
- `src/engine/permissions.ts`: `can(user, action, context?)`, pure and exhaustively tested as a role × action matrix. Actions cover at least: run a search, record a decision, approve an exception, publish policy, import or edit properties, confirm availability, act on a placement, complete or reassign a task, view the audit log, run the tamper demo, reset demo data, import a household, export records.
  - Officers search and decide. Managers and the head of service approve exceptions. Only the head of service (and admin) publishes policy. The auditor reads everything and changes nothing. Nobody approves their own decision.
- An `AuthProvider` interface with one implementation today, `DemoAuth`: a sign-in screen where you choose a demo user. The screen says plainly that this is a demo sign-in with no password and that real sign-in (council single sign-on with MFA) comes with the hosted pilot. The session persists per browser tab group and there is a sign-out.
- The app is unusable until signed in. The rail shows the signed-in person and role, with a "Switch user" control so a demo can show officer and manager views.
- Every store action takes its actor from the session, never from a form field. Remove the free-text name and role inputs from the decision screen and from "publish policy". Decisions, approvals, task completions and policy versions record `{ userId, name, role }` of the signed-in person.
- The store rejects any action the actor may not take (throw a typed `PermissionError`; the UI shows a plain message). Hide or disable controls the user cannot use, with a short reason on disabled ones.

### 1.2 Form validation (point 1)

- `src/engine/validate.ts`: `validateHousehold(household, today) → Issue[]`, each issue `{ path, message, severity: 'error' | 'warning' }`. `runSearch` refuses a household with errors (typed `ValidationError`), so an import cannot bypass the form.
- Errors, at least: blank or whitespace case reference (trim; max 40 characters); no members; no adult (16 or over); age not a whole number from 0 to 120; an "adult" under 16 or a "child" of 18 or over; a partner link that is not mutual or points to a missing person; needed-from date missing, invalid or before today; expected stay not a whole number from 1 to 730; a destination with no person, an unknown person, an invalid arrive-by time or days per week outside 1–7; affordable contribution negative or not a number; a safeguarding zone with radius not between 0.1 and 50 km; unanswered access questions (1.3); a school destination assigned to an adult is a warning, not an error.
- Warnings never block; they are shown and are frozen into the search result.
- The form shows errors inline and in a summary, on submit and then live as fields are corrected. Number inputs cannot silently turn empty input into 0. The "Find placements" button stays enabled (so the summary can explain what is missing) but a failed submit never runs a search.
- A case reference that already has an open search or live placement gets a warning with a link to it.

### 1.3 Access needs follow the person (point 2)

Today `Person.wheelchairUser` changes nothing: only the separate household tick-boxes reach the gates. Fix the model so a declared need cannot be silently ignored.

- When any member is marked as a wheelchair user, or the household has the disability flag, the form opens an **access needs** panel for that person (or the household) with one explicit yes/no answer per need: wheelchair accessible, step-free access, ground floor or lift, adapted bathroom. No answer is pre-selected. Unanswered questions are a validation error.
- Store the answers per person (who needs what, answered by which officer, when). The household's effective access needs are the union of all "yes" answers; the gates in `src/engine/gates.ts` consume that union, and each failing gate names whose need it is by pseudonymous label ("Adult 1 needs step-free access").
- The "reserved accessible unit" rule keys off the effective needs.
- Also ask, when a wheelchair user or the disability flag is present: is an assistance dog part of the household (drives the pets gate), and is there equipment or a carer that changes the bedroom need (a yes adds a note and a warning for now; do not change the bedroom calculation without a tested rule).
- The audit pack and PDF show the access answers. The seeded "wheelchair user fleeing abuse" scenario moves to the new model and keeps its result (only the two accessible units pass).
- Add a regression test for the original bug: a household with a wheelchair user and all access answers "yes" must not be offered a property that fails them; a wheelchair user with unanswered questions cannot be searched.

### 1.4 Consent is recorded, never assumed (point 4)

- Replace the pre-ticked boolean with a consent record: `status: 'given' | 'refused' | 'not_asked'`, `givenBy` (which adult in the household, by label), `method` (in person, phone, written), `recordedBy` (signed-in officer), `recordedAt`, and a note. No default. Where the household includes children the officer must choose before recording a decision.
- `not_asked` needs a reason and creates a follow-up (a task in phase 2; until then a clock entry) inside the s213AA window. `refused` suppresses the notification draft and says so.
- Consent can be updated later as a new chain event (who, when, what changed); the original record is not edited.
- Schema-1 snapshots with the old boolean still render ("consent recorded as yes/no under the earlier version").

### Phase 1 also

- Storage schema 2 and migration; chain payload union and `placement-decision/2`.
- Update the five example households, the walkthrough, `docs/HOW-IT-DECIDES.md` and the README screenshots list.

## Phase 2: the booking and what follows it (points 3, 5, 6b, 7, 9)

### 2.1 Placement lifecycle (point 9)

- A `Placement` is created when a decision that chooses a property is recorded. Pure state machine in `src/engine/placement.ts`:
  `held → provider_confirmed → offered → accepted → checked_in → moved_out`, plus `refused` (from offered), `cancelled` (from any state before check-in, with a reason) and `hold_expired` (a hold not confirmed by its expiry).
- Each transition records who (signed-in user), when, and what it needs: provider confirmation needs the contact's name and a reference; an offer records how it was made; a refusal needs the household's stated reason and flags the case for manager review (the product records it; it draws no legal conclusion); check-in records the actual date; move-out records the actual date, the reason and where the household went (settled home, other temporary accommodation, left, other).
- Hold length is a policy parameter (default 24 hours). Expiry is computed from the time passed in, never from a timer.
- A stay can be extended (new planned end date, with a conflict check and a reason).
- Each transition is appended to the chain as a `placement-event/1`. The decision record page becomes the placement page: a status stepper, the next action, the history, and the existing deadlines and notices.

### 2.2 No double bookings (point 3)

- Occupancy is derived from placements: a property is taken from the placement's start to its planned end (or actual move-out; open-ended while a household is checked in past the planned end). Holds count until they expire; refused, cancelled and expired placements free the dates.
- New hard gate `ALREADY_BOOKED` in `gates.ts`: any overlap between the requested stay and an occupied period removes the property, with the dates in the message and no detail about the other household ("Held for another case until 14:00 on 17 Nov", "Booked 3 Nov to 2 May").
- Recording a decision re-checks occupancy at that moment. If the property was taken since the search ran, refuse, explain, and offer to re-run the search. Cover the race with a test.
- The properties screen shows who (by case reference) occupies each unit and until when. Availability stays the supplier's statement; occupancy is ours.

### 2.3 Manager approval of exceptions (point 6, second half)

- Exceptions are a policy list with defaults: a family in shared-facility accommodation (last resort); an out-of-area placement (tier 4); choosing an option other than the recommendation; a planned stay beyond the B&B limit; a "no suitable option" outcome.
- A decision with an exception is recorded as **awaiting approval**. The property is held. A manager or head of service (not the deciding officer) approves or rejects with reasons; both outcomes are chain events. Rejection releases the hold.
- Provider confirmation, offer and check-in are blocked until approval, with one tested escape for real emergencies: the officer can mark **"placed out of hours, approval to follow"**, with a reason. That unblocks the placement, creates an urgent manager task due 10:00 the next working day, and is prominent in the record.
- Managers get an approvals queue (Overview and its own nav entry with a count).

### 2.4 Emergency and B&B placements (point 5)

- Where the six-week rule applies (a household with children or a pregnant member placed in B&B or shared-facility accommodation), recording the decision requires: a coded emergency reason plus the officer's words, and a move-on plan (target move-on date no later than the limit, the route being pursued, and a named owner). It is always an exception needing approval (2.3).
- It starts an escalation ladder from the placement start, as tasks (2.5): weekly move-on review; day 28 escalate to the team manager; day 35 urgent, one week left; day 42 limit reached, escalate to the head of service, with the breach recorded. The steps are policy parameters with these defaults.
- The placement page shows a day counter against the limit.

### 2.5 Warnings become tasks (point 7)

- `src/engine/tasks.ts` (pure, idempotent, keyed ids) generates tasks from: statutory notices (s208, s213AA); the B&B ladder; consent not yet asked; certificates expiring during a live placement, and certificates expiring within 60 days on any property (owner: supply/compliance); availability or planned stay ending (move-out or extension due); holds about to expire; approvals waiting; refusals awaiting manager review.
- A task has: an owner (a person or a role queue), a due time, a status, and an escalation level computed from due time and now (due soon → overdue → escalated to the manager after a policy number of days). The household's s202 review window is shown as information, not a task.
- Completing a task requires evidence: what was done and a reference (document, email or call reference), stored with who and when, and appended to the chain. Tasks can be reassigned (with a note) and cancelled with a reason by a manager.
- UI: a Tasks screen (mine / my team / all; filter by state), counts in the rail, "my tasks" on the Overview, tasks listed on the placement and property pages.
- Reminders in the MVP are in-app only (counts, overdue and escalated states). Emailed reminders need the hosted backend; say so on the Tasks screen and in `docs/PILOT-READINESS.md`.

## Phase 3: real data in, records out (points 8, 10)

### 3.1 Travel times (point 8)

- Keep the `TravelProvider` interface. Add a `traveltime` provider that calls our own serverless endpoint, never the vendor directly from the browser (the key must not reach the client).
- `api/travel-matrix.ts` (Vercel function, Node runtime, London region): validates input (coordinate ranges, at most 60 origins × 12 destinations), calls the TravelTime time-filter API using `TRAVELTIME_APP_ID` and `TRAVELTIME_API_KEY` from the environment, sends coordinates only, logs nothing personal, and returns minutes and distance per pair. `api/travel-status.ts` says whether keys are configured. Verify the request and response shapes against TravelTime's current documentation before relying on them, and say in the hand-back what could not be verified without a key.
- The client uses TravelTime when configured and falls back to the estimate on any failure. Each search result records which provider produced its journeys and whether a fallback happened; the results screen and audit pack say so in plain words.
- Unit-test the provider and the fallback with a mocked `fetch`. The single-file demo build always uses the estimate.
- Storing vendor journey times in sealed records needs written permission from the vendor: keep that item in `docs/PILOT-READINESS.md`.

### 3.2 Real places (point 8)

- "Add a place by postcode" on the placement form, using the public postcodes.io API to turn a UK postcode into coordinates (with a clear message when the lookup fails or the postcode is unknown). The officer names the place and picks its kind. Synthetic preset places stay available and labelled. Test with a mocked `fetch`.

### 3.3 Subsidy figures (point 8)

- The rule-set's subsidy block gains a status, `illustrative` or `official`, plus a source citation and an "as loaded on" date. The shipped table stays `illustrative` and every screen and record that shows a subsidy figure says which it is.
- The policy screen lets the head of service import the January 2011 LHA table as CSV (BRMA, 1–4 bedroom weekly rates), with the source and date, validated and previewed before it is published as a new signed policy version. Do not ship invented "official" figures.
- School-transport and other secondary costs stay policy parameters, labelled as the council's own assumptions.

### 3.4 Council systems (point 10)

- **Import a household**: paste or upload a JSON document in a documented format (`placement-household/1`, field names aligned to the H-CLIC homelessness return where it has an equivalent). It is validated by `validateHousehold`, shown for review in the normal form, and never searched without the officer pressing "Find placements". Unknown fields are reported, not silently dropped. Ship two example files.
- **Export**: the sealed decision record as JSON (exists), a plain-text case note for pasting into the case system, and a CSV of placements. Exports record who exported what and when as a chain event. (File downloads are disabled in the single-file demo build; copy-to-clipboard works there.)
- `docs/INTEGRATION.md`: the two formats, a field-by-field mapping table, and the route to live connectors (Jigsaw, Locata, NEC, Adam) once a council sponsors API access. No fake connectors in the product.

### Phase 3 also

- Final pass over `README.md`, `docs/HOW-IT-DECIDES.md`, `docs/ARCHITECTURE.md`, `docs/PILOT-READINESS.md` so they describe V2.
- A reply-ready summary for Spenser in `docs/specs/v2-reply-to-spenser.md`: each of his ten points, what was built, and what still needs a backend, a key or a council.

## What needs Jorge, not code

- A TravelTime account and keys (set as Vercel environment variables) to switch real journey times on.
- The official DWP January 2011 LHA table as a file to import.
- A decision on the hosted backend (Supabase, London) for real sign-in, shared data between officers and emailed reminders: that is the step from demo to pilot.
