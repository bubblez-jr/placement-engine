# How the engine decides

Everything here is deterministic, versioned and testable. The same household, inventory and policy version always give the same answer. Numbers are illustrative defaults for the demo council, _Demo Borough_. A real council sets its own values in the placement policy screen, and each change is signed off with an equality note.

## 0. Checks on the household details

Before any property is looked at, `validateHousehold()` (`src/engine/validate.ts`) checks what was entered. The search refuses to run while there is an error, whether the household came from the form or any other route, so an import cannot skip it. Warnings never block; they are shown and frozen into the search result.

**Errors** (the search will not run):

- case reference blank, or over 40 characters after trimming;
- nobody in the household, or nobody aged 16 or over;
- an age that is not a whole number from 0 to 120; an "adult" under 16; a "child" of 18 or over;
- a partner link that is not mutual, or points to someone not in the household;
- date needed missing, not a real date, or in the past; expected stay not a whole number from 1 to 730 nights;
- a place with no person or an unknown person, an invalid arrive-by time, or days a week outside 1 to 7;
- what the household can pay is negative or not a number; an exclusion zone radius outside 0.1 to 50 km;
- an access question left unanswered (0.1).

**Warnings** (shown, frozen with the search, never blocking): a school set against an adult; the case already has an open search or a placement (with a link to it); equipment or a carer that could change the bedroom need; a wheelchair user answered "no" to a wheelchair-accessible home.

### 0.1 Access needs follow the person

Marking a person as a wheelchair user opens six yes/no questions for that person; the household's disability flag opens them for the household when nobody is marked as a wheelchair user. Nothing is pre-selected and an unanswered question is an error. The questions: wheelchair-accessible home, step-free access, ground floor or lift, adapted bathroom, an assistance dog, and equipment or a carer that could change the bedroom need.

The property checks use the **union of every "yes"**, and each failed check names whose need it is ("Adult 1 needs step-free access: this property does not have it"). An assistance dog drives the pets check. Equipment or a carer adds a warning only: the bedroom count does not change without a tested rule. Each answer records which officer gave it and when. Household-level needs recorded under the earlier version are still applied, never dropped.

## 1. Hard gates

Every property is checked. A failed **block** removes it, with a reason the officer and the audit pack can see. A **warn** keeps it in but flags something to check.

| Gate                                     | Rule                                                                                                                                                             | Basis                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Approved supplier                        | Supplier is on the council's DPS / framework                                                                                                                     | Procurement Act 2023; council contract                            |
| Availability                             | Available on the date needed; availability not ended                                                                                                             | Council policy                                                    |
| Stale availability _(warn)_              | Last confirmed more than 72 hours ago                                                                                                                            | Council policy                                                    |
| Too few bedrooms                         | Below the LHA size criteria (couples share; under-10s share; same-sex under-16s share; 16+ own room)                                                             | HA 1996 s210; HA 1985 Part 10                                     |
| Too large                                | More than 1 bedroom above need (keeps large homes for large families)                                                                                            | Council allocation policy                                         |
| Accessible unit reserved                 | Adapted units go only to households whose access answers need a wheelchair-accessible home or an adapted bathroom                                                | Council allocation policy                                         |
| Capacity                                 | Sleeps at least the household size                                                                                                                               | HA 1996 s210                                                      |
| Access must-haves                        | Every "yes" access answer (0.1): step-free, wheelchair accessible, ground floor or lift, adapted bathroom. The message names whose need fails                    | Equality Act 2010; Code ch.17                                     |
| Pets                                     | An assistance dog (from the access answers, named) or a pet accommodated, where required                                                                         | Council policy                                                    |
| Certificates                             | Gas (if gas), EICR, EPC band A–E, smoke and CO alarms, fire risk assessment (HMO / shared), HMO licence, council inspection; valid on the date needed            | 2012 Suitability Order art.3 and the regulations behind each item |
| Certificate expires during stay _(warn)_ |                                                                                                                                                                  | as above                                                          |
| Shared facilities for a family           | B&B or shared annex for a household with children or a pregnant member. Admitted **only if nothing else passes**, then flagged "last resort" with a 6-week clock | 2003 B&B Suitability Order                                        |
| Safeguarding zone                        | Inside a restricted radius. The reason is never shown                                                                                                            | Code ch.17; council safeguarding policy                           |
| Affordability                            | Charges the household pays (not covered by housing benefit) within its assessed amount                                                                           | 1996 Suitability Order (affordability)                            |

