// A history entry. New entries carry a catalogue key plus interpolation params
// so they re-render in the active language at display time; `string` is kept in
// the union so history saved by earlier versions (plain baked text) still renders.
export type HistoryEntry = { key: string; params?: Record<string, unknown> } | string;
