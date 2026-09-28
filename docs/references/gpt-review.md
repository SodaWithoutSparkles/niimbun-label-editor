
GPT
------
I think the plan is **technically strong and worth building**, but I would change several parts before writing code. The core architecture is much better than a typical “just make a canvas editor” approach; the main danger is that the current plan is trying to solve *too many hard problems simultaneously*.

The plan itself has already converged on a sensible architecture: React/TypeScript UI, a document model stored as compressed JSON, a separate rendering engine, layers/groups, fixed 0.01-mm geometry, per-object color processing, a template/data system, and a print job pipeline. 

## My overall assessment

I'd characterize it roughly as:

**Product concept: very good**
**Core architecture: good to very good**
**Rendering architecture: needs refinement**
**Template security: currently the weakest part**
**v1 scope: too ambitious**
**Data model: good foundation, but a few redundancies**

The most important thing is that this isn't merely a prettier NiimBlue. The interesting part is the combination of:

> arbitrary physical label geometry + a real vector-ish editor + variable-data printing + programmable templates + direct printer output.

That is a considerably more useful system than simply reproducing NiimBlue's editor.

---

# 1. The biggest thing you got right: separate the document from rendering

This is probably the most important architectural decision.

The label should be something like:

```text
Label document
    ↓
resolve data/template
    ↓
render scene
    ↓
convert to printer representation
    ↓
NiimBlueLib
    ↓
printer
```

rather than:

```text
canvas
   ↓
save canvas somehow
   ↓
print canvas
```

Your current plan explicitly makes the JSON document the source of truth, while templates remain unresolved until rendering. That's exactly the right direction for this application. 

It gives you several things almost for free later:

* editing a 1000-label job without storing 1000 labels
* changing the CSV and regenerating
* previewing row 37
* exporting the design independently from the dataset
* changing printer/rendering backend without changing the document
* eventually adding PDF/SVG/export backends
* eventually supporting mobile with the same underlying document engine

That separation is worth preserving very strongly.

---

# 2. The fixed 0.01-mm unit is a very good choice

I agree with the change to integer hundredths of a millimeter.

For example:

```ts
x: 1234
```

means:

```text
12.34 mm
```

rather than having:

```ts
x: 12.339999999997
```

floating around the document.

It also means transformations can have deterministic serialization:

```text
save → load → save
```

doesn't gradually alter coordinates.

One correction, though: I would **not overuse `Int32Array` inside the JSON representation**.

If the actual persistent format is JSON, just store integers:

```json
{
  "x": 1234,
  "y": 567
}
```

Gzip will compress repeated numeric structure extremely well anyway.

If you eventually discover that JSON itself is the storage bottleneck, move to something like CBOR/MessagePack/binary later. Don't complicate the canonical document format prematurely.

---

# 3. The region model is exactly the right abstraction

The move from:

```ts
label.shape
```

to:

```ts
label.regions[]
```

is excellent.

This is much more powerful than special-casing:

```text
rectangle
circle
F-label
...
```

You instead have:

```text
transport rectangle
       │
       ├── printable region
       ├── printable region
       └── printable region
```

That's a very general concept.

It handles:

* normal rectangles
* rounded rectangles
* circles
* multiple labels on one backing sheet
* F-shaped tags
* weird die-cut geometry
* multiple disconnected printable areas
* future label formats you haven't thought of yet

And it cleanly matches your important distinction between **physical label geometry** and **what the printer receives**.

I would make one thing explicit in the specification:

> Is the region geometry a clipping mask, or are objects assigned to individual regions?

I strongly favor **clipping masks**.

For example, an object could technically extend across the entire backing rectangle:

```text
 ┌─────────────────┐
 │ ███████████████ │
 │     ███████     │
 │     ███████     │
 │                 │
 └─────────────────┘
```

but the renderer clips it against:

```text
union(label.regions)
```

That makes editing considerably simpler.

---

# 4. I would change the rendering architecture somewhat

This is the biggest technical issue in the current plan.

You currently have approximately:

```text
object
  ↓
rasterize object
  ↓
dither object
  ↓
composite into output
```

That sounds attractive because it gives you per-object dithering.

