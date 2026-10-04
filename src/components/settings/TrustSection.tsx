import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createIdbAdapter, type StorageAdapter } from '../../data/db';
import {
    createTrustRepo,
    type TrustDecision,
    type TrustRecord,
    type TrustRepo,
} from '../../data/trustRepo';
import { confirm } from '../common/dialogs';
import { SettingRow } from '../common/forms';

interface TrustSectionProps {
    /** Injectable for tests; otherwise a repo is opened lazily on the IDB adapter. */
    repo?: TrustRepo;
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

/**
 * Settings → Template trust. Lists the stored trust decisions (documents with a
 * persisted `always`/`never`), with per-row Revoke and Reset-all. Trust is local
 * state (invariant 11); revoking drops the record so the document returns to the
 * `ask` default and will prompt on next open.
 *
 * When no `repo` is injected, the section opens its own IDB adapter and closes
 * it on unmount — a leaked extra connection can block a future schema upgrade.
 */
export const TrustSection: React.FC<TrustSectionProps> = ({ repo: injected }) => {
    const { t } = useTranslation();
    const adapterRef = useRef<StorageAdapter | null>(null);
    const aliveRef = useRef(true);
    const [repo, setRepo] = useState<TrustRepo | null>(injected ?? null);
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
    }, [injected, refresh]);
    const handleRevoke = async (docId: string) => {
        if (!repo) return;
        setActionError(false);
        try {
            await repo.remove(docId);
        } catch {
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
            await repo.clear();
        } catch {
            setActionError(true);
        }
        await refresh(repo);
    };

    if (records === null) {
        return <p className="text-sm text-gray-500">{t('settings.trust.loading')}</p>;
    }

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
            ) : records.length === 0 ? (
                <p className="text-sm text-gray-500">{t('settings.trust.empty')}</p>
            ) : (
                <div className="divide-y divide-gray-800">
                    {records.map((record) => (
                        <SettingRow
                            key={record.docId}
                            label={record.docId}
                            description={t(DECISION_LABEL_KEYS[record.decision])}
                        >
                            <button
                                type="button"
                                onClick={() => void handleRevoke(record.docId)}
                                className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-200 transition-colors hover:bg-gray-600"
                            >
                                {t('settings.trust.revoke')}
                            </button>
                        </SettingRow>
                    ))}
                </div>
            )}

            {records.length > 0 && (
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
