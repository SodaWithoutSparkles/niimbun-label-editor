import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { trustGateFor } from '../../store/trustGate';
import type { LabelDoc } from '../../core/doc/types';
import type { CsvRecord } from '../../data/csvRepo';
import {
    docHasTemplateSources,
    type TrustDecision,
    type TrustGate,
} from '../../core/trust';
import { promptTemplateTrust } from '../../editor/trustPrompt';
import { createGlobalsCache, type GlobalsCache } from '../../templates/globals';
import {
    createJavaScriptTemplateEngine,
    type JavaScriptTemplateEngine,
} from '../../templates/jsEngine';
import type { TemplateEngine } from '../../templates/engine';
import { runResolvePass } from '../editor/useSampleRow';
import { createResourceAssetDeps } from '../editor/usePreparedAssets';
import type { AssetDeps, ResolveContext } from '../../editor/render';

/**
 * Print dialog's per-row content deps (P7 W5).
 *
 * Supplies the three values `PrintDialog` consumes — the attached CSV table, the
 * trust-aware `prepareRow` content-prep callback and the repo-backed
 * {@link AssetDeps}. This is the non-React equivalent of `useSampleRow`'s pass,
 * moved behind a callback so `src/print/*` never imports the template engine or
 * the trust gate (decision 42).
 *
 * ## Trust (fail-closed, decision 42)
 *
 * A document with **no** template sources is never gated: `prepareRow` never
 * touches the gate and never builds an engine. A template-bearing document
 * resolves the shared gate and, when the decision is `ask`, prompts once per
 * dialog session (`promptTemplateTrust`). Templates execute only when the
 * effective decision is `always`; `ask`/`never` pass no engine, so
 * {@link runResolvePass} renders the per-source `fallback` content.
 *
 * ## Lifecycle
 *
 * `open` scopes the session resources: while closed the hook is **inert** —
 * `prepareRow` resolves `{}` without touching the gate, the engine or the
 * globals cache — and on close/unmount it drops the `GlobalsCache` (one per
 * dialog session) and the serial-use template engine, so a closed dialog holds
 * no worker. A session token also cancels work queued before the close, so a
 * late thumbnail/job pass cannot resurrect the engine or re-prompt.
 *
 * ## Serial-use engine
 *
 * The thumbnail cache renders up to two rows at once and the print job shares
 * the same engine, so every `prepareRow` is funneled through one promise chain:
 * two passes never call `evaluate` concurrently. Each caller still awaits its
 * own row (no supersession, unlike `useSampleRow`).
 *
 * The CSV read is memoised per (doc, open) — a rerender never re-reads IDB —
 * and a failed read degrades to `null` (the dialog then prints
 * static/fallback content).
 */

/** The subset of `PrintDialog`'s props this hook supplies. */
export interface PrintJobDeps {
    csv: CsvRecord | null;
    prepareRow: (rowIndex: number) => Promise<ResolveContext>;
    assets: AssetDeps;
}

export interface UsePrintJobOptions {
    /** True while the print dialog is open; scopes the engine + globals cache. */
    open: boolean;
}

/** Read the attached CSV table, or `null` when none / the read fails. */
const readCsv = async (
    repo: { get(id: string): Promise<CsvRecord | null> } | null,
    csvId: string | undefined,
): Promise<CsvRecord | null> => {
    if (!repo || csvId === undefined) return null;
    try {
        return await repo.get(csvId);
    } catch {
        return null;
    }
};