But there is a nasty problem with overlapping objects, transparency and antialiased edges.

Imagine:

```text
background
   ↓
semi-transparent image
   ↓
black text
```

If you independently threshold/dither the image before compositing the text, you're no longer dithering the actual final pixels.

The same problem becomes considerably more complicated for:

* transparency
* SVGs
* antialiased shapes
* overlapping photographs
* rotated objects
* red/black output
* grayscale output

### I'd instead use three distinct concepts

```text
Scene object
    ↓
RGBA / high-quality intermediate rendering
    ↓
Color conversion / quantization
    ↓
Printer planes
```

But allow the object to specify its **preferred quantization strategy**.

Something like:

```ts
colorPolicy: {
    mode: "threshold"
}
```

or:

```ts
colorPolicy: {
    mode: "floyd-steinberg"
}
```

Then your renderer can decide *where* that conversion actually happens.

For example:

```text
Object rendering
        ↓
object intermediate
        ↓
object color policy
        ↓
compositor
        ↓
printer image
```

may be appropriate for some objects.

But for others:

```text
objects
   ↓
RGBA compositor
   ↓
final color policy
   ↓
printer planes
```

will be more correct.

The key idea is:

> **Per-object dithering should be a rendering policy, not necessarily a mandatory physical pipeline boundary.**

That leaves you the flexibility you need.

---

# 5. Red/black support should not be modeled as "future 1-bit with another option"

Your `ColorModeRegistry` idea is good, but I would take it one step further.

Don't think of the renderer's destination as:

```ts
Bitmap1
```

Think in terms of **output color planes**.

For example:

```text
Mono printer:

K

Red/black:

K
R

Grayscale:

Y
```

Potentially later:

```text
CMY
CMYK
...
```

Then your color pipeline becomes:

```text
scene
 ↓
color representation
 ↓
printer-specific conversion
 ↓
planes
```

This is a better abstraction because red/black isn't really "a different dithering algorithm."

It's a different **output color space**.

For example, the same object might eventually support:

```text
threshold K
dither K
threshold R
dither R
```

So I would separate:

```text
Color model
```

from:

```text
Quantization/dithering algorithm
```

Rather than combining both into:

```ts
"red-black"
"floyd-steinberg"
"threshold"
```

---

# 6. The template system needs the most serious rethink

The basic idea is excellent:

```text
CSV
globals
label metadata
current time
        ↓
read-only template context
        ↓
generated content
```

And I particularly like your decision to resolve remote globals **once per job** instead of having every row execute:

```js
fetch(...)
```

That makes the job much more deterministic.

For example:

```text
job starts
   ↓
GET exchange rates
GET inventory data
GET company information
   ↓
freeze globals
   ↓
row 0
row 1
row 2
...
```

That's much better than 1000 network requests.

### But the JavaScript sandbox isn't actually secure yet.

This part of the plan is too optimistic:

> worker + frozen context + Proxy + disabling importScripts/eval/Function + CSP

A Worker is excellent for **isolation and termination**, but arbitrary JavaScript is still arbitrary JavaScript.

You need to decide what security model you actually want.

There are two very different possibilities.

### Model A — templates are trusted user code

Then:

```js
(ctx) => {
    return `${ctx.row.name} ${ctx.now}`;
}
```

is perfectly reasonable.

You mainly care about:

* infinite loops
* runaway CPU
* accidental mutation
* crashing the UI

The Worker handles much of that.

### Model B — `.lbl` files are untrusted documents

Then this becomes a genuine sandboxing problem.

Someone could hand you:

```text
malicious-label.lbl
```

and expect opening it to be safe.

In that case I'd strongly prefer:

```text
untrusted template
      ↓
isolated execution environment
      ↓
strict message interface
      ↓
result
```

rather than assuming `Object.freeze()` makes arbitrary JS safe.

This distinction should be explicitly documented in the project.

---

# 7. I would seriously reconsider arbitrary JS as the long-term template language

For your own application, JavaScript is extremely convenient.

For example:

```js
`${row.price.toFixed(2)} USD`
```

is fantastic.

But once you make labels shareable/exportable, a small expression language becomes attractive:

