import i18next from 'i18next';
import { promptChoice } from '../components/common/dialogs/dialogService';

/**
 * Session prompt for documents that carry template sources.
 *
 * This is the **only** trust prompt, and it offers four choices:
 *
 * - `allowOnce` / `denyOnce` -- session-only overlay (until reload).
 * - `always` / `never` -- persisted by the trust gate (`gate.always` /
 *   `gate.never`); `never` is an absolute block until changed in Settings.
 *
 * The caller applies the choice to the gate and re-resolves:
 *
 * ```ts
 * import { createTrustGate, docHasTemplateSources } from '../core/trust'
 *
 * if (!docHasTemplateSources(doc)) return          // never gated (decision 42)
 * let decision = await gate.resolve(doc.meta.id)
 * if (decision === 'ask') {
 *     const choice = await promptTemplateTrust({ docId: doc.meta.id, docName: doc.meta.name })
 *     switch (choice) {
 *         case 'allowOnce': gate.allowOnce(doc.meta.id); break
 *         case 'always':    await gate.always(doc.meta.id).catch(() => gate.allowOnce(doc.meta.id)); break
 *         case 'denyOnce':  gate.denyOnce(doc.meta.id); break
 *         case 'never':     await gate.never(doc.meta.id).catch(() => gate.denyOnce(doc.meta.id)); break
 *         case 'none': default: break              // displaced: no write
 *     }
 *     decision = await gate.resolve(doc.meta.id)
 * }
 * ```
 *
 * StrictMode-idempotent and per-document: concurrent calls for the **same** doc
 * share one in-flight prompt; calls for different docs each get their own
 * decision (a second dialog displaces the first, and the displaced caller gets
 * `'none'`, never the other document's answer).
 *
 * The dialog service distinguishes displacement from dismissal: a *displaced*
 * request resolves `null` (→ `'none'`; the doc stays `ask` and re-prompts later),
 * while an explicit dismissal (Escape/backdrop/close) resolves the prompt's
 * `cancelValue`, which is `'denyOnce'` -- the fail-closed session choice.
 */

export interface TemplateTrustPromptOptions {
    /** Document id; keys the in-flight dedupe. */
    docId: string;
    /** Document display name, interpolated into the message. */
    docName?: string;
}

/** A user's answer to the four-choice trust prompt (or `none` if displaced). */
export type TemplateTrustDecision = 'allowOnce' | 'always' | 'denyOnce' | 'never' | 'none';

const inFlight = new Map<string, Promise<TemplateTrustDecision>>();

const run = async ({
    docName,
}: TemplateTrustPromptOptions): Promise<TemplateTrustDecision> => {
    const name = docName?.trim();
    const message = name
        ? i18next.t('trust.prompt.message', { name })
        : i18next.t('trust.prompt.messageNoName');

    const choice = await promptChoice({
        title: i18next.t('trust.prompt.title'),
        message,
        actions: [
            { value: 'allowOnce', label: i18next.t('trust.prompt.allowOnce') },
            { value: 'always', label: i18next.t('trust.prompt.always'), variant: 'primary' },
            { value: 'denyOnce', label: i18next.t('trust.prompt.denyOnce') },
            { value: 'never', label: i18next.t('trust.prompt.never'), variant: 'danger' },
        ],
        cancelValue: 'denyOnce',
    });

    switch (choice) {
        case 'allowOnce':
        case 'always':
        case 'denyOnce':
        case 'never':
            return choice;
        default:
            // `null` -- the prompt was displaced by another request. Report "no
            // decision" so the caller leaves the document at `ask`.
            return 'none';
    }
};

export const promptTemplateTrust = (
    options: TemplateTrustPromptOptions,
): Promise<TemplateTrustDecision> => {
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
