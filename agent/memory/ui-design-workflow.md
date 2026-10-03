# UI design workflow (owner-driven)

**Owner decision 2026-10-04.** Applies to every phase with a user-facing surface (P3 editor, P4 preview,
P6 trust/template UI, P7 print knobs, P8 import/export).

## The owner designs the UI. We implement it.

- The owner will hand over a **screenshot** or a **crude mspaint drawing** of the intended UI. **Treat it as
  the spec.** Read it, restate the structure back (panels, regions, controls, geometry), ask about
  ambiguities, then build the engine/panels to fit.
- **Never redesign it.** Do not invent layout, panel placement, toolbars, colours, or component structure.
  Do not delegate to `ui-designer` on these phases unless the owner explicitly asks.
- If a decision is visual and the spec is silent, **stop and ask** — do not guess.

## Shell direction for the label editor (not the drawing app)

The template is a freeform drawing app; the label editor is not. Do **not** inherit its proportions:

- **Canvas is bounded and small.** Labels are 25×78 mm; realistically ≤ ~100×150 mm. The backing renders
  **fit-to-viewport**; zoom is a view control, pan is clamped so the label can't be lost. **No infinite
  pannable full-screen canvas**, and the canvas does not get the largest share of the window.
- **Object/layer stack: keep.** The node tree over `parentId` is real and needed (plan line 247).
- **Left tool rail: shrink.** The drawing app's 8-tool toolbar is for a sketchpad. A label editor needs few
  tools (text, shape, image, QR/barcode, group). Freed space goes to config.
- **Reserve right-side space for object-specific config:** mirror/flip, content source (templating),
  quantizer hint, visibility/lock, transform. This is where the editor exceeds the template.
  Likely shell: **narrow left rail + bounded centre canvas + right stack (object list on top, selected-object
  config below)**.
- **Guardrail:** the right panel must not become a dumping ground. Ship fields as the typed model, but wire
  only what the current phase can act on — templating/trust are P6, quantizer policy is P4. Disabled/stub
  states are fine.

## Related

- Regions stay **pure geometry**; per-region features (e.g. mirroring) are **editor configuration addressed by
  region index**, never stored as region fields — see `niimblue-reference.md`.
- Non-printable guides (e.g. the F-tag grey semi-cut score line) are **not** regions and never clip/print;
  they appear via an editor guide overlay seam only — see `phase3_action-plan.md` §5.