```text
{{ row.price | number(2) }}
{{ now | date("YYYY-MM-DD") }}
{{ globals.exchange.usd }}
```

You don't necessarily need to do that now.

I would define the abstraction as:

```ts
TemplateEngine
```

and make the first implementation:

```text
JavaScriptTemplateEngine
```

Then you haven't committed the entire document format to arbitrary JavaScript forever.

---

# 8. The layer/group model has some unnecessary duplication

The current model has roughly:

```ts
layerId
groupId
parentId
childrenIds
group object
```

This is too many ways of expressing hierarchy.

It's very easy to eventually get inconsistent state like:

```text
object.parentId = A

but

A.childrenIds doesn't contain object
```

or:

```text
object.layerId = 1
group.layerId = 2
```

I'd make the hierarchy canonical.

For example:

```ts
interface Node {
    id: string
    parentId?: string
    ...
}
```

and derive children dynamically.

Then:

```text
root
 ├── layer 1
 │    ├── object A
 │    └── group B
 │          ├── object C
 │          └── object D
 └── layer 2
      └── object E
```

The UI can still expose Photoshop-like layers and groups.

The important thing is to have **one authoritative hierarchy** rather than several partially overlapping representations.

---

# 9. Visibility and locking also need one source of truth

You currently have both layer-level and object-level:

```text
layer.visible
object.visible
```

That's not inherently wrong, but make the semantics explicit:

```text
effectiveVisible =
    layer.visible &&
    everyAncestor.visible &&
    object.visible
```

Likewise for locking.

Otherwise rendering, hit testing and UI can gradually disagree.

This is a small thing now that saves annoying bugs later.

---

# 10. Font handling is sensible, but I would add fingerprints

I agree with your decision not to blindly embed every font.

A label document shouldn't become:

```text
5 MB label file
```

because somebody used a 4 MB font.

But I would store something more like:

```ts
interface FontRef {
    fontId: string
    familyName: string
    source: ...
    fingerprint?: string
}
```

The fingerprint could identify the exact font resource expected.

Otherwise:

```text
Arial
```

doesn't actually mean the same thing across systems.

The eventual UI could say:

```text
✓ Roboto 2.0.1
⚠ Helvetica — fallback
```

rather than merely:

```text
font exists / doesn't exist
```

Also, "system font" should be treated as inherently non-portable. Your plan already recognizes this, which is good.

---

# 11. The printing architecture is good, and the early spike is essential

The plan correctly identifies the uncertain piece:

```text
Can one PrintTask contain multiple different pages?
```

This is something that should be established *before* building the batch-print architecture.

The fact that the communication library already gives you a rendering/encoding boundary is hugely beneficial here. Your plan doesn't need to reinvent the NIIMBOT protocol; the library can remain beneath a thin adapter. 

I'd make the abstraction explicitly:

```ts
interface Printer {
    connect()
    disconnect()
    print(job)
}
```

where the rest of the application knows nothing about:

```text
BLE
USB
NiimBlueLib
packet sequences
```

That will make testing dramatically easier.

---

# 12. The virtualized print preview is absolutely the right idea

The requirement:

> don't raster all 1000 labels at once

is very important.

The correct mental model is:

```text
Data source
   ↓
lazy sequence
   ↓
virtualized UI
   ↓
render only visible previews
```

rather than:

```text
CSV
 ↓
1000 canvas objects
 ↓
render 1000 images
 ↓
OOM
```

For the actual printer, however, you can process:

```text
row 0 → render → encode → print
row 1 → render → encode → print
...
```

with bounded memory.

This also naturally leads into backpressure:

```text
render
  ↓
encode
  ↓
send
  ↓
wait
  ↓
next
```

which is what you want.

---

# 13. The current 11–14 week v1 estimate is the least convincing part

This is where I think the plan is underestimating the project.

The scope includes:

* document storage
* compressed serialization
* arbitrary geometry
* F-tag geometry
* layers
* groups
* transforms
* undo/redo
* typography
* font loading
* SVG
* raster images
* MDI
* QR
* barcode
* dithering
* multiple dithering algorithms
* CSV
* dynamic templates
* sandboxing
* remote data
* print sequencing
* print progress
* BLE
* USB
* virtualized preview
* export/import
* font packaging
* accessibility
* performance optimization

