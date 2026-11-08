# Repro — DoubleColor `Mixed` row edge artefact (niimbluelib 0.49.1)

Status: **reported upstream** (2026-11-08). This folder is the minimal evidence for
the `@mmote/niimbluelib` author. Do not work around it in our renderer until the
library is fixed.

## Symptom

On red/black (`PageColorType.DoubleColor`) pages, rows encoded by
`PacketGenerator.printBitmapRowDoubleColor` with `BitmapColorMode.Mixed` print a
**~1 byte (8 px = 0.68 mm at 300 dpi) strip of the wrong ink at every colour
boundary**:

- first byte of a **red** run → prints **black**;
- first byte of a **black** run that follows red → prints **red**;
- solid / single-colour rows (`printBitmapRowWithColor`) are clean.

The same raster prints **clean from the official NIIMBOT desktop app** and from
the official mobile app. niim.blue (which uses the same library) and our app both
reproduce the bars, so the fault is in the library path, not the raster, the
stock, or the printer.

## Root cause (author, 2026-11-08)

The printer **trims the end of the packet** to the printable width. The red
colour mask is located at the **end** of the `printBitmapRowDoubleColor`
payload, so on a label wider than the printhead the red stream is cut/shifted
while the ink mask survives — producing the wrong-ink bars. The author confirmed:

- **48 mm width → issue disappears** (567 px at 300 dpi = the printhead width).
- Wider labels (e.g. 608 px) make the black artefact **bigger**.
- Relevant code: `packet_generator.ts` `printBitmapRowDoubleColor` (`BitmapColorMode.Mixed`).

**Workaround until upstream fixes it:** render red/black pages at **≤48 mm /
printhead width**. Our 50 mm calibration and the untouched 50 mm red/black
pattern reproduce the bug; the 48 mm calibration is the control.

The missing `PrintBitmapRow` (133) byte noted below is a separate inconsistency
worth checking, but the author's trim explanation is the leading cause.

At 300 dpi: **48 mm = 567 px** (the encoder pads to 568), **50 mm = 591 px**
(pads to 592). The 48 mm packet only loses one padding column to the trim; the
50 mm packet loses/shifts the tail of the red stream.

## Fixtures

| File | Purpose |
| --- | --- |
| `minimal-mixed-edges-300dpi.png` | Smallest repro at 50 mm: paper→red, black→red, red→black, paper→black, and horizontal red/black pairs. 591×354 px, exact `#ffffff` / `#ff0000` / `#000000`. |
| `minimal-mixed-edges-48mm-300dpi.png` | Same minimal layout at **48 mm**: 567×354 px — the printhead width. |
| `red-black-calibration-48mm-300dpi.png` | Full calibration at **48 mm** (567×354 px) — the control that should print clean. |
| `red-black-calibration-48mm-300dpi-red-pane-black.png` | Its red plane (red → black, white transparent). |
| `red-black-calibration-48mm-300dpi-black-pane.png` | Its black plane (white transparent). |
| `red-black-calibration-300dpi.png` | Full calibration page used for the hardware comparison (same size). |
| `red-black-calibration-300dpi-red-pane-black.png` | Red plane only, red recoloured black, white transparent. |
| `red-black-calibration-300dpi-black-pane.png` | Black plane only, white transparent. |
| `packet-dump.txt` | Generated with 0.49.1: per mixed row, the black/red plane bytes, the mask, the library's colour array, the current command-138 payload, and two candidate payloads. |

All rasters contain only exact `#ffffff`, `#000000`, `#ff0000`; no antialiasing.

## Path

`ImageEncoder.encodeCanvas(canvas, PageColorType.DoubleColor, 'left' | 'top')`
builds `rowDataBlack` / `rowDataRed` MSB-first (bit 7 = first pixel), then
`PacketGenerator.printBitmapRowDoubleColor` sends (command 138):

```
[ BitmapColorMode.Mixed(3), posHi, posLo, repeats, ...mask, ...colour ]
mask   = blackByte | redByte            (one byte per 8 px)
colour = red bits, only for non-empty mask octets
```

`printBitmapRowWithColor` for a single ink sends:

```
[ colorMode, PrintBitmapRow(133), posHi, posLo, repeats, ...data ]
```

## Suspects (compare with the official app's capture)

1. **Missing `PrintBitmapRow` (133 / `0x85`) sub-command byte.** The Mixed path
   omits the byte the single-ink path includes. A one-byte payload shift matches
   the 0.68 mm artefact width exactly. `packet-dump.txt` candidate **A** inserts it.
2. **Colour array alignment.** The library skips colour bytes for empty mask
   octets (`if (mask !== 0) colorBytes.push(...)`). If the printer expects one
   colour byte per mask octet, the colour stream is offset. Candidate **B** sends
   a zero colour byte for every empty octet.

The author can try either candidate on hardware; both are dumped for the same
rows. A btsnoop capture from the official desktop app's command 138 would settle
it immediately.

## Reproduce on our side

- `bun run dev` → `?printcolours` → pattern **Red & black — calibration (48 mm)**.
  The 50 mm raster (`red-black-calibration-300dpi.png`) is the repro; load either
  into niim.blue.
- Unit pin of the current bytes: `src/print/printLabel.doubleColor.test.ts`.
- The rendered raster came from the P7 harness (`src/components/dev/`).

## Hardware comparison (owner, 2026-11-08)

- Official NIIMBOT desktop app, same raster: **clean** colour boundaries.
- Official app with an incorrect style (gradient lost): horizontal strips still
  **clean**.
- niim.blue + our app with the same raster: **black/red bars at every boundary**,
  including a thin bar inside the 2 mm gap between red bars.

The red coverage floor (25/12/6 % bars faint/gone) appears in the official app
too — that part is stock/printer physics, separate from this encoding bug.
