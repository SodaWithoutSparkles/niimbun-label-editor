# Wave 3 · Phase 18 — Printer metadata refresh (owner, 2026-10-28)

- Date: 2026-10-28
- Baseline: `main` @ P14 commit (whichever lands first)
- Reviewer: `review` (transport contract change)
- Commit: `fix(print): refresh printer metadata when the library re-reads it`

## Failure mode (confirmed)

`NiimbotTransport` reads printer info + RFID **once**, in `connect()`
(`niimbotAdapter.ts:155-162`), and then subscribes to
`printprogress | printpacketprogress | connect | disconnect | heartbeat |
heartbeatfailed` (`:376-387`). It does **not** subscribe to
`printerinfofetched` or `rfidinfofetched`.

The library *does* keep metadata fresh on its own:

- 15 s heartbeat (we override the 2 s default at `:167-168`) carries battery and
  the paper/lid flags; on a `lidClosed` / `paperRfidSuccess` /
  `ribbonRfidSuccess` change it calls `fetchRfidInfo()` internally
  (`abstract_client.js:341-347`) — **that is the roll-swap detector**;
- after every print it re-fetches RFID (`fetchRfidOnPrintEnd`, `:61-65`);
- both paths only announce the result via `rfidinfofetched` / `printerinfofetched`.

We drop those events, so `printerStatus.rollWidthHm/rollHeightHm`, `dpi`,
HW/SW, battery-at-heartbeat-only and `rfid` stay frozen at connect time. The
only full refresh is the manual Refresh button in `ConnectionChip`
(`ConnectionChip.tsx:173-183`) — `refreshInfo()` has no other caller.

Consequence: after a roll swap the print dialog's roll/dpi mismatch warning,
the keep-out geometry and the reported label type all describe the old roll.

## Design (fixed)

### 1. Republish on the library's own fetches

In `niimbotAdapter`, extend the `client.on(...)` wiring:

- `rfidinfofetched` → rebuild the RFID-owned part of `lastConnected`:
  `rollWidthHm`, `rollHeightHm`, `rfid`, **and the new reported label type
  (§2)**; emit `{...lastConnected, state: currentState-ish}`.
- `printerinfofetched` → rebuild `deviceName`, `dpi`, `hardwareVersion`,
  `softwareVersion`, `batteryPercent`, `capabilities`, emit.

Rules:

- Only emit while the adapter is `connected` (the library emits during
  `connect()` negotiation, before our own `connected` status; a handler that
  fires early must update the cached `lastConnected` **without** emitting, so
  the connect flow still owns the first status).
- Reuse one `buildConnectedStatus(printerInfo, rfidInfo)` helper fed from
  `client.getPrinterInfo()` / `getRfidInfo()` cache getters (the event payloads
  are the freshly merged objects) instead of duplicating field lists.
- Never emit during an active print (`currentState === 'printing'`): the job
  owns the status channel; `lastConnected` updates and the settle at
  `:315` publishes it.
- Unsubscribe all four new/old handlers in the same place the others are torn
  down (`:376-387` mirror on disconnect).
- Missing/partial info must keep the previous value for that field (same rule
  as the heartbeat handler today), never `undefined` a known value.

### 2. Publish the reported label type

Add `labelType?: LabelType` to `PrinterStatus` (`src/print/transport.ts`),
documented as **"the type the printer reports for the loaded roll, when it
reports one"** (not a capability).

Source order (first valid wins):

1. `rfidInfo.labelRfidInfo?.consumablesType` (the tag's own consumable type —
   what `ConnectionChip` already displays),
2. `rfidInfo.paperInfo?.paperType` (currently discarded; `buildConnectedStatus`
   reads only `paperWidth/paperHeight`),
3. absent.

`LabelType.Invalid` (0) or a value outside our `LABEL_TYPE_OPTIONS` is treated
as absent. `PrinterRfidInfo` gains no new field; `rfidOf` keeps its contract.

### 3. One-shot refresh when the print dialog opens

`PrintDialog` mount (or `EditorShell` at `isPrintOpen`):

```ts
useEffect(() => {
    if (!open) return;
    void transport.refreshInfo?.(…);   // no-op-safe, fire-and-forget
}, [open]);
```

- Call through the same `jobs`/transport seam `EditorShell` already has; the
  optional method is already in the contract (`transport.ts:181-182`).
- Swallow rejection (the mock transport may be disconnected); no spinner, no
  error surface — the status subscription delivers the update.
- **Do not** add a timer. The library heartbeat + the two event subscriptions
  cover the live cases; a poll would duplicate `rfidinfofetched` at packet cost.
- A roll swap that happens while the dialog is open is covered by the
  `rfidinfofetched` subscription (lid open/close), not by this one-shot.

## Files

| File | Change |
| --- | --- |
| `src/print/transport.ts` | `PrinterStatus.labelType?`, doc for the new freshness note |
| `src/print/niimbotAdapter.ts` | subscribe `rfidinfofetched`/`printerinfofetched`, rebuild + emit, map reported label type |
| `src/print/mockTransport.ts` | expose a reported `labelType` so the dialog phase can test seeding |
| `src/components/editor/EditorShell.tsx` | refresh on print-dialog open |
| tests | below |

## Tests

`niimbotAdapter.test.ts`:
- `rfidinfofetched` after connect → a new status with the new roll dims / rfid /
  reported label type (proves the roll swap path);
- `printerinfofetched` → dpi/HW/SW/battery updated;
- either event **before** the connect flow completes emits nothing (connect owns
  the first status) but the cached status is updated;
- neither event emits while printing (state stays `printing`);
- a partial payload keeps the previous value;
- disconnect unsubscribes (emit after disconnect → no status);
- reported label type: `consumablesType` wins over `paperType`;
  `paperType` used when `consumablesType` is absent; `Invalid`/unknown ⇒ absent.

`ConnectionChip.test.tsx` / `EditorShell.test.tsx`:
- opening the print dialog calls `refreshInfo` exactly once per open;
- a rejected `refreshInfo` does not surface an error or block the dialog.

Gate: full suite + `tsc --noEmit`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Double status emissions during connect | Emit only when already `connected`; cached update otherwise |
| Status churn during a print | Never emit while `printing`; the settle publishes |
| Event payload shape drift | Read through the client cache getters + one builder, not ad-hoc fields |
| Refresh storm from repeated dialog opens | One call per open, fire-and-forget; the library's own fetch is the rate limiter |