That's a substantial editor.

And the particularly dangerous features aren't necessarily the visually impressive ones. Things like:

```text
text measurement
undo/redo
group transforms
font metrics
template evaluation
print job cancellation
render caching
```

will generate disproportionately large numbers of edge cases.

So I'd interpret the 11–14 weeks as:

> an optimistic implementation target assuming very few surprises

rather than a reliable project estimate.

---

# 14. I would make a smaller "actually useful" v1

The current M0→M8 progression is logically ordered, but I'd change the definition of the first usable release.

I'd aim for:

```text
M0
communication spike

M1
document + storage

M2
geometry + F-label

M3
basic editor

M4
basic rendering + dithering

M5
actual printing

M6
CSV + variable content

M7
preview + batch printing

M8
polish
```

And initially restrict objects to:

```text
text
image
line
rectangle
ellipse
QR
barcode
```

I'd postpone:

```text
MDI
advanced SVG
remote font bundling
red/black
grayscale
complex group operations
fancy typography
```

Not because they're bad ideas, but because they don't prove the fundamental product.

The killer workflow is:

> **Create strange-shaped label → design it → attach CSV → preview row 37 → print 100 different labels directly.**

Once that works reliably, the rest is incremental.

---

# 15. One thing I'd add: explicit rendering invariants

Before implementation, I would write down a small set of rules that every renderer must obey.

For example:

### Coordinate invariant

```text
Document coordinates are always hm.
```

### Rendering invariant

```text
Renderer never modifies the document.
```

### Template invariant

```text
Template evaluation never mutates document/data.
```

### Preview invariant

```text
Preview and printer rendering use the same scene-resolution pipeline.
```

### Region invariant

```text
Pixels outside union(regions) are always blank.
```

### Batch invariant

```text
Rendering row N never modifies row N+1's state.
```

### Printer invariant

```text
Printer adapter accepts only fully resolved raster pages.
```

Those rules will prevent architectural drift as the project grows.

---

# 16. One concern with the current editor coordinate model

The plan says:

> `1:1 px = 1:1 mm × zoom`

I would change this.

Use a **world coordinate system**:

```text
hm
```

and let the UI transform it into screen coordinates:

```text
hm → mm → CSS px → zoom
```

The printer renderer separately does:

```text
hm → physical mm → printer pixels
```

So:

```text
Document
   │
   ├── Editor transform → screen pixels
   │
   └── Print transform → printer pixels
```

This is much cleaner than allowing the editor's pixel coordinate system to become coupled to the physical dimensions.

It also makes zoom mathematically straightforward.

---

# 17. I really like the project's underlying product direction

The strongest part isn't actually the editor.

It's the fact that you're turning a label into something closer to a **small layout/programming document**.

For example:

```text
Label
├── geometry
├── objects
├── fonts/assets
├── CSV
├── globals
└── templates
```

and then:

```text
row #173
    ↓
context
    ↓
resolve
    ↓
render
    ↓
dither
    ↓
print
```

That makes it possible to do things that ordinary label editors are terrible at:

```text
Asset: 3817
Location: Rack B-17
Price: ¥1,280
Generated: 2026-09-29 01:23
QR: https://...
```

across hundreds or thousands of labels.

That is a genuinely useful differentiator.

---

## What I would change before coding

I'd keep roughly **80–85% of the current plan**.

The changes I'd make are:

