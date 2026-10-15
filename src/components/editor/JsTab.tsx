import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import type { ContentSource, Node } from '../../core/doc/types';
import type { NodePatch } from '../../store/storeTypes';
import { contentSourceOf, contentFieldKey } from '../../editor/contentSource';
import { useSampleRowState } from './sampleRowContext';
import { Input, Select } from '../common/forms';

/**
 * MFP → JS tab (ui-spec.md §8, P6 W6).
 *
 * Authors the selected text/qr/barcode node's `ContentSource`: a static value, a
 * CSV column binding, or a template (`code` + `fallback`). The kind switcher is
 * the ONLY place a source is rewritten to `static` — editing a field for an
 * existing csv/template source never changes its kind (fixes the P3/P5 bug where
 * the Object tab rewrote a bound source on edit).
 *
 * Trust state and template-evaluation failures come from the shared sample-row
 * pass (context); a node whose template failed shows an error badge. A selection
 * that cannot carry a `ContentSource` renders disabled-with-reason.
 */

interface JsTabProps {
    selected: readonly Node[];
}

type SourceKind = ContentSource['kind'];

const KIND_LABEL_KEYS = {
    static: 'editor.mfp.contentStatic',
    csv: 'editor.mfp.contentCsv',
    template: 'editor.mfp.contentTemplate',
} as const satisfies Record<SourceKind, string>;

/** Field label key per carrier node type (literal map keeps typed keys). */
const FIELD_LABEL_KEYS = {
    text: 'editor.mfp.field.text',
    qr: 'editor.mfp.field.data',
    barcode: 'editor.mfp.field.data',
} as const satisfies Record<'text' | 'qr' | 'barcode', string>;

/** Trust-state label key (literal map keeps typed keys). */
const TRUST_LABEL_KEYS = {
    ask: 'editor.mfp.trust.ask',
    always: 'editor.mfp.trust.always',
    never: 'editor.mfp.trust.never',
} as const;

/** The node prop key that carries the source for a text/qr/barcode node. */
const sourceFieldKey = contentFieldKey;

/**
 * One cell in the JS tab's adaptive control grid: a label above its control.
 * The tab used `SettingRow` (label and control on one line, fixed `w-36`/`w-40`
 * control); stacking lets each control fill its grid cell, which is what lets
 * the Content / Trust / Fallback row fit on one line at wide widths.
 */
const TabField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-gray-400">{label}</span>
        {children}
    </div>
);

