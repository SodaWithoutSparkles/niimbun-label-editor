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

## Fixtures

| File | Purpose |
| --- | --- |
| `minimal-mixed-edges-300dpi.png` | Smallest repro: paper→red, black→red, red→black, paper→black, and horizontal red/black pairs. 591×354 px, 50×30 mm @ 300 dpi, exact `#ffffff` / `#ff0000` / `#000000`. |
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

- `bun run dev` → `?printcolours` → pattern **Red & black — calibration** (or load
  `red-black-calibration-300dpi.png` into niim.blue).
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
