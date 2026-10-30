# Filling labels with data (templates)

This guide is for **label authors**. It explains what a text field (or a
QR/barcode payload) can be filled with, and what happens when the data is
missing. You do not need to be a programmer for most of it. The last section
covers **presets** — designed labels with the data left to fill in.

## What a field can bind to

In the **MFP → JS** tab, every text, QR, and barcode field has a **Content
source** with exactly one of four kinds:

| Kind | What it does | Example |
| ---- | ------------ | ------- |
| **Static** | Fixed text typed once. Never changes. | `Acme Corp` |
| **CSV column** | Reads one named column from the attached CSV, for the row being previewed or printed. | column `serial` for row 1 → `A-1042` |
| **Field** | A named value the user types when using a preset. | field `price` → `9.99` |
| **Template** | Runs a small snippet of JavaScript and prints what it returns. | `return ctx.row.serial.toUpperCase()` |

Every field also has a **Fallback** value (Static has none, because Static *is*
the value). The fallback is printed when the bound value is missing or empty.

**Field** names a value that is filled in later, so it is mainly for presets.
In the editor a Field binding shows its **Fallback**, because no value has been
typed yet. A field can also be used inside a Template as `ctx.fields.<id>`.

> The "template" kind is **not** a `{{ ... }}` text placeholder. It is a tiny
> JavaScript snippet. If you do not need logic, prefer **CSV column** — it is
> simpler and safer.

### Globals

A **global** is a named value you can use in a template that is not part of the
CSV row. Define them in the **MFP → Global data** tab. There are two kinds:

- **Static value** — a literal you type in (for example `Store #14`). It is used
  exactly as written.
- **Remote (URL)** — the app fetches a JSON document from a URL before rendering
  and picks one value out of it with an **extract** path. The fetched value is
  cached for the job and reused while it is still valid (before its expiry);
  once the cache entry is absent or expired, the app fetches again.

Inside a template you read a global as `ctx.globals.<name>`, for example
`return ctx.globals.storeName`.

## The extract path (for remote globals)

When a global is remote, you type an **extract** string that says which value to
pull out of the fetched JSON. The grammar is deliberately tiny:

```
path
path | fallback
```

- **Dotted path.** `store.name` finds `{ "store": { "name": ... } }`.
- **Numeric dot segments index arrays.** `items.0.name` finds the first item's
  name. You may also write `a.b.0.c`.
- **Leading sugar is optional.** `.rate`, `$.rate`, `$rate`, and `rate` all mean
  the same key. Feel free to paste a path beginning with `.` or `$`.
- **`|` is the fallback separator, not chaining.** Write `path |fallback`:
  text after the first `|` is used when the path is absent, for example
  `data.rate | 0`. The fallback is treated as JSON when it is valid JSON (`7`,
  `"n/a"`, `true`, `null`, `{"x":1}`), otherwise it is plain text (`hello`). An
  empty fallback means "no value".
- **No brackets, no jq.** `a.b[0].c` is **not** supported — use `a.b.0.c`. There
  is no jq-style `|` chaining; `|` only separates the fallback.

If the path is absent and you gave no fallback, the global is simply missing (a
warning appears in the preview / warnings area) and the template that uses it
falls back.

## What templates may and may not do

A template is run in a separate background worker, away from the editor. In
practice this means:

- **No page or user-interface access.** A template cannot touch the document,
  the screen, or any editor object. It only sees the data described below.
- **No network.** The usual ways to reach the internet from a snippet are
  removed. If you need remote data, define a **remote global** — the app fetches
  it for you, then hands the value to the template.
- **250 ms limit.** A template must finish within 250 milliseconds. If it does
  not, it is stopped and the field shows its fallback.
- **Read-only data.** The `ctx` object is read-only. Trying to assign to
  `ctx.row` or `ctx.globals` throws; you cannot edit the data, only read it.
- **It must `return`.** The snippet is the body of a function. Whatever it
  `return`s is printed. A snippet with no `return` prints nothing, so the
  fallback is used.

A template can read:

- `ctx.row.<column>` — the current CSV row (see the developer guide for the
  exact row rules).
- `ctx.fields.<id>` — a field value typed into a preset's fill dialog. In the
  editor it is empty.
- `ctx.globals.<name>` — a global you defined.
- `ctx.label` — the label's own settings (name, width, height, dpi, direction).
- `ctx.index` / `ctx.total` / `ctx.rowCount` — where this row is in the job.
- `ctx.now` — the current time in milliseconds.
- `ctx.seeds.docSeed` — a stable id for this document (see below).
- `ctx.fmt` — formatting settings, when provided.

## When something is missing or fails

Content resolution never breaks the label. For each field, if anything goes
wrong the label still renders:

- **CSV column** — a missing CSV, a missing column, an out-of-range row, or an
  empty cell uses the **Fallback**.
- **Field** — an empty value or no value typed uses the **Fallback**.
- **Template** — an error, a timeout, a non-primitive result (an object or
  array), an empty string, or "templates are not trusted yet" uses the
  **Fallback**.
- If the fallback itself is empty, the field shows the placeholder `{empty}` so
  you can see the field is present but blank.

### Trust: templates need permission

Because a template is code, the app asks before running any document that
contains one. On open you get **four choices**:

- **Allow once** — run now, for this session only.
- **Always allow** — remember this document and run it from now on.
- **Deny once** — do not run it, this session only.
- **Never** — remember this document as blocked.

Until you choose, template fields render their **Fallback**. If you pick
**Never**, templates stay blocked (even if you later allow once) until you
change it in Settings. Documents with no templates are never gated at all.

A preset with templates keeps the same prompt. It appears the first time you
fill or print that preset. **Always allow** is remembered for that preset
document; a new copy (and an imported label) is a new document, so it asks
again.

### The stable document seed

`ctx.seeds.docSeed` is the same for a given document every time it renders, and
different between documents. That makes it safe to derive repeatable values —
for example, a pseudo-random **asset-tag UUID** that must stay the same each
time you print the same document with the same data. It carries no stored state
of its own.

## Presets: fill in the data and print

A **preset** is a designed label with some data left out. You design it once,
then fill in the missing values and print a copy each time.

### Make a preset

1. Design the label normally in the editor.
2. Leave the changing parts as **Field** or **CSV column** bindings.
3. Choose **File ▸ Save as preset**.

The app saves a **copy** with a fresh id. Your open label stays a normal label
and is not changed. The copy appears under **Label presets** in the sidebar.
Presets are hidden from **Recent**, and normal labels never appear in the
preset list.

### Declare the fields (MFP → Fields)

The **Fields** tab lists the field names the fill form will show.

- Each declared field has a fixed **name**, a **Default** value, and the
  **Required** and **Hidden** rules.
- **Required** means the form will not print while the value is empty.
- **Hidden** keeps the field out of the normal form. You can still fill it
  through **Add field** in the fill dialog.
- To add a declaration, type a name and choose **Add field**.
- Binding an object to a **new** field name in the **JS** tab also registers
  that name. A binding whose name is not declared still appears in the fill
  form, so no data hides silently.
- Attaching a CSV declares the reserved `csv.row` field automatically. It is
  filled by the app (the CSV row selector), so it has no Default input.

To revise a preset, use **Open in editor** to make an editable normal copy,
change it, then save the result as a preset again.

### Fill and print

Click a preset card to open the fill dialog.

- There is one input per visible field. **Defaults are already filled in**, and
  the binding's fallback is the placeholder.
- The preview updates as you type, and it uses the same values as the print.
- **Required** fields block **Print** and **Open in editor** until they are
  filled. The dialog names the missing fields.
- Fields marked **Hidden** do not appear. Use **Add field**: pick the field,
  type the value, then choose **Add field**.
- **Print** opens the normal print dialog, with the preset's label settings.
- **Open in editor** saves a copy as a normal label and opens it. The bindings
  stay in place and are still unfilled; the preset itself is not changed.

The values you type are used for that preview and print only. They are not saved
back into the preset.

### Find one CSV row by key

If the preset has a CSV attached, a **CSV row** section appears in the fill
dialog (it needs the declared `csv.row` field, which attaching a CSV adds). If
the file cannot be read, the dialog says so and hides the row controls.

1. Pick the **Key column**.
2. Type the key. The preview updates as you type; there is no separate search
   button.

The match must be exact, ignoring spaces at the start and end of both the key
and the cell. If several rows share the key, the first one is used.

- **No key typed** — the dialog shows the preset's stored **sample row**.
- **A match** — the status says which row is shown, and that row fills the
  label.
- **No match** — the status says so and the dialog uses one empty record, so
  row-based bindings show their fallback or the `{empty}` placeholder. What you
  see is what prints; the app never prints a different row silently.

### One record per print

When the preset has a CSV that reads successfully, the dialog prints **one
label**, not the whole table: the matched row, or the sample row when no key is
typed.

Because the job contains one record, a template that reads `ctx.index` and
`ctx.total` sees **`0`** and **`1`** for such a print, even when the row came
from the middle of the table. Use `ctx.row.<column>` for the row's data; do not
use `ctx.index` to look up a table position.

---

For the precise rules — exact types, the `row` object shape, and the trust
state machine — see the developer guide:
[`docs/developer-guide/template-context.md`](../developer-guide/template-context.md).
