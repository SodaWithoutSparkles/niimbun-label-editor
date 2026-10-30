# P7 — Verify + docs + memory + handoff

Run: [`plan.md`](plan.md) (P7 row + the owner amendment).
Depends on every phase through P6b (`307d2f3`).

## Gate

- `bun run test:run` (full suite; expected ≥ 188 files / ≈2772 tests)
- `bun run build` (`tsc && vite build`)
- Working tree contains only the intended files before the final commits.
- No hardware print (owner deferred it on 2026-10-31).

## Docs — `docs/user-guide/templates.md` (author-facing)

1. Kind table: three kinds → **four** (add **Field**: a named value the user
   types when using a preset; see the new section). Note that Field also carries
   a fallback.
2. New section **"Presets: fill in the data and print"**:
   - What a preset is (a designed label with data left out) and how to make one
     (File ▸ **Save as preset** copies the current label; the original is not
     converted).
   - **Fields panel** (`MFP → Fields`): one row per declared id with **Default**,
     **Required**, **Hidden**; binding a node to a new id registers it; bindings
     whose id is not declared still appear in the fill form.
   - **Fill dialog**: one input per visible field (defaults pre-filled), required
     fields block printing until filled, **Add field** `[id ▾] [value]` for
     hidden ids, **Open in editor** copies the preset into a normal label.
   - **CSV row lookup**: with a CSV attached, the preset declares the `csv.row`
     placeholder; pick the key column, type the key; exact (trimmed) match. No
     key = the stored sample row; a miss says so and prints the fallback record.
   - **One record per print**: a key-matched print is a single label, not the
     whole table. Templates that read `ctx.index`/`ctx.total` see `0`/`1` for
     such a print — document the caveat.
   - Templates in a preset keep the normal trust prompt on first use.
3. `ctx.fields.<id>` added to the list of things a template can read.
4. Keep the existing voice (plain language, short sections, tables). No absolute
   paths; link the developer guide as the existing page does.

## Memory (`agent/memory/`)

- New **`agent/memory/presets.md`** (one topic), covering:
  - the preset model (`meta.kind`, `data.fields`, reserved ids, bound leftovers);
  - the copy contract (`copyLabelDoc`/`saveCopy`, deep clone, kind explicit,
    thumb cleared, never converts the source);
  - the resolution seam (`prepareResolvedContent.fields`, `TemplateContext.fields`,
    empty-name unbindable, own-property lookup);
  - the fill dialog (declarations + leftovers, defaults/required/hidden, add
    field, `csv.row` lookup, one-row `CsvJobSource` override, the
    `ctx.index`/`ctx.total` 0/1 caveat, the P12 fail-closed read rule);
  - gallery/routing (templates section activation across the 5 vocabularies, the
    partition rule, delete via `deleteLabel`);
  - read-before pointers (render/print/dialog/layout storage).
- `agent/memory.md`: one new index line for `memory/presets.md` (keep it short;
  do not duplicate content).
- `agent/memory/csv-templates.md`: short addendum — `ctx.fields`, the single-row
  print seam, and a pointer to `presets.md`.
- `agent/memory/app-shell.md`: update the section list to include the presets
  pane + the partition rule (one or two sentences, link `presets.md`).

## Handoff — `agent/2026-10-29_label-presets/handoff.md`

Mirror the house style of `agent/2026-10-22_storage-safety/handoff.md`:
date, run dir, baseline + head commits, gate line, "read these first", a
shipped table (area / behaviour now / commit), deviations from the plan (P6
redesign, empty-name relaxation, one-row print seam, no hardware print yet),
known issues/nits, and what a follow-up run should pick up (hardware
verification, dual-color is next per memory).

## Commits (semantic, after the gate)

1. `docs(memory): record the parked dual-color research` — the pre-existing
   untracked `agent/memory/dual-color.md` + its `agent/memory.md` index line
   (finishes the previous handoff; do not lose it).
2. `feat(presets): …` already committed per phase — nothing new.
3. `docs(presets): user guide, memory and run handoff` — guide, `presets.md`,
   index line, addenda, handoff.
