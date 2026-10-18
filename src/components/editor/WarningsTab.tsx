import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import type { EditorWarning } from '../../editor/warnings';

/**
 * Literal map from `AssetWarning` to its i18n key (i18n memory: a computed key
 * does not typecheck, and a ternary silently falls through to `too-small` when a
 * new kind is added). The map is exhaustive by type, so a 4th kind is a `tsc`
 * error rather than the wrong copy.
 */
const ASSET_WARNING_KEYS = {
    missing: 'editor.mfp.warningAssetMissing',
    invalid: 'editor.mfp.warningAssetInvalid',
    'too-small': 'editor.mfp.warningAssetTooSmall',
} as const;

/**
 * i18n memory: never annotate a parameter with the whole generic `t` type
 * (`ReturnType<typeof useTranslation>['t']`) — materialising it is
 * instantiation-depth-sensitive (TS2589). Close over `t` in a hook instead,
 * which keeps keys typed without naming the generic type in a signature.
 */
const useWarningText = (): ((warning: EditorWarning) => string) => {
    const { t } = useTranslation();
    return useMemo(() => (warning: EditorWarning): string => {
        switch (warning.kind) {
            case 'asset':
                return t(ASSET_WARNING_KEYS[warning.assetWarning], { node: warning.label });
            case 'keep-out':
                return t('editor.mfp.warningKeepOut', { node: warning.label });
            case 'font-missing':
                return t('editor.mfp.warningFontMissing', { font: warning.label });
            case 'global':
                return t('editor.mfp.globalWarning', { name: warning.name, kind: warning.warningKind });
            case 'template-error':
                return t('editor.mfp.warningTemplateError', { message: warning.message, node: warning.label });
            case 'template-blocked':
                return t('editor.mfp.templateBlocked');
            case 'template-approval':
                return t('editor.mfp.templateNeedsApproval');
            case 'sample-row-error':
                return t('editor.mfp.sampleRowError', { message: warning.message ?? '' });
            case 'csv-empty':
                return t('editor.mfp.csvEmpty');
            case 'csv-parse-error':
                return t('editor.mfp.csvParseError');
            case 'csv-rows-capped':
                return t('editor.mfp.csvRowsCapped', { cap: warning.cap, total: warning.total });
            case 'print-overflow':
                return t('print.warnings.overflow', { width: warning.width, head: warning.head });
            case 'print-interleaved':
                return t('print.warnings.interleaved', { pages: warning.pages, cap: warning.cap });
            case 'print-mismatch':
                return t('print.warnings.mismatch', { labelW: warning.labelW, labelH: warning.labelH, labelDpi: warning.labelDpi });
            case 'print-policy-overflow':
                return t('print.warnings.policyOverflow', { count: warning.count });
            case 'print-mirror-clipped':
                return t('print.warnings.mirrorClipped', { pixels: warning.pixels });
        }
    }, [t]);
};

/**
 * Warnings MFP tab (P6): a pure reader of the store's `editorWarnings` groups.
 * Every producer (preview, fonts, csv, print) publishes there; this tab only
 * filters to the open document — and, for the CSV group, to the attached table —
 * and renders per-kind localized copy with a selection jump for node-scoped
 * entries.
 */
export const WarningsTab: React.FC = () => {
    const { t } = useTranslation();
    const warningText = useWarningText();
    const doc = useStore((state) => state.currentDoc);
    const groups = useStore((state) => state.editorWarnings);
    const selectNode = useStore((state) => state.selectNode);

    const warnings = useMemo(
        () => Object.entries(groups).flatMap(([source, group]) => {
            if (!group || group.docId !== doc?.meta.id) return [];
            if (source === 'csv' && group.scopeId !== doc?.data.csv?.csvId) return [];
            return group.warnings;
        }),
        [groups, doc?.meta.id, doc?.data.csv?.csvId],
    );

    return (
        <div className="space-y-2 p-3 text-sm" data-testid="warnings-tab">
            {warnings.length === 0 ? (
                <p className="text-gray-400">{t('editor.mfp.warningsEmpty')}</p>
            ) : warnings.map((warning) => {
                const { nodeId } = warning;
                return (
                    <div key={warning.id} className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1.5 text-amber-100">
                        {nodeId ? (
                            <button type="button" onClick={() => selectNode(nodeId)} className="w-full text-left hover:underline" data-testid={`warning-${warning.id}`}>
                                {warningText(warning)}
                            </button>
                        ) : <p data-testid={`warning-${warning.id}`}>{warningText(warning)}</p>}
                    </div>
                );
            })}
        </div>
    );
};