| Area                       | Current plan                           | I'd change it to                              |
| -------------------------- | -------------------------------------- | --------------------------------------------- |
| Geometry                   | hm                                     | **Keep**                                      |
| Regions                    | multiple regions                       | **Keep**                                      |
| Document/render separation | separate                               | **Keep strongly**                             |
| React                      | React + TS                             | **Keep**                                      |
| Konva                      | editor renderer                        | **Probably keep**                             |
| Per-object dithering       | mandatory per-object raster conversion | **Make it a rendering policy**                |
| Color modes                | mixed color/dither enum                | **Separate color space from quantizer**       |
| Groups                     | object + parent/children mechanisms    | **One canonical hierarchy**                   |
| Templates                  | arbitrary JS + worker                  | **Worker initially, but define threat model** |
| Remote globals             | prefetch once/job                      | **Keep**                                      |
| Fonts                      | references                             | **Keep, add fingerprint**                     |
| IDB + gzip JSON            | current plan                           | **Keep, don't over-optimize typed arrays**    |
| Printer adapter            | NiimBlueLib wrapper                    | **Keep**                                      |
| Virtual preview            | lazy/virtualized                       | **Keep strongly**                             |
| v1 scope                   | everything                             | **Trim aggressively**                         |

### Bottom line

**The plan is fundamentally sound.** It has the right decomposition and, importantly, it is designed around the actual problem rather than around whatever canvas library happens to be convenient.

The two things I would *not* start implementation with unchanged are the **render/color pipeline** and the **template sandbox**. Those need their invariants nailed down first. After that, the main risk is simply scope: the project is closer to a small desktop publishing application than a conventional web form editor.

And I would keep the first milestone very deliberately vertical: **create one weird-shaped label, put text/image/QR on it, render it correctly, and successfully print it through NiimBlueLib.** Once that vertical slice works, the rest of the architecture has something concrete to grow around.



Human
------
3. yep, `union(label.regions)`
4. make sense and good idea. In reality the images doesnt even need to be that high resolution. Printed on a 300dpi printer + poor resolution heat-sensitive paper + at most just like 8cm or so big. And yes, in my mind I also want to to color conversion. That way we can do mixed red-black floyd-steinberg or red-grayscale. This would make images of people appear much warmer.
5. yep, red/black is a colorspace thing more than bitmap thing.
6. We can do templates as user-trusted code. Thats what excel macros and word have been doing, and I believe those are good enough of a threat boundary. Disable code until user trusted are more than enough. Also, the browser sandbox helps in our favour. This website would not have any inherent secrets/passwords, at most they are just accessing the indexed DB which stores previous labels. An isolated environment should be enough to block this
7. TemplateEngine is a good abstraction. technically jinja would be more approiate here, but having a python-like runtime on js is not what this proj is trying to achieve.
8. thanks for correcting. hierarchy should be single-source-of-truth only.
9. Maybe it would be better to think of groups as also an object? maybe this could simplify the visibility/locking. single source of truth needed
10. fingerprinting is cool, dunno how to do it tho. hashing works but is slow and stupid.

The killer workflow is actually strange shape label, csv, templatable text and QR codes and row preview.
invarants are cool. 
world coord system should be used, or otherwise the whole UI would freeze trying to handle that many pixels. Maybe on the extreme end we need to LOD optimizations, but I doubt that would be really needed, as the largest common size is just 50x80mm


GPT
------
Yeah, with those clarifications I think the architecture is becoming much cleaner. In particular, your intended workflow is now very focused:

> **strange physical geometry → CSV → templatable text → QR → preview arbitrary row → print**

That is a much better definition of the product than “general-purpose label editor.”

### 4/5. The renderer should really be a color-conversion engine

I agree with your interpretation. At 300 DPI, an 8 cm-wide label is only about **945 printer pixels across**. Even an 80 × 50 mm label is roughly **945 × 591 px**. That's tiny by modern browser-rendering standards.

So I wouldn't try to preserve photographic detail much beyond the printer's actual resolution.

The important abstraction becomes:

```text
scene
  ↓
high-quality intermediate color image
  ↓
color conversion / palette mapping
  ↓
printer color planes
```

rather than "turn each object into a 1-bit bitmap."

That gives you some really nice possibilities.

For a red/black printer, the conversion isn't merely:

```text
RGB → black
```

but something more like:

```text
RGB
 ↓
desired physical colors
 ↓
{ black, red, white }
 ↓
error diffusion
```

You can then intentionally tune the mapping.

For example, a photograph could map:

```text
dark neutral → black
light neutral → white
skin tones → red + white
dark warm tones → red + black
```

instead of naïvely reducing it to grayscale. Your "people look warmer" observation is exactly the sort of thing this architecture enables.

