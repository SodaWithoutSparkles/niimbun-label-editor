import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import type { GlobalSpec } from '../../core/doc/types';
import { Input, Select, SettingRow } from '../common/forms';

/**
 * MFP → Global data tab (ui-spec.md §8, O6, P6 W6).
 *
 * Edits `doc.data.globals` — the `GlobalSpec[]` the template pre-pass resolves
 * once per pass and exposes as `globals.<name>`. Each spec is either:
 *
 *   remote — fetched from `url`, value selected by `extract`, cached until
 *            `expiresAt`;
 *   static — a literal `value` defined here; never fetched.
 *
 * Every change writes through the undoable `setDocGlobals` action; text fields
 * use local drafts committed on blur/Enter so one edit is exactly one undo entry
 * (mirroring the asset rename fields in `ObjectTab`).
 *
 * `expiresAt` is epoch **seconds** (the `globals` cache multiplies by 1000).
 * `globals.ts` treats a cached entry as valid only while `expiresAt * 1000 >
 * now`, so `0` means "never cached" (refetch every pass). A freshly added remote
 * spec is therefore seeded a short window ahead (see
 * {@link NEW_GLOBAL_CACHE_SECONDS}).
 */

interface GlobalDataTabProps {
    /** Open document, supplied by `MfpPanel`. */
    doc: import('../../core/doc/types').LabelDoc;
}

/** Cache window (seconds) seeded onto a freshly added remote global. */
export const NEW_GLOBAL_CACHE_SECONDS = 300;

/**
 * A blank spec appended by "Add global". Defaults to a **remote** spec.
 * `expiresAt` is seeded a short window ahead so a new spec caches for the job
 * instead of refetching on every resolve pass (`0` is the explicit "never
 * cached" value). The user can edit it, or switch the row to static.
 */
const blankSpec = (): GlobalSpec => ({
    kind: 'remote',
    name: '',
    url: '',
    extract: '',
    expiresAt: Math.floor(Date.now() / 1000) + NEW_GLOBAL_CACHE_SECONDS,
});

/**
 * Seed a new spec with a unique non-empty placeholder name. `setDocGlobals`
 * drops blank-named specs (a nameless global cannot be bound), so a blank row
 * would vanish on commit and be un-editable. The name is editable afterwards.
 */
const newSpec = (existing: readonly GlobalSpec[]): GlobalSpec => {
    const names = new Set(existing.map((spec) => spec.name));
    let n = 1;
    while (names.has(`global${n}`)) n += 1;
    return { ...blankSpec(), name: `global${n}` };
};

/** One editable global row, keyed by list position so drafts seed from fresh props. */
interface GlobalRowProps {
    spec: GlobalSpec;
    onCommit: (next: GlobalSpec) => void;
    onRemove: () => void;
}