## 2. Journeys

For each eligible property: public-transport minutes to every place the household recorded (school, work, treatment, care, support) and to the last settled area. The MVP uses `estimate-v1`, which works from straight-line distance and is labelled everywhere it appears (`src/travel/estimate.ts`). The engine only sees the `TravelProvider` interface, so TravelTime or a self-hosted r5 router can replace it without touching scoring.

## 3. Suitability score (0–100)

Each factor gets a **value** from 0 to 1, from a piecewise-linear scale the council sets. Score = Σ weight × value, with weights renormalised to sum to 100 over the factors that apply to this household.

| Factor               | Measure                                                              | Default scale                             | Weight | Legal factor                 |
| -------------------- | -------------------------------------------------------------------- | ----------------------------------------- | ------ | ---------------------------- |
| School journey       | Longest child's journey                                              | 15 min → 1 · 30 → 0.8 · 45 → 0.5 · 75 → 0 | 22     | 2012 Order art.2(b)          |
| Journey to work      | Longest                                                              | 20 → 1 · 45 → 0.6 · 90 → 0                | 10     | art.2(b)                     |
| Journey to treatment | Longest                                                              | 15 → 1 · 30 → 0.7 · 60 → 0.2 · 90 → 0     | 12     | art.2(c)                     |
| Care or support      | Longest                                                              | 15 → 1 · 45 → 0.5 · 90 → 0                | 8      | art.2(b)–(c)                 |
| Location             | Tier 1 in borough · 2 neighbouring · 3 within 90 min · 4 out of area | 1 · 0.75 · 0.35 · 0                       | 18     | art.2(a)                     |
| Facilities           | Self-contained / shared kitchen or bathroom / B&B                    | 1 · 0.4 · 0.15                            | 12     | Code ch.17                   |
| Condition            | Inspection grade A / B / C / none                                    | 1 · 0.7 · 0.35 · 0.5                      | 10     | art.3; s210                  |
| Covers the stay      | Share of expected nights the property is available                   | 0–1                                       | 8      | Council policy (fewer moves) |

**Priority flags** multiply weights before renormalising. Exam year ×1.5 on school; ongoing treatment ×1.75 on treatment; employment ×1.3 on work; child protection plan ×1.5 on location and ×1.3 on support; caring duties ×1.5 on support; domestic abuse ×1.3 on support; disability ×1.3 on treatment.

Factors that don't apply (for example, no school-age children) are left out and their weight is shared among the rest.

## 4. Net cost, by who pays

Cost is shown **beside** suitability, never folded into the score.

- **TA budget, net per night** = nightly charge − housing benefit subsidy.
- **Subsidy** = the lowest of: the charge; 90% × the January 2011 LHA weekly rate for the property's area (BRMA) and size (one-bed rate if facilities are shared); £500/week in inner London BRMAs, £375 elsewhere. All are rule-set parameters. **The demo figures are illustrative**: load the DWP table before real use.
- **Education** = travel to an existing school after the move, where the council funds it: journey over 45 minutes, outside London, or a SEND taxi (£/km × 2). Under-16s ride London buses free, so most London moves cost education nothing.
- **Household** = travel the family pays, plus charges housing benefit doesn't cover.
- **Public cost of the stay** = (TA net + education) × the expected stay.
- **Risks** are listed, not costed: the Ombudsman remedy range when a family stays in shared accommodation past 6 weeks, and out-of-area placements.

## 5. Recommendation

