import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createIdbAdapter, type StorageAdapter } from '../../data/db';
import {
    createTrustRepo,
    type TrustDecision,
    type TrustRecord,
    type TrustRepo,
} from '../../data/trustRepo';
import { useStore } from '../../store/useStore';
import { confirm } from '../common/dialogs';
import { SettingRow } from '../common/forms';
import type { TrustGate } from '../../core/trust';

interface TrustSectionProps {
    /** Injectable for tests; otherwise the store's repo is used. */
    repo?: TrustRepo;
    /**
     * The shared gate (same session overlay as the editor). When present,
     * revoke/reset go through it so a Settings revoke lifts a session Allow.
     */
    gate?: TrustGate;
}

/**
 * Literal map so the stored decision keeps i18next's typed-key union (a computed
 * `t('settings.trust.' + decision)` would collapse to `string`).
 */
const DECISION_LABEL_KEYS = {
    ask: 'settings.trust.ask',
    always: 'settings.trust.always',
    never: 'settings.trust.never',
} as const satisfies Record<TrustDecision, string>;

/** A merged list row: a persisted record or a session-only overlay entry. */
interface TrustRow extends TrustRecord {
    /** True when the decision lives only in the gate's session overlay. */
    session: boolean;
}

/**
 * Merge persisted records with the gate's session-only entries into one list,
 * keyed by doc id. The session decision wins when both exist (it is what the
 * gate currently resolves), and the row is marked so the UI can label it. Order
 * follows persisted records first, then session-only additions.
 */
const mergeRows = (persisted: readonly TrustRecord[], session: readonly TrustRecord[]): TrustRow[] => {
    const byId = new Map<string, TrustRow>();
    for (const record of persisted) byId.set(record.docId, { ...record, session: false });
    for (const record of session) byId.set(record.docId, { ...record, session: true });
    return [...byId.values()];
};

/**
 * Settings → Template trust. Lists the stored trust decisions (documents with a
 * persisted `always`/`never`), with per-row Revoke and Reset-all. Trust is local
 * state (invariant 11); revoking drops the record so the document returns to the
 * `ask` default and will prompt on next open.
 *
 * The caller (Settings modal) passes the store's shared `repo`/`gate`, so this
 * section and the editor operate on the SAME gate/session overlay. With no
 * injected repo it opens its own IDB adapter and closes it on unmount — a leaked
 * extra connection can block a future schema upgrade.
 */
export const TrustSection: React.FC<TrustSectionProps> = ({ repo: injected, gate: injectedGate }) => {
    const { t } = useTranslation();
    // Bump the shared trust revision after a successful revoke/reset so the
    // editor's sample-row pass re-resolves the open document.
    const bumpTrustRevision = useStore((state) => state.bumpTrustRevision);
    const adapterRef = useRef<StorageAdapter | null>(null);
    const aliveRef = useRef(true);
    const [repo, setRepo] = useState<TrustRepo | null>(injected ?? null);
    const [gate, setGate] = useState<TrustGate | null>(injectedGate ?? null);
    // `null` = loading, `[]` = loaded/empty.
    const [records, setRecords] = useState<TrustRecord[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [actionError, setActionError] = useState(false);

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    const refresh = useCallback(async (target: TrustRepo) => {
        try {
            const next = await target.list();
            // Late write after unmount/close must not touch a closed connection.
            if (!aliveRef.current) return;
            setRecords(next);
            setLoadError(false);
        } catch {
            if (!aliveRef.current) return;
            setRecords([]);
            setLoadError(true);
        }
    }, []);

    useEffect(() => {
        if (injected) {
            setRepo(injected);
            setGate(injectedGate ?? null);
            void refresh(injected);
            return;
        }
        let alive = true;
        createIdbAdapter()
            .then((adapter) => {
                if (!alive) {
                    // Unmounted while opening; release immediately.
                    adapter.close?.();
                    return;
                }
                adapterRef.current = adapter;
                const next = createTrustRepo(adapter);
                setRepo(next);
                void refresh(next);
            })
            .catch(() => {
                if (alive) {
                    setRecords([]);
                    setLoadError(true);
                }
            });
        return () => {
            alive = false;
            adapterRef.current?.close?.();
            adapterRef.current = null;
        };
    }, [injected, injectedGate, refresh]);

    const handleRevoke = async (docId: string) => {
        if (!repo) return;
        setActionError(false);
        try {
            // Use the shared gate when present: it drops the session overlay too,
            // so an Allow handed out in the editor stops applying immediately.
            if (gate) await gate.remove(docId);
            else await repo.remove(docId);
            // A successful revoke must reach the editor's rendered output.
            bumpTrustRevision();
        } catch {
            // A late failure after unmount must not touch a closed connection.
            if (!aliveRef.current) return;
            setActionError(true);
        }
        await refresh(repo);
    };

    const handleReset = async () => {
        if (!repo) return;
        const ok = await confirm({ message: t('settings.trust.resetConfirm'), danger: true });
        if (!ok) return;
        setActionError(false);
        try {
            if (gate) await gate.clear();
            else await repo.clear();
            // A successful reset must reach the editor's rendered output.
            bumpTrustRevision();
        } catch {
            if (!aliveRef.current) return;
            setActionError(true);
        }
        await refresh(repo);
    };

    if (records === null) {
        return <p className="text-sm text-gray-500">{t('settings.trust.loading')}</p>;
    }

    // The session overlay is read fresh each render; a revoke re-renders via the
    // `refresh` setState, so a lifted session Allow disappears immediately.
    const rows = mergeRows(records, gate ? gate.sessionEntries() : []);

    return (
        <div className="space-y-4">
            <p className="text-xs text-gray-500">{t('settings.trust.description')}</p>

            {actionError && (
                <p role="alert" className="text-sm text-red-400">
                    {t('settings.trust.actionError')}
                </p>
            )}

            {loadError ? (
                <p className="text-sm text-red-400">{t('settings.trust.loadError')}</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-gray-500">{t('settings.trust.empty')}</p>
            ) : (
                <div className="divide-y divide-gray-800">
                    {rows.map((row) => (
                        <SettingRow
                            key={row.docId}
                            label={row.docId}
                            description={t(DECISION_LABEL_KEYS[row.decision])}
                        >
                            <div className="flex items-center gap-2">
                                {row.session && (
                                    <span
                                        data-testid="trust-session-badge"
                                        className="rounded border border-amber-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300"
                                    >
                                        {t('settings.trust.session')}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => void handleRevoke(row.docId)}
                                    className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-600"
                                >
                                    {t('settings.trust.revoke')}
                                </button>
                            </div>
                        </SettingRow>
                    ))}
                </div>
            )}

            {rows.length > 0 && (
                <button
                    type="button"
                    onClick={() => void handleReset()}
                    className="rounded bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-500"
                >
                    {t('settings.trust.resetAll')}
                </button>
            )}
        </div>
    );
};