export const usePrintJob = ({ open }: UsePrintJobOptions): PrintJobDeps => {
    const doc = useStore((state) => state.currentDoc);
    const csvRepo = useStore((state) => state.csvRepo);
    const trustRepo = useStore((state) => state.trustRepo);
    const storeGate = useStore((state) => state.trustGate);
    const trustRevision = useStore((state) => state.trustRevision);
    const resourceRepo = useStore((state) => state.resourceRepo);

    // Repo-backed bytes/fonts, identical to the preview and dev harness seam.
    const assets = useMemo(() => createResourceAssetDeps(resourceRepo), [resourceRepo]);

    // Latest doc/trust inputs, read at call time so `prepareRow` stays stable
    // (a changing identity would rebuild the dialog's thumbnail cache per render).
    const docRef = useRef<LabelDoc | null>(doc);
    docRef.current = doc;
    const trustRepoRef = useRef(trustRepo);
    trustRepoRef.current = trustRepo;
    const storeGateRef = useRef(storeGate);
    storeGateRef.current = storeGate;

    // One engine + one globals cache per open dialog session.
    const engineRef = useRef<JavaScriptTemplateEngine | null>(null);
    const globalsCacheRef = useRef<GlobalsCache | null>(null);
    // Session-scoped trust decision, so a 100-page job resolves (and at most
    // prompts) once per document instead of once per page.
    const trustRef = useRef<{ docId: string; trust: TrustDecision } | null>(null);

    // Latest `open`, read at call time so `prepareRow` stays identity-stable.
    const openRef = useRef(open);
    openRef.current = open;
    // Session token, bumped by `disposeSession`: queued work captured before a
    // close can never run after it and resurrect the engine/cache/prompt.
    const sessionRef = useRef(0);

    const disposeSession = useCallback((): void => {
        sessionRef.current += 1;
        engineRef.current?.dispose();
        engineRef.current = null;
        globalsCacheRef.current?.clear();
        globalsCacheRef.current = null;
        trustRef.current = null;
    }, []);

    // A closed dialog holds no engine/cache; an unmount disposes them too.
    useEffect(() => {
        if (!open) disposeSession();
    }, [open, disposeSession]);
    useEffect(() => () => disposeSession(), [disposeSession]);

    // A Settings revoke/reset must not leave a cached `always` behind.
    useEffect(() => {
        trustRef.current = null;
    }, [trustRevision]);

    const csvId = doc?.data.csv?.csvId;
    const [csv, setCsv] = useState<CsvRecord | null>(null);

    useEffect(() => {
        if (!open) {
            setCsv(null);
            return;
        }
        let cancelled = false;
        void readCsv(csvRepo, csvId).then((record) => {
            if (!cancelled) setCsv(record);
        });
        return () => {
            cancelled = true;
        };
    }, [open, csvId, csvRepo]);

    const csvRef = useRef(csv);
    csvRef.current = csv;

    const runPrepare = useCallback(async (rowIndex: number): Promise<ResolveContext> => {
        const currentDoc = docRef.current;
        if (!currentDoc) return {};

        // Decision 42: a plain document never touches the gate or the engine.
        const hasTemplates = docHasTemplateSources(currentDoc);

        let trust: TrustDecision = 'ask';
        if (hasTemplates) {
            const cached = trustRef.current;
            if (cached && cached.docId === currentDoc.meta.id) {
                trust = cached.trust;
            } else {
                const gate: TrustGate | null =
                    storeGateRef.current ?? trustGateFor(trustRepoRef.current);
                trust = gate ? await gate.resolve(currentDoc.meta.id) : 'ask';
                if (trust === 'ask' && gate) {
                    const choice = await promptTemplateTrust({
                        docId: currentDoc.meta.id,
                        docName: currentDoc.meta.name,
                    });
                    if (choice === 'allow') gate.allowOnce(currentDoc.meta.id);
                    else if (choice === 'deny') gate.denyOnce(currentDoc.meta.id);
                    trust = await gate.resolve(currentDoc.meta.id);
                }
                trustRef.current = { docId: currentDoc.meta.id, trust };
            }
        }

        // Fail-closed: only `always` may execute templates.
        const mayExecute = hasTemplates && trust === 'always';
        if (mayExecute && !engineRef.current) engineRef.current = createJavaScriptTemplateEngine();
        const engine: TemplateEngine | undefined = mayExecute
            ? engineRef.current ?? undefined
            : undefined;

        if (!globalsCacheRef.current) globalsCacheRef.current = createGlobalsCache();

        const result = await runResolvePass(
            { doc: currentDoc, csv: csvRef.current, rowIndex, trust, engine },
            globalsCacheRef.current,
        );
        return { overrides: result.overrides };
    }, []);

    // Single-flight queue shared by thumbnails + the print job (serial-use engine).
    const queueRef = useRef<Promise<unknown>>(Promise.resolve());

    const prepareRow = useCallback((rowIndex: number): Promise<ResolveContext> => {
        // A closed dialog is inert: no gate, no engine, no content.
        if (!openRef.current) return Promise.resolve({});
        const session = sessionRef.current;
        // The template engine (and the globals cache) are serial-use, but the
        // thumbnail cache renders up to two rows at once and the print job shares
        // the same engine. Funnel every pass through one promise chain so two
        // `evaluate` calls never overlap. Unlike `useSampleRow`'s single-flight,
        // a queued pass is NOT superseded: each caller awaits its own row.
        const task = queueRef.current.then((): Promise<ResolveContext> | ResolveContext => {
            if (!openRef.current || session !== sessionRef.current) return {};
            return runPrepare(rowIndex);
        });
        // Keep the chain alive even if a pass rejects.
        queueRef.current = task.catch(() => undefined);
        return task;
    }, [runPrepare]);

    return { csv, prepareRow, assets };
};
