# Connecting to council systems and outside services

Placement Engine does not connect to any case management system, booking platform or council database today. What it has is a file-based bridge: a household comes in as a file, and the decision goes back out as files. The formats below are the contract. A live connector, when a council sponsors API access, produces and consumes the same formats on a server; the engine and the screens do not change.

There are no fake connectors in the product. Nothing on screen says "connected to Jigsaw" or similar.

## 1. Importing a household: `placement-household/1`

**Where:** New placement → **Import from the case system**: choose a file, paste it, or try one of the two synthetic example files (`docs/examples/household-family-of-four.json`, `docs/examples/household-wheelchair-user.json`).

**What happens:**

1. The file is read by `parseHouseholdImport()` (`src/engine/householdImport.ts`). Every field is either read or listed under "Not used" with its path and why. Nothing is dropped silently.
2. The household fills the normal form. The officer sees what was read, what was not, and every problem the household checks find (`validateHousehold`, the same checks the form and the search use).
3. **Nothing is searched.** The officer reviews, fixes what is marked and presses **Find placements**. The search checks the household again, so an import cannot skip a rule. An imported wheelchair user with no access answers cannot be searched until an officer answers them.
4. The search records that the details were imported, from which system (as the file says), by whom (the signed-in officer, never the file) and when. The audit pack and PDF show it.

Importing needs the `import_household` permission (officers, managers, head of service, administrator). It changes no data.

**Values of the wrong type** (an age written as text) are reported and left blank for the officer. **Values of the right type that break a rule** (a negative age, a date in the past) are kept, so the form shows the error against the field. A place without coordinates is not imported, and the report says to add it by postcode.

### Fields

All fields except `format` and `members` are optional; anything missing is asked for on the form. The "nearest H-CLIC concept" column is for orientation only: the exact H-CLIC field codes and code lists must be checked against the H-CLIC specification version the council submits, and a connector maps them on the server.

| Field                                          | Type                                                                                                                                                               | Placement Engine                                  | Nearest H-CLIC concept (to confirm)                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `format`                                       | `"placement-household/1"`                                                                                                                                          | Required                                          | None                                                                           |
| `source.system`, `source.exported_at`          | text                                                                                                                                                               | Shown to the officer; kept with the search        | None                                                                           |
| `case_reference`                               | text, up to 40 characters                                                                                                                                          | Case reference                                    | The council's own case reference                                               |
| `date_needed`                                  | `YYYY-MM-DD`                                                                                                                                                       | Needed from                                       | None (H-CLIC records the date temporary accommodation started, afterwards)     |
| `expected_stay_nights`                         | whole number, 1 to 730                                                                                                                                             | Expected stay                                     | None                                                                           |
| `last_settled_area`                            | `{ "label", "lat", "lng" }`                                                                                                                                        | Last settled area (location tier, distance)       | Last settled accommodation (H-CLIC records its type and area)                  |
| `members[]`                                    | list                                                                                                                                                               | The household                                     | People in the household                                                        |
| `members[].ref`                                | text                                                                                                                                                               | Links people to places and partners only          | Person identifier within the case                                              |
| `members[].role`                               | `"adult"` or `"child"`                                                                                                                                             | Adult or child                                    | Derived from age and relationship to the main applicant                        |
| `members[].age`                                | whole number                                                                                                                                                       | Age                                               | Age (H-CLIC holds date of birth; send the age only)                            |
| `members[].sex`                                | `"F"`, `"M"` or `"X"`                                                                                                                                              | Sex (bedroom standard)                            | Sex or gender                                                                  |
| `members[].partner_ref`                        | a `ref`                                                                                                                                                            | Partner (bedroom standard)                        | Relationship to the main applicant                                             |
| `members[].pregnant`                           | true or false                                                                                                                                                      | Pregnant (six-week rule, priority)                | Pregnancy (priority need)                                                      |
| `members[].employed`                           | true or false                                                                                                                                                      | In work (raises the work journey)                 | Employment status                                                              |
| `members[].exam_year`, `members[].send`        | true or false                                                                                                                                                      | Exam year; special educational needs              | None                                                                           |
| `members[].wheelchair_user`                    | true or false                                                                                                                                                      | Opens the access questions for this person        | Support need: physical ill health and disability (not the detail)              |
| `members[].access_needs`                       | `{ question: "yes" or "no" }`, questions: `wheelchair_accessible`, `step_free`, `ground_floor_or_lift`, `adapted_bathroom`, `assistance_dog`, `equipment_or_carer` | Access answers, to be checked with the household  | None: H-CLIC does not hold access requirements                                 |
| `members[].access_note`                        | text                                                                                                                                                               | What the equipment or care is                     | None                                                                           |
| `household_access_needs`                       | as `access_needs`                                                                                                                                                  | Answers for the household's disability flag       | None                                                                           |
| `places[]`                                     | list                                                                                                                                                               | Places that matter                                | None                                                                           |
| `places[].person_ref`                          | a `ref`                                                                                                                                                            | Who goes there                                    | None                                                                           |
| `places[].kind`                                | `school`, `work`, `medical`, `care`, `support`                                                                                                                     | What it is                                        | None                                                                           |
| `places[].name`, `places[].reference`          | text                                                                                                                                                               | Name; a school URN or GP practice code            | None (GIAS URN and NHS ODS codes are the natural keys)                         |
| `places[].lat`, `places[].lng`                 | numbers                                                                                                                                                            | Location. Required for the place to import        | None                                                                           |
| `places[].postcode`                            | text                                                                                                                                                               | Kept; named in the report if no coordinates       | None                                                                           |
| `places[].arrive_by`, `places[].days_per_week` | `HH:MM`; whole number 1 to 7                                                                                                                                       | Arrive-by time; days a week                       | None                                                                           |
| `priority_flags`                               | list of `child_protection_plan`, `exam_year`, `ongoing_treatment`, `employment`, `caring_duties`, `domestic_abuse`, `disability`                                   | Priority flags (weights)                          | Support needs (for example domestic abuse, physical ill health and disability) |
| `pets_must_be_accommodated`                    | true or false                                                                                                                                                      | A pet must be accommodated                        | None                                                                           |
| `affordable_contribution_weekly`               | number, pounds a week                                                                                                                                              | What the household can pay                        | None (income is recorded in H-CLIC; affordability is assessed by the council)  |
| `safeguarding_zones[]`                         | `{ "lat", "lng", "radius_km" }`                                                                                                                                    | Exclusion zones (reasons stay in the case system) | None                                                                           |
| `notes`                                        | text                                                                                                                                                               | Notes for the record                              | None                                                                           |