const GlobalRow: React.FC<GlobalRowProps> = ({ spec, onCommit, onRemove }) => {
    const { t } = useTranslation();
    const [name, setName] = useState(spec.name);
    const [kind, setKind] = useState<GlobalSpec['kind']>(spec.kind);
    const [url, setUrl] = useState(spec.kind === 'remote' ? spec.url : '');
    const [extract, setExtract] = useState(spec.kind === 'remote' ? spec.extract : '');
    // A static row has no expiry; a future window is kept as a draft so a
    // switch to remote starts with a sane cache window instead of "never".
    const [expiresAt, setExpiresAt] = useState(
        spec.kind === 'remote' ? String(spec.expiresAt) : String(Math.floor(Date.now() / 1000) + NEW_GLOBAL_CACHE_SECONDS),
    );
    const [value, setValue] = useState(spec.kind === 'static' ? spec.value : '');
    const [expiresError, setExpiresError] = useState<string | null>(null);

    // Re-seed the drafts whenever the committed spec changes (undo/redo, an
    // external edit, a kind switch, or a row removal re-indexing the list).
    // Without this a stale draft would overwrite the fresh value on the next
    // blur.
    useEffect(() => {
        setName(spec.name);
        setKind(spec.kind);
        setUrl(spec.kind === 'remote' ? spec.url : '');
        setExtract(spec.kind === 'remote' ? spec.extract : '');
        setExpiresAt(
            spec.kind === 'remote' ? String(spec.expiresAt) : String(Math.floor(Date.now() / 1000) + NEW_GLOBAL_CACHE_SECONDS),
        );
        setValue(spec.kind === 'static' ? spec.value : '');
        setExpiresError(null);
    }, [spec]);

    /** Commit a static row. */
    const commitStatic = () => {
        onCommit({ kind: 'static', name, value });
    };

    /** Commit a remote row; an unparseable expiry keeps its last valid value. */
    const commitRemote = () => {
        const parsed = Number(expiresAt);
        onCommit({
            kind: 'remote',
            name,
            url,
            extract,
            expiresAt: Number.isFinite(parsed)
                ? Math.max(0, Math.floor(parsed))
                : spec.kind === 'remote'
                    ? spec.expiresAt
                    : Math.floor(Date.now() / 1000) + NEW_GLOBAL_CACHE_SECONDS,
        });
    };

    /** Commit the text fields for the active kind. */
    const commitText = () => {
        if (kind === 'static') commitStatic();
        else commitRemote();
    };

    /** Switch kind, committing the row immediately as one undo entry. */
    const commitKind = (next: GlobalSpec['kind']) => {
        if (next === kind) return;
        setKind(next);
        if (next === 'static') commitStatic();
        else commitRemote();
    };

    /** Commit the expiry field, surfacing a parse failure instead of storing 0. */
    const commitExpires = () => {
        const trimmed = expiresAt.trim();
        const parsed = Number(trimmed);
        if (trimmed === '' || !Number.isFinite(parsed)) {
            setExpiresError(t('editor.mfp.globalExpiresAtInvalid'));
            return;
        }
        setExpiresError(null);
        onCommit({ kind: 'remote', name, url, extract, expiresAt: Math.max(0, Math.floor(parsed)) });
    };

    const onEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
    };

    return (
        <div className="space-y-1 rounded border border-gray-700 bg-gray-900 p-2">
            <SettingRow label={t('editor.mfp.globalName')}>
                <Input
                    value={name}
                    onChange={setName}
                    onBlur={commitText}
                    onKeyDown={onEnter}
                    aria-label={t('editor.mfp.globalName')}
                    className="w-36"
                />
            </SettingRow>
            <SettingRow label={t('editor.mfp.globalKind')}>
                <Select
                    value={kind}
                    onChange={(next) => commitKind(next as GlobalSpec['kind'])}
                    options={[
                        { value: 'remote', label: t('editor.mfp.globalKindRemote') },
                        { value: 'static', label: t('editor.mfp.globalKindStatic') },
                    ]}
                    aria-label={t('editor.mfp.globalKind')}
                    data-testid="global-kind"
                    className="w-36"
                />
            </SettingRow>
            {kind === 'static' ? (
                <SettingRow label={t('editor.mfp.globalValue')} description={t('editor.mfp.globalValueHint')}>
                    <Input
                        value={value}
                        onChange={setValue}
                        onBlur={commitStatic}
                        onKeyDown={onEnter}
                        aria-label={t('editor.mfp.globalValue')}
                        data-testid="global-value"
                        className="w-36"
                    />
                </SettingRow>
            ) : (
                <>
                    <SettingRow label={t('editor.mfp.globalUrl')}>
                        <Input
                            value={url}
                            onChange={setUrl}
                            onBlur={commitText}
                            onKeyDown={onEnter}
                            aria-label={t('editor.mfp.globalUrl')}
                            className="w-36"
                        />
                    </SettingRow>
                    <SettingRow label={t('editor.mfp.globalExtract')}>
                        <Input
                            value={extract}
                            onChange={setExtract}
                            onBlur={commitText}
                            onKeyDown={onEnter}
                            aria-label={t('editor.mfp.globalExtract')}
                            className="w-36"
                        />
                    </SettingRow>
                    <SettingRow label={t('editor.mfp.globalExpiresAt')} description={t('editor.mfp.globalExpiresAtHint')}>
                        <Input
                            type="number"
                            min={0}
                            value={expiresAt}
                            onChange={setExpiresAt}
                            onBlur={commitExpires}
                            onKeyDown={onEnter}
                            inputMode="numeric"
                            aria-label={t('editor.mfp.globalExpiresAt')}
                            className="w-36"
                        />
                    </SettingRow>
                    {expiresError && (
                        <p role="alert" className="text-right text-xs text-red-400">
                            {expiresError}
                        </p>
                    )}
                </>
            )}
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={onRemove}
                    className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                >
                    {t('editor.mfp.globalRemove')}
                </button>
            </div>
        </div>
    );
};

export const GlobalDataTab: React.FC<GlobalDataTabProps> = ({ doc }) => {
    const { t } = useTranslation();
    const setDocGlobals = useStore((state) => state.setDocGlobals);
    const globals = doc.data.globals;

    const updateAt = (index: number, next: GlobalSpec) => {
        const copy = globals.map((spec, i) => (i === index ? next : spec));
        setDocGlobals(copy);
    };

    const removeAt = (index: number) => {
        setDocGlobals(globals.filter((_, i) => i !== index));
    };

    const add = () => {
        setDocGlobals([...globals, newSpec(globals)]);
    };

    return (
        <div className="space-y-3 p-3 text-sm">
            {globals.length === 0 && <p className="text-xs text-gray-500">{t('editor.mfp.globalEmpty')}</p>}

            {globals.map((spec, index) => (
                <GlobalRow
                    // Key by list position, NOT `name`+index: a rename must not
                    // remount and discard the in-progress draft, and `GlobalSpec`
                    // has no stable id. `GlobalRow` re-seeds its drafts from props
                    // whenever the spec changes, so undo/redo and a row removal
                    // re-indexing the list cannot leave a stale draft behind.
                    key={index}
                    spec={spec}
                    onCommit={(next) => updateAt(index, next)}
                    onRemove={() => removeAt(index)}
                />
            ))}

            <button
                type="button"
                onClick={add}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
            >
                {t('editor.mfp.globalAdd')}
            </button>
        </div>
    );
};
