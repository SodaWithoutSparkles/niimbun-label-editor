import type { AssetWarning } from './render/assets';

export type EditorWarningSource = 'preview' | 'fonts' | 'csv' | 'print';

interface WarningBase {
    id: string;
    nodeId?: string;
}

export type EditorWarning =
    | (WarningBase & { kind: 'asset'; nodeId: string; assetWarning: AssetWarning; label: string })
    | (WarningBase & { kind: 'keep-out'; nodeId: string; label: string })
    | (WarningBase & { kind: 'font-missing'; label: string })
    | (WarningBase & { kind: 'global'; name: string; warningKind: string })
    | (WarningBase & { kind: 'template-error'; nodeId: string; label: string; message: string })
    | (WarningBase & { kind: 'template-blocked' | 'template-approval' | 'sample-row-error'; message?: string })
    | (WarningBase & { kind: 'csv-empty' | 'csv-parse-error' })
    | (WarningBase & { kind: 'csv-rows-capped'; cap: number; total: number })
    | (WarningBase & { kind: 'print-overflow'; width: number; head: number })
    | (WarningBase & { kind: 'print-interleaved'; pages: number; cap: number })
    | (WarningBase & { kind: 'print-mismatch'; labelW: number; labelH: number; labelDpi: number; resolvedDpi: number; printerDpiInUse: boolean })
    | (WarningBase & { kind: 'print-policy-overflow'; count: number })
    | (WarningBase & { kind: 'print-mirror-clipped'; pixels: number });

export interface EditorWarningGroup {
    docId: string;
    scopeId?: string;
    warnings: readonly EditorWarning[];
}