Names never come in: the case system keeps identities, and the engine labels people "Adult 1", "Child 1".

## 2. Exports

**Where:** the audit pack of any decision (PDF, the sealed record as JSON, a case note) and **Audit log → Export for the case system** (every placement as CSV). The hosted app downloads files; the single shared demo file cannot save files, so it copies instead.

**Every export is recorded before it is handed over:** a sealed `records_exported` event with who (the signed-in person), when, the format, whether it was downloaded or copied, and a SHA-256 fingerprint of exactly what was exported (`cmdExport` in `src/store/commands.ts`). The content is built inside that command from sealed records, so nothing can be exported without its record. The PDF is drawn in the browser and its fingerprint is passed in. An export about a decision joins that decision's story in the audit pack. Exporting needs `export_records`, which every role has, the auditor included: the export record is an access log entry, not a change to any case.

| Export          | Format                     | Content                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decision record | JSON                       | `{ seq, prevHash, rowHash, snapshot }` exactly as sealed. Anyone can recompute `rowHash = sha256(seq + "\|" + prevHash + "\|" + canonical(snapshot))` (canonical JSON: sorted keys, no whitespace; `src/audit/canonical.ts`).                                                                                                                                                  |
| Case note       | plain text                 | For pasting into the case system: the outcome, who decided and when, the property, the officer's words, the sealed terms, approval and consent as they stand, the policy version, where journey times and subsidy figures came from, then every later record in order, and the status when exported (labelled as not sealed).                                                  |
| Audit pack      | PDF                        | The audit pack, with the record and policy hashes on every page.                                                                                                                                                                                                                                                                                                               |
| Placements      | CSV, one row per placement | `decision_record, case_reference, outcome, property_id, property, state, decided_at, decided_by, start_date, planned_end, moved_in_on, moved_out_on, approval, six_week_rule, journey_times, subsidy_figures, synthetic`. State is worked out at the time of export. `journey_times` is `measured`, `estimated` or `mixed`; `subsidy_figures` is `illustrative` or `official`. |

The CSV columns that a council would need for its H-CLIC temporary accommodation return (type of accommodation, dates in and out, where) can be derived from these and the sealed records; producing the H-CLIC return itself is not built.

## 3. The subsidy table: CSV for the official January 2011 LHA rates

**Where:** Placement policy → **Housing benefit subsidy table** → Load the official table from a file. Head of service or administrator only.

