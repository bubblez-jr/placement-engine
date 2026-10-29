# Placement Engine

Decision support for council temporary accommodation placements. A housing officer enters a homeless household's needs. The engine checks every available property, ranks the eligible ones by suitability and net public cost, and explains its recommendation in plain English. The officer then accepts it or chooses another option with a reason, and the evidence is sealed into a tamper-evident audit record.

> **Status: MVP on synthetic data.** Every household, property, supplier and place is invented. Journey times are a labelled estimate. Housing benefit subsidy figures are illustrative. Legal references need a solicitor's check before any pilot. See [docs/PILOT-READINESS.md](docs/PILOT-READINESS.md).

## Why it exists

Councils in England spent about £2.9bn on temporary accommodation in 2025-26. Booking platforms (Access Adam Housing in most of London) handle supply, compliance and invoicing. No product ranks the supply for _this_ household, explains the ranking, and keeps the evidence.

The law asks for exactly that evidence. _Nzolameso v Westminster_ [2015] UKSC 22, _Abdikadir v Ealing_ [2022] EWCA Civ 979 and _R (Imam) v Croydon_ [2023] UKSC 45 require councils to show:

- how they weighed location;
- how they weighed the children's needs;
- that they applied their own placement policy;
- what steps they took to find accommodation.

The 2026 rules on automated decisions also require meaningful human review whenever health or disability data is used. This product turns those duties into a by-product of booking a placement.

The research and plan behind it (market sizing, competitors, law, pricing, gated plan) live in the ops vault: `bookflo-ops/plans/placement-engine/`.

## Try it

```bash
npm install
npm run dev          # http://localhost:5173
```

Start from one of the five example households on the home screen:

| Example                                         | What it shows                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent and three children, needed tonight       | The brief's example. The cheaper property 51 minutes from school loses on suitability. Net of subsidy, the gap is smaller than the headline rate. |
| Single adult on dialysis, working               | Priority flags raise the treatment and work weights. The cost tie-break picks between two near-equal options.                                     |
| Wheelchair user and two children, fleeing abuse | Hard access gates, an assistance dog, a safeguarding exclusion zone. Only two properties pass.                                                    |
| Two adults and five children, exam year         | Scarce four-bedroom supply. The cheap Luton unit adds about £33k of special-school taxi to the _education_ budget.                                |
| Pregnant, alone, out of hours                   | Nothing self-contained is free tonight. Shared rooms are offered only as a last resort, with the six-week clock and remedy risk.                  |

Then record a decision, open the audit pack, and use **Audit log → Edit record #1 behind the system's back** to see tamper detection.

## How it decides

```
household + properties + policy (versioned, hashed)
  → hard gates      availability, size, access, certificates, shared facilities for families,
                    safeguarding zones, affordability, approved supplier  (each with a legal basis)
  → journeys        public-transport minutes to every school, workplace, treatment, care and support place
  → suitability     weighted factors, each mapped to a legal factor (2012 Suitability Order art.2–3)
  → net cost        nightly charge − housing benefit subsidy, plus costs to other budgets (education) and the family
  → ranking         by suitability; cost decides only between options within a set band
  → sensitivity     does the recommendation survive any weight moving ±20%?
  → explanation     plain-English template from the numbers (no AI writes or scores anything)
  → officer         accepts or overrides with a reason; what they reviewed is recorded
  → seal            canonical JSON snapshot, SHA-256 hash chain, statutory clocks, PDF
```

Details: [docs/HOW-IT-DECIDES.md](docs/HOW-IT-DECIDES.md). Code layout: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Scripts

| Command               | Does                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`         | Local dev server                                                                                                     |
| `npm test`            | Engine, scenario, audit and CSV tests (Vitest)                                                                       |
| `npm run typecheck`   | TypeScript                                                                                                           |
| `npm run check`       | Typecheck + tests + formatting                                                                                       |
| `npm run build`       | Production build for Vercel (`dist/`)                                                                                |
| `npm run build:demo`  | One self-contained HTML file (`dist-demo/index.html`) for sharing a click-through demo                               |
| `npm run walkthrough` | Clicks through the main flow in headless Chromium and saves screenshots to `screenshots/` (needs `build:demo` first) |

## Deploy

Vercel, framework preset **Vite**, build command `npm run build`, output `dist`. Nothing server-side yet: all data lives in the viewer's browser (localStorage), so each person sees their own demo.

## What the MVP deliberately leaves out

Supplier portal and marketplace, reverse placement requests, cross-council supply, invoicing, case management, and live integrations with Adam, Jigsaw, Locata or NEC. Properties come in by CSV. The plan says why: [bookflo-ops plans/placement-engine/PLAN.md](https://github.com/bubblez-jr/bookflo-ops/blob/main/plans/placement-engine/PLAN.md).