I'd actually make this a first-class abstraction:

```ts
interface ColorConverter {
    convert(source: Raster): PrinterColorImage;
}
```

with separate concepts for:

```ts
PrinterColorSpace
Quantizer / Ditherer
```

For example:

```text
RGB
 ↓
RedBlackColorSpace
 ↓
FloydSteinberg
 ↓
K + R planes
```

or:

```text
RGB
 ↓
RedGrayscaleColorSpace
 ↓
FloydSteinberg
 ↓
R + Gray
```

That is considerably more extensible than a pile of bitmap-specific modes.

---

## 6. I agree with your trust model

Given the application you're describing, I would **not design this like a hostile web application**.

Your analogy to Office macros is appropriate.

The important boundary becomes:

```text
Untrusted document
    ↓
templates disabled
    ↓
user explicitly trusts document
    ↓
templates execute
```

Then the browser itself gives you a substantial additional boundary:

```text
template code
   ↓
Worker
   ↓
same-origin browser sandbox
   ↓
no server credentials / cookies of interest
   ↓
no native filesystem
```

And as you noted, even if template code can somehow inspect the application's IndexedDB, that database contains the user's label documents rather than some backend secret.

I'd still enforce practical limitations:

```text
timeout
memory-conscious execution
no network by default
no dynamic module loading
read-only context
```

but I agree that trying to construct a perfect JavaScript security sandbox would be solving a different problem.

One thing I'd explicitly expose in the UI is:

> **This label contains executable templates. Trust this label to enable them.**

That makes the security model understandable to users.

---

# 7. Template engine: I agree with the abstraction

I'd define:

```ts
interface TemplateEngine {
    evaluate(source, context): Promise<Value>;
}
```

Then the first implementation can simply be:

```text
JavaScriptTemplateEngine
```

without making the entire application fundamentally "a JavaScript application."

And you're right about Jinja: conceptually it fits templating extremely well, but introducing an actual Python-like language runtime into a browser just to get:

```text
{{ row.name }}
```

would be disproportionate.

There's also a pleasant middle ground where the *presentation syntax* looks template-like while the execution engine is still JS.

For example:

```text
Hello {{ row.name }}
```

could internally become something equivalent to:

```js
return `Hello ${row.name}`;
```

You get the ergonomic benefit without building a language runtime.

That's something I'd leave open until the UI is clearer.

---

# 9/10. Yes: make groups nodes

I think this is the cleanest solution.

Instead of:

```text
objects
groups
layers
```

being separate concepts, make **everything a node**.

For example:

```ts
interface BaseNode {
    id: string
    parentId: string | null

    visible: boolean
    locked: boolean

    transform: Transform
}

interface GroupNode extends BaseNode {
    type: "group"
}

interface TextNode extends BaseNode {
    type: "text"
    ...
}

interface ImageNode extends BaseNode {
    type: "image"
    ...
}
```

Then the tree is simply:

```text
Document
└── root
    ├── Group
    │   ├── Text
    │   ├── QR
    │   └── Image
    │
    ├── Text
    └── Group
        ├── Barcode
        └── Rectangle
```

A group doesn't even have to render anything. It is just a **transformable/container node**.

That gives you a very elegant inheritance model:

```text
effectiveVisible(node)
    = node.visible
      && effectiveVisible(parent)
```

and similarly:

```text
effectiveLocked(node)
    = node.locked
      || effectiveLocked(parent)
```

You can also naturally define:

```text
effectiveTransform =
    parentTransform × localTransform
```

This makes the editor's selection/grouping machinery much simpler.

### I'd go one step further

Treat a layer as **UI terminology**, not a different data-model entity.

Your layer panel could show:

```text
▼ Components
   Text
   QR

▼ Background
   Rectangle
```

but internally those are simply nodes with parents.

That gets rid of the layer/group/object conceptual duplication almost entirely.

---

# Font fingerprints

Your instinct is right: **don't hash fonts every time you render**.

But hashing the actual font file once during import is cheap enough, especially using the browser's native Web Crypto API.

For an uploaded font:

```text
user selects font
      ↓
read ArrayBuffer
      ↓
SHA-256 once
      ↓
store font resource + hash
```

Then:

```json
{
  "fontId": "font_abc",
  "fingerprint": "sha256:..."
}
```

You never hash it again unless the resource changes.

And I would **not try to hash system fonts**. Browsers don't generally give you direct access to the font file behind a system-installed font.

Instead:

```text
uploaded font:
    sha256(file)

system font:
    system:"Arial"/weight:400/style:normal/stretch:normal
```

The distinction matters.

A system font reference basically means:

> "Use whatever font satisfying this description exists on this machine."

An embedded font means:

> "Use this exact binary resource."

That's much more honest than pretending a system font has a portable cryptographic identity.

You can then show:

```text
✓ Roboto — embedded
⚠ Arial — system font
```

and possibly offer:

```text
Embed font
```

later.

---

# World coordinates are definitely the right choice

And I think your instinct about performance is correct.

You absolutely do **not** want the editor to think:

```text
1 document pixel = 1 physical printer pixel
```

A 50 × 80 mm label at 300 DPI is already roughly:

```text
591 × 945 px
```

and that gets larger if you preview at 2×, 4×, 8×, etc.

Instead:

```text
document
    ↓
physical coordinates
    ↓
editor viewport transform
    ↓
CSS pixels
```

and independently:

```text
document
    ↓
physical coordinates
    ↓
printer resolution
    ↓
raster
```

So zooming from 25% to 800% doesn't change the document at all.

---

## I also agree that LOD probably isn't an early concern

For your expected physical sizes, I wouldn't build a sophisticated LOD system initially.

You can probably get very far with:

```text
vector object
    ↓
draw at viewport resolution
```

and images being capped to something sensible.

For example, there's little reason to display a 6000×4000 photograph at 16× zoom when the eventual output is only ~945 pixels wide.

A very simple rule can handle most of this:

```text
effective bitmap resolution =
min(source resolution,
    required resolution for current viewport)
```

Then later, if profiling actually shows a problem, introduce:

```text
thumbnail
preview
full resolution
```

caching.

I wouldn't architect the entire editor around hypothetical LOD needs.

---

# Your invariants are becoming the really important part

I would put these directly into the project's design document.

Something approximately like:

```text
1. The document is the source of truth.
2. Rendering never mutates the document.
3. Template execution never mutates the context.
4. Node hierarchy has exactly one source of truth.
5. Physical geometry uses integer hundredths of a millimeter.
6. Label printable area is union(regions).
7. Preview and printing share the same resolution pipeline.
8. Printer adapters receive resolved raster data, never editor objects.
9. Batch rendering is lazy and bounded in memory.
10. A template executes once per label instance/context.
```

Those rules will probably be more valuable during implementation than another 20 pages of class diagrams.

---

# One architectural shape I'd now strongly recommend

With all the changes you've made, I think the cleanest overall model is:

```text
                         ┌───────────────┐
                         │ Label Document │
                         └───────┬───────┘
                                 │
             ┌───────────────────┼──────────────────┐
             │                   │                  │
             ▼                   ▼                  ▼
        Geometry tree       Resources          Data sources
             │                   │                  │
             └───────────┬───────┴──────────┬───────┘
                         ▼                  ▼
                     Resolver          TemplateEngine
                         │                  │
                         └────────┬─────────┘
                                  ▼
                              Scene graph
                                  │
                                  ▼
                         Intermediate raster
                                  │
                                  ▼
                         Color conversion
                                  │
                                  ▼
                           Dither / quantize
                                  │
                                  ▼
                           Printer color planes
                                  │
                                  ▼
                            NiimBlueLib
                                  │
                                  ▼
                              NIIMBOT
```

And the editor itself is merely another consumer of the same underlying document/scene machinery:

```text
Document
   ├── Editor renderer
   ├── Preview renderer
   └── Print renderer
```

That is the part of the plan I would be most protective of.

The result is no longer really "NiimBlue but with a better editor." It becomes a **small declarative label publishing system with a physical-layout-aware renderer and programmable variable-data pipeline**, with NIIMBOT merely being one output backend. That's a much more coherent project. 