1. Rank eligible options by suitability (ties: lower public cost).
2. Among options within the **cost tie-break band** (3 points) of the top score, recommend the one with the lowest public cost. Cost can choose between suitable options; it cannot make an unsuitable option suitable.
3. **Sensitivity**: for each factor, move its weight −20% and +20%, renormalise and re-pick. If the recommendation never changes it is **robust**; otherwise it is a **close call** and the screen says so.
4. **Best trade-off** marks options where no other option is both more suitable and cheaper.

## 6. Explanation

`src/engine/explain.ts` builds sentences from the numbers. It names the two factors where the recommendation beats the runner-up by the most points, splits the cost difference by budget, and lists every warning. A language model may later reword these sentences. It must never compute or invent them.

## 7. The officer's decision

The officer signs in first. The record takes the decider's name and role from the signed-in session, never from a form field. In this demo the sign-in is a labelled demo sign-in with no password; a pilot uses the council's single sign-on with MFA ([pilot readiness](PILOT-READINESS.md)).

The officer must actively choose:

- **Accept**, with an optional note.
- **Choose another option**, with a reason code and their own words (at least 20 characters).
- **No suitable option**, with the search steps taken.

Where a placement is made for a household with children, they also record **consent** to tell the children's school, GP and health visitor (s213AA): given or refused (by which adult, and how: in person, by phone or in writing), or not asked yet (with the reason). Nothing is pre-selected. Not asked adds a follow-up deadline 7 days after the start, inside the 14-day notice window; refused means no notice is drafted, and the record says so. A later answer is recorded as a new sealed record that points to the decision; the decision itself is never edited.

These rules live in `src/engine/decision.ts` and the store checks them before sealing, as it checks the permissions in section 9.

They confirm they reviewed the full list. The record also logs when the list was opened, which property details were opened, and whether the comparison was used. This is the evidence of meaningful human involvement that UK GDPR Art.22A–D (from 5 Feb 2026) expects when health or disability data is used.

## 8. The seal

At decision time the engine freezes a snapshot (`placement-decision/2`; records sealed by the MVP are `placement-decision/1` and still verify and render): the search, every candidate with every check, the policy version and hash, the properties as held, the decision, and the statutory clocks. It is serialised as canonical JSON (sorted keys) and hashed with SHA-256 together with the previous record's hash. Editing any past record breaks its hash and every hash after it. The audit log can check the whole chain, and has a tamper demonstration.

Later facts about a decision are their own records in the same chain (`placement-event/1`), each pointing to the decision's sequence number and hash. Phase 1 writes consent updates; placements, approvals and task completions follow in phase 2.

Statutory clocks set from the start date:

- s208 notice to the receiving council (14 days).
- The 6-week limit for families in shared accommodation.
- s213AA notification to school, GP and health visitor (14 days, with consent; none if consent was refused).
- Ask for consent (7 days), when it was not asked at placement.
- The household's 21-day window to request a review.
- The date availability ends, if that is within the stay.

## 9. Who may do what

`src/engine/permissions.ts` holds the rules as a role × action table, tested in full. The store checks them before every change, so a hidden button is never the only safeguard.

|                                          | TA / out-of-hours officer | Team manager | Head of service | Supply and compliance | Auditor | Admin |
| ---------------------------------------- | :-----------------------: | :----------: | :-------------: | :-------------------: | :-----: | :---: |
| Run a search, record a decision, consent |            Yes            |     Yes      |       Yes       |                       |         |       |
| Approve an exception (phase 2)           |                           |     Yes      |       Yes       |                       |         |       |
| Publish placement policy                 |                           |              |       Yes       |                       |         |  Yes  |
| Import or edit properties                |                           |              |                 |          Yes          |         |  Yes  |
| Confirm availability                     |            Yes            |     Yes      |       Yes       |          Yes          |         |  Yes  |
| View the audit log, export records       |            Yes            |     Yes      |       Yes       |          Yes          |   Yes   |  Yes  |
| Run the tamper demonstration             |            Yes            |     Yes      |       Yes       |          Yes          |         |  Yes  |
| Reset the demo data                      |                           |              |                 |                       |         |  Yes  |

Nobody approves their own decision. The auditor reads everything and changes nothing.
