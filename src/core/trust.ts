import type { TrustRepo } from '../data/trustRepo';
import type { LabelDoc } from './doc/types';

/**
 * Trust gate — the pure policy layer over a persisted trust repo.
 *
 * Trust is LOCAL state, never document data (invariant 11, decision 32). The
 * gate is headless and injectable: it takes a `TrustRepo` (structural, so tests
 * can use an in-memory stub) and never touches IDB, React, Konva or the DOM.
 *
 * Policy truth table (`resolve`):
 *
 * | persisted  | session (Allow/Deny once) | result   | why                                                    |
 * | ---------- | ------------------------- | -------- | ------------------------------------------------------ |
 * | `never`    | any                       | `never`  | `never` blocks everywhere until changed in settings     |
 * | `always`   | absent                    | `always` | persisted Always runs silently                          |
 * | `always`   | `never` (session Deny)    | `never`  | a session Deny overrides a persisted Always             |
 * | `ask`      | `always` (session Allow)  | `always` | session Allow lasts until reload                        |
 * | `ask`      | `never` (session Deny)    | `never`  | session Deny lasts until reload                         |
 * | `ask`      | absent                    | `ask`    | absent/`ask` ⇒ caller prompts on open                   |
 *
 * `always`/`never` **persist only** — they do not write the session overlay; they
 * do clear any stale entry for that id so a newer explicit decision supersedes a
 * prompt-scoped Allow/Deny. The overlay is written solely by the prompt's
 * `allowOnce`/`denyOnce`, so a Settings revoke (`repo.remove`) takes effect
 * immediately in the same session. `never` is checked before the overlay so a
 * session Allow can never re-enable a document the user explicitly blocked.
 */

export type TrustDecision = 'ask' | 'always' | 'never';

const TRUST_DECISIONS: readonly TrustDecision[] = ['ask', 'always', 'never'];

export const isTrustDecision = (value: unknown): value is TrustDecision =>
    TRUST_DECISIONS.includes(value as TrustDecision);

/** Normalize a stored value; anything unrecognized (including absent) is `'ask'`. */
export const normalizeTrustDecision = (value: unknown): TrustDecision =>
    isTrustDecision(value) ? value : 'ask';

/** The session overlay stores the same decision values as the repo. */
export type TrustSession = Map<string, TrustDecision>;

export interface TrustGate {
    /** Persisted ∪ session prompt overlay, with `never` as an absolute block. */
    resolve(docId: string): Promise<TrustDecision>;
    /** Session-only allow; does not persist and never overrides a persisted `never`. */
    allowOnce(docId: string): void;
    /** Session-only deny; does not persist. */
    denyOnce(docId: string): void;
    /** Persist `always` only (no session overlay write). */
    always(docId: string): Promise<void>;
    /** Persist `never` only (no session overlay write). */
    never(docId: string): Promise<void>;
    /** Re-enable: drop the persistent record and any session entry (→ `ask`). */
    remove(docId: string): Promise<void>;
    /** Reset every stored decision and the session overlay. */
    clear(): Promise<void>;
    /** Drop the whole session overlay without touching persisted decisions. */
    clearSession(): void;
    /**
     * Snapshot of the session-only overlay (prompt Allow/Deny), so Settings can
     * list and lift a decision that was never persisted. Returns a fresh array of
     * plain records — the live map is never exposed and later overlay changes do
     * not mutate the result.
     */
    sessionEntries(): { docId: string; decision: TrustDecision }[];
}

export interface CreateTrustGateOptions {
    repo: TrustRepo;
    /** Injectable for tests; defaults to a fresh in-memory map. */
    session?: TrustSession;
}

export const createTrustGate = ({ repo, session }: CreateTrustGateOptions): TrustGate => {
    const overlay: TrustSession = session ?? new Map();

    const gate: TrustGate = {
        async resolve(docId) {
            const persistent = normalizeTrustDecision(await repo.get(docId));
            // Absolute block: settings-only re-enable, never a session Allow.
            if (persistent === 'never') return 'never';
            const sessionDecision = overlay.get(docId);
            if (sessionDecision) return sessionDecision;
            return persistent;
        },

        allowOnce(docId) {
            overlay.set(docId, 'always');
        },

        denyOnce(docId) {
            overlay.set(docId, 'never');
        },

        async always(docId) {
            // Persist only: a Settings revoke must lift this immediately. Drop
            // any stale session entry so a fresh explicit decision supersedes a
            // prompt-scoped Allow/Deny instead of being shadowed by it.
            await repo.set(docId, 'always');
            overlay.delete(docId);
        },

        async never(docId) {
            await repo.set(docId, 'never');
            overlay.delete(docId);
        },

        async remove(docId) {
            await repo.remove(docId);
            overlay.delete(docId);
        },

        async clear() {
            await repo.clear();
            overlay.clear();
        },

        clearSession() {
            overlay.clear();
        },

        sessionEntries() {
            return [...overlay].map(([docId, decision]) => ({ docId, decision }));
        },
    };

    return gate;
};

/** A node whose `text`/`data` source is unreadable is treated as executable. */
const isTemplateSource = (value: unknown): boolean =>
    !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'template';

/** `kind` of a source that may be missing/malformed on an imported document. */
const sourceKind = (value: unknown): unknown =>
    value && typeof value === 'object' ? (value as { kind?: unknown }).kind : undefined;

/**
 * Whether a document carries any executable template source. A plain CSV /
 * static document is never gated (decision 42): callers must not prompt when
 * this returns `false`.
 *
 * Text nodes hold their source in `text`; QR/barcode nodes hold theirs in
 * `data`. Only those three node kinds carry a `ContentSource`. Everything is
 * defended against a malformed/unvalidated imported document: a carrier node
 * whose source is missing or unrecognized is treated as executable (fail
 * closed) so the trust gate can never be bypassed by a corrupt shape.
 */
export const docHasTemplateSources = (doc: LabelDoc): boolean => {
    const nodes = (doc as { nodes?: unknown } | null | undefined)?.nodes;
    if (!Array.isArray(nodes)) return false;
    return nodes.some((node) => {
        const type = (node as { type?: unknown } | null | undefined)?.type;
        if (type === 'text') {
            if (isTemplateSource((node as { text?: unknown }).text)) return true;
            const kind = sourceKind((node as { text?: unknown }).text);
            // static/csv are safe; anything else (missing, null, unknown) could
            // be executable, so gate it.
            return kind !== 'static' && kind !== 'csv';
        }
        if (type === 'qr' || type === 'barcode' || type === 'code') {
            if (isTemplateSource((node as { data?: unknown }).data)) return true;
            const kind = sourceKind((node as { data?: unknown }).data);
            return kind !== 'static' && kind !== 'csv';
        }
        return false;
    });
};
