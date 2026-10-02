# Plan — Backport upstream review fixes into label-editor

Date: 2026-10-02. Owner: Coordinator.

## Context

- `template-webui` is the upstream **template** repo.
- `label-editor` (this repo) was forked off it; a generic improvement run was done here
  (`agent/2026-09-30_template-improvements`, commits `fc59580..6e0e558`) and backported
  upstream as `ab2a0fd` (single-commit tree transplant).
- Upstream then ran a review/fix loop (`agent/2026-10-02_review-backport`) and declared
  "fit"/SHIP. That work is **not** in label-editor yet.

## Verified facts

- `git diff --stat HEAD ab2a0fd` → only the 8 label-editor-only files (planning docs +
  `docs/references`) that upstream intentionally dropped. `src/` is byte-identical
  (git blobs match; `diff -rq` noise is CRLF only).
- Therefore upstream's post-backport commits apply 1:1 to this repo.

## Delta to backport

| Commit | Content |
| --- | --- |
| `4e8cb14` | fix: dialogs, i18n, store/persistence, hotkeys, toasts, a11y (31 src files) |
| `3cbe6a0` | test: Vitest + happy-dom setup and 9 logic/DOM test files |
| `6f9227e` | docs: `agent/memory/testing.md` + `agent/memory.md` update (memory only) |

Explicitly **not** backported: upstream's deletion of this repo's planning docs, and the
template-webui-specific run docs (`agent/2026-10-02_*/plan.md`).

## Method (user-approved)

1. `git cherry-pick -x 4e8cb14 3cbe6a0` (preserve upstream commits + provenance).
2. `git checkout <6f9227e> -- agent/memory.md agent/memory/testing.md` → docs commit.
3. `bun install --frozen-lockfile`.
4. `bun run build` (tsc && vite build) — must exit 0.
5. `bun run test:run` — Vitest must pass.
6. Parity gate: `git diff HEAD <6f9227e> -- src package.json bun.lock vitest.config.ts`
   must be **empty** (proof the backport is faithful).

## Acceptance

- Cherry-picks apply with no conflict and no changes outside the intended paths.
- Build exit 0; all tests pass.
- Parity gate empty.
- Only intended files differ from the pre-backport baseline.