export const JsTab: React.FC<JsTabProps> = ({ selected }) => {
    const { t } = useTranslation();
    const updateNode = useStore((state) => state.updateNode);
    const csvRepo = useStore((state) => state.csvRepo);
    const doc = useStore((state) => state.currentDoc);
    const sampleRow = useSampleRowState();

    const first = selected[0];
    const fieldKey = first ? sourceFieldKey(first) : undefined;
    const source = first ? contentSourceOf(first) : undefined;

    const [csvColumns, setCsvColumns] = useState<string[]>([]);
    useEffect(() => {
        const csvId = doc?.data.csv?.csvId;
        if (!csvRepo || csvId === undefined) {
            setCsvColumns([]);
            return;
        }
        let cancelled = false;
        csvRepo
            .get(csvId)
            .then((record) => {
                if (!cancelled) setCsvColumns(record?.columns ?? []);
            })
            .catch(() => {
                if (!cancelled) setCsvColumns([]);
            });
        return () => {
            cancelled = true;
        };
    }, [csvRepo, doc?.data.csv?.csvId]);

    // The tab only has a job for a single text/qr/barcode selection.
    if (!first || fieldKey === undefined) {
        return (
            <div className="p-3">
                <p className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-sm text-amber-200">
                    {t('editor.mfp.jsDisabledSelection')}
                </p>
            </div>
        );
    }

    // A single node is edited directly; a same-kind multi-selection needs one
    // shared source shape. Require a single selection for authoring clarity.
    if (selected.length > 1) {
        return (
            <div className="p-3">
                <p className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-sm text-amber-200">
                    {t('editor.mfp.jsDisabledMulti')}
                </p>
            </div>
        );
    }

    const write = (patch: NodePatch) => updateNode(first.id, patch);

    const currentKind: SourceKind = source?.kind ?? 'static';
    const templateError = sampleRow?.templateErrors.get(first.id);
    const trust = sampleRow?.trust ?? 'ask';
    const templateBlocked = trust === 'never';
    const templateNeedsApproval = trust === 'ask';

    /** Replace the source, preserving the kind's own fields. */
    const switchKind = (kind: SourceKind) => {
        // A select with a filtered-out option reports `''`; ignore anything that
        // is not a real kind rather than falling through to a template source.
        if (kind !== 'static' && kind !== 'csv' && kind !== 'template') return;
        if (kind === source?.kind) return;
        // `never` disables authoring a NEW template source; an existing template
        // stays selectable so the user can switch away from it.
        if (kind === 'template' && templateBlocked && source?.kind !== 'template') return;
        let next: ContentSource;
        if (kind === 'static') next = { kind: 'static', value: '' };
        else if (kind === 'csv') next = { kind: 'csv', column: '', fallback: '' };
        else next = { kind: 'template', code: '', fallback: '' };
        write({ [fieldKey]: next } as NodePatch);
    };

    // `never` hides the template option unless the node is already a template
    // (so an existing template remains selectable and can be switched away).
    const kindOptions = (['static', 'csv', 'template'] as const).filter(
        (kind) => !(kind === 'template' && templateBlocked && source?.kind !== 'template'),
    );

    return (
        <div className="space-y-3 p-3 text-sm">
            {/* Top controls: content kind + trust + fallback share one adaptive
                row at wide, collapsing 3 → 2 → 1 columns as the pane narrows.
                Trust is only meaningful for a template source and the fallback
                only exists for csv/template; static shows just the value below. */}
            <div
                className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3"
                data-testid="js-top-row"
            >
                <TabField label={t('editor.mfp.contentSource')}>
                    <Select
                        value={currentKind}
                        onChange={(value) => switchKind(value as SourceKind)}
                        options={kindOptions.map((kind) => ({
                            value: kind,
                            label: t(KIND_LABEL_KEYS[kind]),
                        }))}
                        className="w-full"
                        aria-label={t('editor.mfp.contentSource')}
                    />
                </TabField>

                {currentKind === 'template' && (
                    <TabField label={t('editor.mfp.templateTrustState')}>
                        <span
                            data-testid="js-trust-state"
                            className="self-start rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-200"
                        >
                            {t(TRUST_LABEL_KEYS[trust])}
                        </span>
                    </TabField>
                )}

                {currentKind === 'csv' && (
                    <TabField label={t('editor.mfp.contentFallback')}>
                        <Input
                            value={source?.kind === 'csv' ? source.fallback : ''}
                            onChange={(fallback) =>
                                write({ [fieldKey]: { kind: 'csv', column: source?.kind === 'csv' ? source.column : '', fallback } } as NodePatch)
                            }
                            aria-label={t('editor.mfp.contentFallback')}
                        />
                    </TabField>
                )}

                {currentKind === 'template' && (
                    <TabField label={t('editor.mfp.contentFallback')}>
                        <Input
                            value={source?.kind === 'template' ? source.fallback : ''}
                            disabled={templateBlocked}
                            onChange={(fallback) =>
                                write({ [fieldKey]: { kind: 'template', code: source?.kind === 'template' ? source.code : '', fallback } } as NodePatch)
                            }
                            aria-label={t('editor.mfp.contentFallback')}
                        />
                    </TabField>
                )}
            </div>

            {currentKind === 'static' && (
                <TabField label={t(FIELD_LABEL_KEYS[first.type as 'text' | 'qr' | 'barcode'])}>
                    <Input
                        value={source?.kind === 'static' ? source.value : ''}
                        onChange={(value) => write({ [fieldKey]: { kind: 'static', value } } as NodePatch)}
                        aria-label={t(FIELD_LABEL_KEYS[first.type as 'text' | 'qr' | 'barcode'])}
                    />
                </TabField>
            )}

            {currentKind === 'csv' && (
                <TabField label={t('editor.mfp.csvColumn')}>
                    {csvColumns.length > 0 ? (
                        <Select
                            value={source?.kind === 'csv' ? source.column : ''}
                            onChange={(column) =>
                                write({ [fieldKey]: { kind: 'csv', column, fallback: source?.kind === 'csv' ? source.fallback : '' } } as NodePatch)
                            }
                            options={[
                                { value: '', label: t('editor.mfp.none') },
                                ...csvColumns.map((column) => ({ value: column, label: column })),
                            ]}
                            className="w-full"
                            aria-label={t('editor.mfp.csvColumn')}
                        />
                    ) : (
                        <Input
                            value={source?.kind === 'csv' ? source.column : ''}
                            onChange={(column) =>
                                write({ [fieldKey]: { kind: 'csv', column, fallback: source?.kind === 'csv' ? source.fallback : '' } } as NodePatch)
                            }
                            aria-label={t('editor.mfp.csvColumn')}
                        />
                    )}
                </TabField>
            )}

            {currentKind === 'template' && (
                <>
                    {templateBlocked && (
                        <p role="alert" data-testid="js-template-blocked" className="rounded border border-red-700 bg-red-900/30 px-2 py-1 text-xs text-red-200">
                            {t('editor.mfp.trustDisabled')}
                        </p>
                    )}
                    {!templateBlocked && templateNeedsApproval && (
                        <p data-testid="js-template-needs-approval" className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-xs text-amber-200">
                            {t('editor.mfp.templateNeedsApproval')}
                        </p>
                    )}
                    {templateError && (
                        <p role="alert" data-testid="js-template-error" className="text-xs text-red-400">
                            {t('editor.mfp.templateError', { message: templateError })}
                        </p>
                    )}
                    <TabField label={t('editor.mfp.templateCode')}>
                        <textarea
                            value={source?.kind === 'template' ? source.code : ''}
                            disabled={templateBlocked}
                            onChange={(event) =>
                                write({ [fieldKey]: { kind: 'template', code: event.target.value, fallback: source?.kind === 'template' ? source.fallback : '' } } as NodePatch)
                            }
                            rows={6}
                            spellCheck={false}
                            aria-label={t('editor.mfp.templateCode')}
                            className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 font-mono text-xs text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </TabField>
                </>
            )}
        </div>
    );
};
