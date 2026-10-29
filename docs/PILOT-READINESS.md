# Before a pilot with real household data

The MVP is safe to demo because nothing in it is real. This list is what has to be true before a council puts one real household through it, even in shadow mode.

## Legal review (solicitor, about 2 hours)

- [ ] Wording and paragraph references for every gate and factor (`src/engine/gates.ts`, `src/data/ruleset.ts`): 2012 Suitability Order art.2–3, 2003 B&B Order, 1996 affordability Order, Code of Guidance ch.17, s208, s210, s213AA, s202.
- [ ] Decision support vs automated decision under UK GDPR Art.22A–D (in force 5 Feb 2026): confirm the review log and the override flow count as meaningful human involvement.
- [ ] Whether the cost tie-break and the location tiers fit the council's published placement policy (_Nzolameso_, _Abdikadir_).
- [ ] Procurement route for the pilot (under £30k inc VAT, no notice needed; direct award under £207,720 inc VAT).

## Data protection

- [ ] DPIA support pack. Special category data (health, disability) and safeguarding data are in scope.
- [ ] Article 28 data processing agreement; Book-flo acts as processor.
- [ ] Data minimisation: pseudonymous case references only; names stay in the case system.
- [ ] Retention period for decision snapshots, agreed with the council.
- [ ] Sub-processors listed: hosting, travel-time API (coordinates only).

## Equality

- [ ] Equality impact assessment template for the council's weights.
- [ ] Sign-off log for each rule-set version (built: version history with an equality note).
- [ ] Outcome monitoring by protected characteristic, where lawfully held.
- [ ] Transparency record (ATRS style), pre-filled.

## Security (minimum for real data)

- [ ] Cyber Essentials certificate (Book-flo's is in progress).
- [ ] UK hosting: Supabase London; Vercel functions pinned to London.
- [ ] MFA, role-based access (officer, manager, admin, auditor), tested row-level isolation.
- [ ] Independent web app / API penetration test, with fixes (about £4–10k).
- [ ] Incident response plan; cyber and professional indemnity insurance.

## Product

- [ ] Real travel times with written rights to store results in decision records.
- [ ] Official DWP January 2011 LHA table and current subsidy caps loaded and versioned.
- [ ] Real schools (GIAS) and GPs (ODS) as destination lists; postcode search.
- [ ] Inventory import from the council's booking platform export; "confirmed at" kept honest.
- [ ] Server-side storage and the insert-only snapshot table (see ARCHITECTURE.md).
- [ ] Accessibility statement (WCAG 2.2 AA) and a screen-reader pass.
- [ ] Out-of-hours flow on a phone.
