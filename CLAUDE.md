# Placement Engine — working rules

Decision support for council temporary accommodation placements. Read `README.md`, then `docs/HOW-IT-DECIDES.md` before changing engine behaviour.

## Before you push

- `npm run check` must pass: typecheck, tests, Prettier. CI runs the same, plus both builds.
- Engine changes need a test. The five scenarios in `tests/scenarios.test.ts` are the regression suite; if a ranking changes, explain why in the commit message.
- UI changes: `npm run build:demo && npm run walkthrough`, then look at the screenshots, including phone width and dark mode. The script reports horizontal overflow; it must be 0.

## Rules of the product

- **The engine is deterministic.** Gates, scores, costs and explanations are plain TypeScript in `src/engine/`. No language model computes, scores or invents anything. A model may later reword an explanation; it may not produce one.
- **The officer decides.** Never auto-book. Overrides need a reason; the review log must keep recording what the officer saw.
- **Cost never makes an unsuitable option suitable.** Cost stays on its own axis and only breaks near-ties (the policy's tie-break band).
- **Every gate and factor cites its legal basis.** Keep `legalBasis` / `legalFactor` text accurate and plain; legal wording is still to be confirmed by a solicitor (`docs/PILOT-READINESS.md`).
- **Synthetic data is labelled as synthetic** everywhere it appears. No real household, address or person goes into this repo.
- **Policy is versioned and hashed.** Decisions reference the rule-set hash; never mutate a published rule-set.
- **The seal is append-only.** Don't change `canonicalize()` or the chain format without a migration plan; old records must still verify.

## Code style

- Prettier settings in `.prettierrc.json` (no semicolons, single quotes, 160 columns).
- Colours come from the tokens in `src/styles.css` (light and dark); never hard-code a colour in a component.
- Write UI copy from the officer's side: plain English, active voice, no jargon the officer wouldn't use.

## Ops

Board, plans and research live in the ops vault `bubblez-jr/bookflo-ops` (`plans/placement-engine/PLAN.md`; board tag `(placement)`).
