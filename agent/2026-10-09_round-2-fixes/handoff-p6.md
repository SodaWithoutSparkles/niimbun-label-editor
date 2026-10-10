# Handoff — Phase 6 (Templates, globals & trust)

> Coordinator handoff. Read with [`plan.md`](plan.md) §P6, [`state.md`](state.md), and
> [`memory/csv-templates.md`](../memory/csv-templates.md) (the authoritative "how it works" for
> `src/templates/*`, the Data/JS/Global tabs, `useSampleRow`, and the trust gate).
> Status: P5 done (`6ab1525`), P6 not started. Base commit `6dfdf46` + P1–P5 commits.

## Scope (plan.md §P6)

Items: "Globals only allow online"; "Unclear extraction"; "missing API contract";
"template trusting unclear" (C1); "Template does not refresh".

1. **Static globals** — `GlobalSpec` gains `kind: 'remote' | 'static'` + a static value; `validate.ts`
   migration defaults `remote`; prefetch skips static entries (`templates/globals.ts`); `GlobalDataTab`
   form variant (value editor instead of URL/extract/expiry). Round-trip + render test that the value
   reaches `ctx.globals.<name>`.
2. **Extract normalization** — `createExtract` strips a leading `.` (and accepts a leading `$.`) so
   `.rate` works. Pin the grammar in tests (dotted paths, dot-numeric indices `a.b.0.c`, `|fallback`).
3. **Contract surface** — user-facing docs of `TemplateContext` (`index`, `total`/`rowCount`, `row`,
   `now`, `label`, `globals`, `fmt`), the extract grammar, fallback rules, forbidden operations — an
   i18n help panel reachable from the template-related tabs. Plus **`ctx.seeds.docSeed`** (owner-decided):
   a stable per-document seed so the same document + data always generates the same label.
4. **Trust prompt (C1)** — widen to four choices: allow once / always allow / deny once / never allow,
   wiring `gate.always`/`gate.never`. Dismiss = session deny (fail-closed). New `trust.prompt.*` i18n
   keys. Delete the stale `trustPrompt.ts:7-10` comment.
5. **Refresh tick** — 1 s tick enqueued through the single-flight queue (enqueue point
   `useSampleRow.ts:293-298`; superseded passes bail by run id). No pass when the doc has no template
   sources or live globals. Fake-timer tests; StrictMode-idempotent cleanup.

## Verified facts to carry in (from plan.md §ENV BRIEF — do NOT re-explore)

- **C1 trust:** persistent decisions are unreachable **anywhere** — `gate.always`/`gate.never` have no
  production caller; the `trustPrompt.ts:7-10` comment claiming an "editor trust control" is stale/false.
  Widen the prompt AND wire the persistent branches.
- **Extract grammar (owner-answered):** array indexing `a.b[0].c` → **NO**; jq-style `|` → **NO** (`|` is
  the fallback separator). Only **dot-numeric** indices work: `a.b.0.c` (`templates/globals.ts:126-144`).
- Trust gate mechanics: `never` is absolute; `always`/`never` persist only; `allowOnce`/`denyOnce` write
  the session overlay only; `resolve` = persisted ∪ overlay, `never` first. Editor is fail-closed —
  templates execute ONLY on `always`. (`memory/csv-templates.md` §§Trust gate, Globals.)
- The 1 s tick must ride the single-flight queue (`useSampleRow`), stay silent with no live sources, and
  be StrictMode-idempotent (R4).

## Environment / process (carry into the phase)

- Package manager: **bun** at `bun` (never npm). Tests:
  `bun run test:run [files]` (never `bun test`, never `bunx`/`npx`).
  Typecheck: `node node_modules/typescript/bin/tsc --noEmit` (the `.bin/tsc` shim is Windows-only).
- Product strings via `t()` typed keys (`src/i18n/locales/en.json`); dynamic keys via the literal-map
  pattern (`memory/i18n.md`). Global `keydown`/`paste`/`drop` must bail on `<dialog open>`.
  `<React.StrictMode>` is active — effects fire twice; interval/subscription code must be idempotent.
- Depth-1 subagents (no grandchild delegation); no `git stash`; semantic commit **per phase**.
- Reviewer routing: **`review` primary**, `review-alt` fallback, `review-fast` for narrow re-reviews.
- **i18n batching (owner note, plan.md #8, 2026-10-10):** from now on **do NOT edit `en.json` per phase** —
  have agents **report missing keys** and do a single `en.json` pass at the end of the round. (P5's small
  `wrap` keys already landed; P6 onward: batch.)
- Owner performs browser/E2E verification manually (no browser-controlling agents).

## Tests worth mirroring

`globals.test.ts`, `validate.test.ts`, `trust.test.ts`, `trustPrompt.test.ts`, `TrustSection.test.tsx`,
`useSampleRow.test.tsx` (plan §P6). Fake timers for the refresh tick.

## Cross-phase notes from P1–P5 that touch P6

- P2: barcode verdict = drawn pitch `scaleX*drawScale`; quiet-zone defaults (upce 9, ean5/ean2 12;
  pharmacode 10 unverified). `objects-assets.md:38-42` still says "opaque background" — update it.
- P4: brush `gridConstants.ts` is deleted; grid step is the persisted `gridSpacingHm`.
- P5: `TextNode.wrap` + inline editor landed; `restoreDoc(previous)` store action exists (Esc-cancel seam).
  Residual **D-40** (inline overlay shear under a rotated+non-uniform group) is registered, not fixed.

## Action-plan sketch (write `phase6_action-plan.md` before coding)

Likely fan-out (single writer per file per wave):

- **Wave 1** — `general`: globals model + `validate` migration + `globals.ts` static-skip + tests
  (`core/doc/types.ts`, `validate.ts`, `templates/globals.ts`). `general`: extract normalization
  (`templates/globals.ts` `createExtract`) + grammar tests. `general`: trust prompt widen + wire
  `gate.always`/`gate.never` (`trustPrompt.ts`, `TrustSection`, store) + tests.
- **Wave 2** — `general`: `GlobalDataTab` static variant; contract/help panel (i18n) + `ctx.seeds.docSeed`;
  refresh tick through the single-flight queue (`useSampleRow.ts`) with fake-timer tests.
- Review (`review`) → fix (max 2 rounds) → commit `feat(templates): static globals, extract normalization,
  contract help, 4-choice trust prompt, refresh tick (#P6)`.