```csv
brma,1_bed,2_bed,3_bed,4_bed
Example Area A,100.00,120.00,140.00,160.00
"Example Area B, with a comma",110.00,130.00,150.00,170.00
```

(The values above are placeholders showing the format, not rates.) One row per broad rental market area, weekly rates in pounds. `shared`, `shared_room` and `5_bed` columns may be present and are ignored; any other column is refused. The area names must match the `brma` of the properties exactly, or their subsidy is counted as £0 (the check lists any area the inventory uses that the file lacks or spells differently).

Checks (`src/engine/subsidyTable.ts`), run on the screen and again in the store before anything is published: exact columns; one value per column on every row; no area twice (ignoring case); every rate an amount between £40 and £2,500 a week (below looks like a typo or a daily figure, above like a monthly one); at most 400 areas; a citation of at least 10 characters; the source document's date, not in the future; and a tick confirming it is the official table, unchanged. Rates that do not rise with the number of bedrooms are a warning. The screen shows a preview and every change against the table in use. Publishing makes a new signed policy version with the subsidy status `official`, the citation, the source date and the day it was loaded; the previous version is unchanged and old decisions keep the figures they used. Every search, cost line, explanation, audit pack, PDF, case note and CSV says which figures it used.

The weights screen cannot change the table: `cmdPublishRuleset` refuses a draft whose subsidy block differs from the version in use.

## 4. Journey times: this site's functions and TravelTime

The browser never talks to TravelTime and never holds the key. It calls two functions on the same site (Vercel, Node.js runtime, London region `lhr1`, set in `vercel.json`):

**`GET /api/travel-status`** → `{ "configured": true|false, "provider": "traveltime", "region": "lhr1"|null }`. `configured` means both variables are set; it says nothing about whether the key works. `GET /api/travel-status?check=1` also makes one small real request (Stratford station to Liverpool Street station) and adds `"check": { "ok": true, "minutes": 23 }` or `{ "ok": false, "code": "bad_key", "message": "…" }`.

**`POST /api/travel-matrix`** with JSON

```json
{
  "origins": [{ "lat": 51.55, "lng": 0.02 }],
  "destinations": [{ "lat": 51.539, "lng": 0.005, "arriveAt": "2026-11-17T08:45:00.000Z" }]
}
```

Coordinates and arrival times only: no case reference, no names, no property or place ids (the request is refused if it has any other field). At most 60 origins and 12 destinations; every point inside a box around the UK; arrival times from yesterday to 18 months ahead; at most 32 KB; a browser on another site is refused. The answer is `{ "ok": true, "source": "traveltime", "partial": false, "cells": [[{ "minutes": 21, "km": 4.3 }, { "noRoute": true }, null]] }` (`cells[destination][origin]`; `null` means TravelTime gave no answer for that pair), or `{ "ok": false, "code": "…", "message": "…" }` with codes `invalid_request`, `not_configured`, `bad_key`, `rate_limited`, `timeout`, `network`, `rejected`, `vendor_error`, `bad_response`.

The functions log an outcome code and counts only: never a coordinate, a time, a request body, a vendor message or the key.

How TravelTime is called is in one file, `api/_lib/traveltime.ts` (see the note at its top and [ARCHITECTURE.md](ARCHITECTURE.md#journey-times) for what is unverified until a key exists).

## 5. Postcodes: postcodes.io

**Add a place by postcode** on the form sends the postcode, and only the postcode, from the officer's browser to the public postcodes.io service, and gets back a location. The officer names the place and says who goes there. An unknown postcode, a postcode with no location, or the service being unreachable is said plainly, and the example places stay available. The form tells officers not to enter the household's own address. A place found this way is a real location and is labelled "Located from postcode … (postcodes.io)"; the household in the demo is still synthetic.

## 6. The route to live connectors

| System                               | What a connector would do                                                                                                                      | Needs                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Jigsaw (Civica), Locata, NEC Housing | Pull a case's household into `placement-household/1` on the server (no names), and push the case note and the decision record back to the case | The council sponsoring API access with the supplier, a data processing agreement, server-side storage and sign-in |
| Access Adam Housing (booking)        | Import available units and their certificates (today: CSV), confirm a booking (today: typed contact and reference)                             | Council-sponsored access to Adam's interface                                                                      |
| GIAS, NHS ODS                        | Real schools and GP practices as pick lists, with URN and practice codes                                                                       | Open data; loading and refreshing it                                                                              |

Each connector runs on the server, behind real sign-in, maps the supplier's fields to these formats and records what it fetched and sent, as the file route does now. None is built: Spenser's point was that this comes with a council on board.
