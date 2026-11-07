import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { CSV_ROW_FIELD_ID, isReservedFieldId } from '../../core/doc/fieldDefs';
import { presetFieldNames } from '../../editor/presetFields';
import type { FieldDef, LabelDoc } from '../../core/doc/types';
import { Input } from '../common/forms';

/**
 * MFP → Fields tab (P6a).
 *
 * Edits `doc.data.fields`, the declarations that drive the preset fill form:
 * `default` pre-fills a value, `required` refuses to print while empty and
 * `hidden` keeps a field out of the default form. A declaration is optional — a
 * `{ kind: 'field' }` binding resolves without one — so the tab also offers to
 * declare every bound-but-undeclared name (no data hides silently).
 *
 * Every write goes through the undoable `setDocFields` / `ensureFieldDef`
 * actions. Ids are never renamed here (that would orphan bindings); the default
 * draft commits on blur/Enter so one edit is one undo entry, mirroring the
 * Global data tab.
 */

interface FieldsTabProps {
    /** Open document, supplied by `MfpPanel`. */
    doc: LabelDoc;
}

/** Commit a boolean flag, omitting it when unchecked (`false` = absent). */
const flagPatch = (def: FieldDef, key: 'required' | 'hidden', value: boolean): FieldDef => ({
    ...def,
    [key]: value ? true : undefined,
});

/** One declared field: id (read-only), default, rules and remove. */
interface FieldRowProps {
    def: FieldDef;
    onCommit: (next: FieldDef) => void;
    onRemove: () => void;
}

const FieldRow: React.FC<FieldRowProps> = ({ def, onCommit, onRemove }) => {
    const { t } = useTranslation();
    // A reserved id (currently `csv.row`) has no user-authored default.
    const reserved = isReservedFieldId(def.id);
    const [defaultValue, setDefaultValue] = useState(def.default ?? '');

    // Re-seed the draft when the committed declaration changes (undo/redo, an
    // external edit, or a removal re-indexing the list).
    useEffect(() => {
        setDefaultValue(def.default ?? '');
    }, [def]);

    const commitDefault = () => {
        if (defaultValue === (def.default ?? '')) return;
        onCommit({ ...def, default: defaultValue.length > 0 ? defaultValue : undefined });
    };

    const onEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
    };

    return (
        <div
            role="group"
            aria-label={def.id}
            data-testid={`field-row-${def.id}`}
            className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-gray-700 bg-gray-900 p-2"
        >
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-100" title={def.id}>
                {def.id}
            </span>

            {reserved ? (
                <span className="text-xs text-gray-500">{t('fields.reservedHint')}</span>
            ) : (
                <Input
                    value={defaultValue}
                    onChange={setDefaultValue}
                    onBlur={commitDefault}
                    onKeyDown={onEnter}
                    aria-label={t('fields.default')}
                    placeholder={t('fields.default')}
                    className="w-40"
                />
            )}

            <div className="flex shrink-0 items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-gray-300">
                    <input
                        type="checkbox"
                        checked={def.required === true}
                        onChange={(event) => onCommit(flagPatch(def, 'required', event.target.checked))}
                        className="accent-blue-500"
                    />
                    {t('fields.required')}
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-300">
                    <input
                        type="checkbox"
                        checked={def.hidden === true}
                        onChange={(event) => onCommit(flagPatch(def, 'hidden', event.target.checked))}
                        className="accent-blue-500"
                    />
                    {t('fields.hidden')}
                </label>
            </div>

            <button
                type="button"
                onClick={onRemove}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
                {t('fields.remove')}
            </button>
        </div>
    );
};

export const FieldsTab: React.FC<FieldsTabProps> = ({ doc }) => {
    const { t } = useTranslation();
    const setDocFields = useStore((state) => state.setDocFields);
    const ensureFieldDef = useStore((state) => state.ensureFieldDef);
    const [newId, setNewId] = useState('');

    const fields = doc.data.fields ?? [];
    const declared = new Set(fields.map((field) => field.id));
    // Seek order follows the bindings, so the list matches what the fill form
    // sees. Only non-empty names count (`presetFieldNames` owns that rule).
    const undeclared = presetFieldNames(doc).filter((name) => !declared.has(name));
    const csvAttached = doc.data.csv !== undefined;
    const rowSelectorDeclared = declared.has(CSV_ROW_FIELD_ID);

    const canAdd = newId.trim().length > 0 && !declared.has(newId);

    const updateAt = (index: number, next: FieldDef) => {
        setDocFields(fields.map((field, i) => (i === index ? next : field)));
    };

    const removeAt = (index: number) => {
        setDocFields(fields.filter((_, i) => i !== index));
    };

    const add = () => {
        if (!canAdd) return;
        // Stored untrimmed: it must match the binding's exact lookup key.
        setDocFields([...fields, { id: newId }]);
        setNewId('');
    };

    return (
        <div className="space-y-3 p-3 text-sm">
            <div>
                <h3 className="text-sm font-medium text-gray-200">{t('fields.title')}</h3>
                <p className="text-xs text-gray-500">{t('fields.hint')}</p>
            </div>

            {fields.length === 0 && <p className="text-xs text-gray-500">{t('fields.empty')}</p>}

            <div className="space-y-2" data-testid="field-rows">
                {fields.map((def, index) => (
                    <FieldRow
                        // Key by id: ids are unique, a rename is impossible here.
                        key={def.id}
                        def={def}
                        onCommit={(next) => updateAt(index, next)}
                        onRemove={() => removeAt(index)}
                    />
                ))}
            </div>

            <div className="flex items-end gap-2">
                <Input
                    value={newId}
                    onChange={setNewId}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') add();
                    }}
                    aria-label={t('fields.addPlaceholder')}
                    placeholder={t('fields.addPlaceholder')}
                    className="max-w-48"
                />
                <button
                    type="button"
                    onClick={add}
                    disabled={!canAdd}
                    className="shrink-0 rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {t('fields.add')}
                </button>
            </div>

            {undeclared.length > 0 && (
                <section
                    aria-label={t('fields.undeclaredTitle')}
                    className="space-y-2 rounded border border-amber-700 bg-amber-900/20 p-2"
                >
                    <h4 className="text-xs font-medium text-amber-200">{t('fields.undeclaredTitle')}</h4>
                    <p className="text-xs text-gray-400">{t('fields.undeclaredHint')}</p>
                    {undeclared.map((name) => (
                        <div key={name} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-100" title={name}>
                                {name}
                            </span>
                            <button
                                type="button"
                                onClick={() => ensureFieldDef(name)}
                                className="shrink-0 rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                            >
                                {t('fields.addDeclaration')}
                            </button>
                        </div>
                    ))}
                </section>
            )}

            {csvAttached && !rowSelectorDeclared && (
                <div className="space-y-2 rounded border border-gray-700 bg-gray-900 p-2">
                    <p className="text-xs text-gray-400">{t('fields.rowSelectorHint')}</p>
                    <button
                        type="button"
                        onClick={() => ensureFieldDef(CSV_ROW_FIELD_ID)}
                        className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                    >
                        {t('fields.addRowSelector')}
                    </button>
                </div>
            )}
        </div>
    );
};
