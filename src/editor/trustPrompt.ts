import i18next from 'i18next';
import { confirm, getPending } from '../components/common/dialogs/dialogService';

/**
 * Session prompt for documents that carry template sources.
 *
 * This is the **only** trust prompt. `confirm` is allow/deny-only, so it returns
 * a *session* decision; persisting Always/Never is a separate, explicit action
 * owned by the trust gate (`gate.always` / `gate.never`) and surfaced in the
 * editor's trust control + Settings (decision 32).
 *
 * W6 call shape (never prompt for a plain document):
 *
 * ```ts
 * import { createTrustGate, docHasTemplateSources } from '../core/trust'
 *
 * if (!docHasTemplateSources(doc)) return          // never gated (decision 42)
 * const decision = await gate.resolve(doc.meta.id)
 * if (decision === 'always') { /* run silently *\/ }
 * else if (decision === 'never') { /* blocked *\/ }
 * else {
 *     const choice = await promptTemplateTrust({ docId: doc.meta.id, docName: doc.meta.name })
 *     if (choice === 'allow') gate.allowOnce(doc.meta.id)
 *     else if (choice === 'deny') gate.denyOnce(doc.meta.id)
 *     // 'none' (displaced) → leave as `ask` and re-prompt later
 * }
 * ```
 *
 * StrictMode-idempotent and per-document: concurrent calls for the **same** doc
 * share one in-flight prompt; calls for different docs each get their own
 * decision (a second dialog displaces the first, and the displaced caller gets
 * `'none'`, never the other document's answer).
 *
 * `dialogService` settles a displaced/cancelled confirm as `false`, the same
 * value as the Deny button. Displacement is detectable (a newer request is
 * pending when our promise settles) and degrades to `'none'`; Escape/backdrop/
 * close are not distinguishable from Deny through the shared `confirm` contract
 * and therefore fall back to `'deny'` — the fail-closed choice (never silently
 * allow).
 */

export interface TemplateTrustPromptOptions {
    /** Document id; keys the in-flight dedupe. */
    docId: string;
    /** Document display name, interpolated into the message. */
    docName?: string;
}

export type TemplateTrustSessionDecision = 'allow' | 'deny' | 'none';

const inFlight = new Map<string, Promise<TemplateTrustSessionDecision>>();

const run = async ({
    docName,
}: TemplateTrustPromptOptions): Promise<TemplateTrustSessionDecision> => {
    const name = docName?.trim();
    const message = name
        ? i18next.t('trust.prompt.message', { name })
        : i18next.t('trust.prompt.messageNoName');

    const settled = confirm({
        title: i18next.t('trust.prompt.title'),
        message,
        confirmLabel: i18next.t('trust.prompt.allow'),
        cancelLabel: i18next.t('trust.prompt.deny'),
    });
    // `confirm` installs the pending request synchronously, so this is our id.
    const requestId = getPending()?.id ?? null;

    const allowed = await settled;
    if (allowed) return 'allow';

    // `false` is ambiguous. If a *different* request is still pending, ours was
    // displaced by another prompt — report "no decision" so the caller treats
    // the document as `ask` instead of recording a deny the user never chose.
    const current = getPending();
    if (current && current.id !== requestId) return 'none';
    return 'deny';
};

export const promptTemplateTrust = (
    options: TemplateTrustPromptOptions,
): Promise<TemplateTrustSessionDecision> => {
    const { docId } = options;
    const existing = inFlight.get(docId);
    if (existing) return existing;

    const promise = run(options).finally(() => {
        // Only clear our own entry; a newer prompt for the same id may have
        // replaced it while we were settling.
        if (inFlight.get(docId) === promise) inFlight.delete(docId);
    });
    inFlight.set(docId, promise);
    return promise;
};

/** Test-only reset of the module-level dedupe map. */
export const resetTrustPromptForTests = (): void => {
    inFlight.clear();
};
