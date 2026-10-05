import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { trustGateFor } from '../../store/trustGate';
import type { LabelDoc } from '../../core/doc/types';
import type { CsvRecord } from '../../data/csvRepo';
import { docHasTemplateSources, type TrustDecision, type TrustGate } from '../../core/trust';
import { promptTemplateTrust } from '../../editor/trustPrompt';
import { createGlobalsCache, type GlobalWarning, type GlobalsCache } from '../../templates/globals';
import { createJavaScriptTemplateEngine, type JavaScriptTemplateEngine } from '../../templates/jsEngine';
import type { TemplateContext, TemplateEngine, Value } from '../../templates/engine';
import { EMPTY_RESOLVED_CONTENT, prepareResolvedContent } from '../../editor/render/prepareContent';
import type { ResolvedContent } from '../../editor/render/resolve';
import { contentSourceOf } from '../../editor/contentSource';

/**
 * Sample-row resolve pipeline (P6 W6).
 *
 * Turns the open document + the attached CSV + the chosen sample row into the
 * `ResolvedNode[]` the preview and inspector render. Mirrors the print path's
 * pre-pass, but for the editor.
 *
 * ## Trust (fail-closed)
 *
 * A document with **no** template sources is never gated (decision 42). For a
 * template-bearing document:
 *
 * | decision   | execute? | prompt? | `blocked` | `needsApproval` |
 * | ---------- | -------- | ------- | --------- | --------------- |
 * | `always`   | yes      | no      | no        | no              |
 * | `ask`      | **no**   | yes     | no        | yes             |
 * | `never`    | no       | no      | yes       | no              |
 * | gate null  | **no**   | no      | no        | yes             |
 *
 * Templates execute **only** when the effective decision is `always`. An
 * unapproved document (`ask`, or no gate/repo available pre-boot) renders its
 * `fallback` content and surfaces `needsApproval` — it never silently runs.
 * `never` renders fallbacks and surfaces `blocked`. The prompt records a
 * session Allow/Deny; a displaced prompt (`'none'`) leaves the decision at
 * `ask` and re-prompts on the next pass (W4 contract).
 *
 * ## Scheduling
 *
 * The pass is keyed on the fields that actually affect resolution (doc id,
 * sample row, content sources, CSV ref, globals, trust) — NOT the whole
 * transient document — so a drag (which replaces `currentDoc` every tick) does
 * not re-run it. Geometry/visibility are deliberately excluded: `PreviewStage`
 * applies them with a **synchronous** `resolve(doc, { overrides })` on every
 * render, so the preview still repaints live while only the data pre-pass is
 * async. A Settings trust revoke bumps `trustRevision`, which is in the deps,
 * so the pass re-resolves and executed output cannot outlive a revoke. Passes
 * are additionally **single-flighted**: a new pass is queued behind the
 * in-flight one and superseded passes are skipped before they touch the
 * serial-use engine, so two `evaluate` calls never overlap.
 */

export interface SampleRowState {
    /**
     * Per-node evaluated content for the sample row, keyed by node id. The
     * preview feeds this to the synchronous `resolve(doc, { overrides })` on
     * every render, so only the data pre-pass is async while geometry and
     * visibility stay live.
     */
    overrides: ReadonlyMap<string, ResolvedContent>;
    /** The document's effective template-trust decision. `ask` when not gated. */
    trust: TrustDecision;
    /** True when templates are blocked by a `never` decision. */
    blocked: boolean;
    /** True when templates need approval (`ask` / no gate) and did not run. */
    needsApproval: boolean;
    /** Per-spec globals problems, surfaced in the UI. */
    globalWarnings: GlobalWarning[];
    /** Per-node template evaluation errors (node id → message). */
    templateErrors: ReadonlyMap<string, string>;
    /** Rows in the attached CSV, or `0` when none is loaded. */
    rowCount: number;
    /** A pass-level failure message, kept visible until the next success. */
    error: string | null;
}

const EMPTY_TEMPLATE_ERRORS: ReadonlyMap<string, string> = new Map();

const initialState = (): SampleRowState => ({
    overrides: EMPTY_RESOLVED_CONTENT,
    trust: 'ask',
    blocked: false,
    needsApproval: false,
    globalWarnings: [],
    templateErrors: EMPTY_TEMPLATE_ERRORS,
    rowCount: 0,
    error: null,
});

/** Label metadata handed to templates as `ctx.label`. */
const labelContext = (
    doc: LabelDoc,
): { name: string; width: number; height: number; dpi: number; printDirection: string } => ({
    name: doc.meta.name,
    width: doc.label.backingW,
    height: doc.label.backingH,
    dpi: doc.label.dpi,
    printDirection: doc.label.printDirection,
});

/**
 * Serialize only the inputs that change the async override pass output. Used as
 * the effect dependency so a purely geometric/transient doc change
 * (drag/resize/hide/lock/group) does not re-run the data pre-pass. It
 * deliberately excludes node transform/geometry and visibility: those are
 * handled by `PreviewStage`'s synchronous `resolve(doc, { overrides })` on every
 * render, so the preview still repaints immediately. This key only governs when
 * the async override map must be rebuilt.
 */
export const resolveKeyOf = (doc: LabelDoc | null): string => {
    if (!doc) return '';
    const sources = doc.nodes.map((node) => {
        const source = contentSourceOf(node);
        return source === undefined ? `${node.id}:none` : `${node.id}:${JSON.stringify(source)}`;
    });
    return JSON.stringify({
        id: doc.meta.id,
        name: doc.meta.name,
        row: doc.data.sampleRowIndex,
        dpi: doc.label.dpi,
        backingW: doc.label.backingW,
        backingH: doc.label.backingH,
        printDirection: doc.label.printDirection,
        csv: doc.data.csv ?? null,
        globals: doc.data.globals,
        sources,
    });
};

/** Evaluate one template source, recording the failure against every node id
 * that carries the same `code` (two nodes may share one identical source). */
const recordingEngine = (
    engine: TemplateEngine,
    errors: Map<string, string>,
    nodeIdsForCode: ReadonlyMap<string, readonly string[]>,
): TemplateEngine => ({
    async evaluate(code: string, context: TemplateContext): Promise<Value> {
        try {
            return await engine.evaluate(code, context);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            for (const nodeId of nodeIdsForCode.get(code) ?? []) errors.set(nodeId, message);
            throw error;
        }
    },
});

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

/** Map each template source's `code` to **every** node id carrying it, so a
 * failure is recorded against all nodes that share the identical source. */
const templateCodeIndex = (doc: LabelDoc): Map<string, string[]> => {
    const index = new Map<string, string[]>();
    for (const node of doc.nodes) {
        const source = contentSourceOf(node);
        if (source?.kind !== 'template') continue;
        const ids = index.get(source.code);
        if (ids) ids.push(node.id);
        else index.set(source.code, [node.id]);
    }
    return index;
};

export interface ResolvePassInput {
    doc: LabelDoc;
    csv: CsvRecord | null;
    rowIndex: number;
    /** Effective decision; only `always` executes. */
    trust: TrustDecision;
    engine: TemplateEngine | undefined;
}

export interface ResolvePassResult {
    /** Evaluated content per node id; the caller feeds it to the sync `resolve`. */
    overrides: ReadonlyMap<string, ResolvedContent>;
    globalWarnings: GlobalWarning[];
    templateErrors: ReadonlyMap<string, string>;
    rowCount: number;
}

/**
 * Run one resolve pass. Pure of React scheduling; `engine` is only ever passed
 * when trust is `always`, so an unapproved document cannot execute templates.
 */
export const runResolvePass = async (
    input: ResolvePassInput,
    globalsCache: GlobalsCache,
): Promise<ResolvePassResult> => {
    const { doc, csv, rowIndex, trust, engine } = input;
    const executable = engine !== undefined && trust === 'always';
    const activeEngine = executable ? engine : undefined;

    const globalWarnings: GlobalWarning[] = [];
    let globals: Record<string, unknown> = {};
    if (executable && doc.data.globals.length > 0) {
        const result = await globalsCache.prefetch(doc.data.globals);
        globals = { ...result.values };
        globalWarnings.push(...result.warnings);
    }

    const templateErrors = new Map<string, string>();
    const recording = activeEngine
        ? recordingEngine(activeEngine, templateErrors, templateCodeIndex(doc))
        : undefined;

    const overrides = await prepareResolvedContent({
        doc,
        csv,
        rowIndex,
        ...(recording === undefined ? {} : { engine: recording }),
        ctx: { label: labelContext(doc), globals },
    });

    return {
        overrides,
        globalWarnings,
        templateErrors,
        rowCount: csv?.rows.length ?? 0,
    };
};

export const useSampleRow = (): SampleRowState => {
    const doc = useStore((state) => state.currentDoc);
    const csvRepo = useStore((state) => state.csvRepo);
    const trustRepo = useStore((state) => state.trustRepo);
    const storeGate = useStore((state) => state.trustGate);
    const trustRevision = useStore((state) => state.trustRevision);

    const [state, setState] = useState<SampleRowState>(initialState);

    // Latest doc, read at pass time without re-triggering the effect.
    const docRef = useRef<LabelDoc | null>(doc);
    docRef.current = doc;

    // One engine per session: the worker is expensive to spawn and the engine is
    // serial-use, matching one resolve pass at a time.
    const engineRef = useRef<JavaScriptTemplateEngine | null>(null);
    useEffect(
        () => () => {
            engineRef.current?.dispose();
            engineRef.current = null;
        },
        [],
    );

    // One globals cache per document: repeated passes (row changes, node edits)
    // reuse valid entries instead of re-fetching on every keystroke. Cleared when
    // the spec list or the document changes so a removed/edited spec never
    // serves a stale value. Lazy-initialised so the factory runs once per mount,
    // not on every render.
    const [globalsCache] = useState<GlobalsCache>(() => createGlobalsCache());

    const resolveKey = useMemo(() => resolveKeyOf(doc), [doc]);
    const docId = doc?.meta.id ?? null;
    const globalsKey = doc ? JSON.stringify(doc.data.globals) : '';

    // A changed globals list / document invalidates every cached value.
    useEffect(() => {
        globalsCache.clear();
    }, [docId, globalsKey, globalsCache]);

    // Single-flight sequencer: passes run one after another; `latestRunRef` lets
    // a queued but superseded pass bail before it touches the engine.
    const queueRef = useRef<Promise<void>>(Promise.resolve());
    const latestRunRef = useRef(0);
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!doc) {
            setState(initialState());
            return;
        }
        const runId = latestRunRef.current + 1;
        latestRunRef.current = runId;
        const isCurrent = () => mountedRef.current && latestRunRef.current === runId;

        const task = queueRef.current.then(async (): Promise<void> => {
            if (!isCurrent()) return;
            const currentDoc = docRef.current;
            if (!currentDoc) return;
            // Read the template flag from the doc the pass actually resolves (not
            // the render-time `doc`), so a doc switch can never gate/prompt the
            // wrong document.
            const hasTemplates = docHasTemplateSources(currentDoc);
            const gate: TrustGate | null = storeGate ?? trustGateFor(trustRepo);

            let trust: TrustDecision = 'ask';
            if (hasTemplates) {
                trust = gate ? await gate.resolve(currentDoc.meta.id) : 'ask';
                if (trust === 'ask' && gate && isCurrent()) {
                    // Prompt once per open; `promptTemplateTrust` dedupes by id.
                    const choice = await promptTemplateTrust({
                        docId: currentDoc.meta.id,
                        docName: currentDoc.meta.name,
                    });
                    if (choice === 'allow') gate.allowOnce(currentDoc.meta.id);
                    else if (choice === 'deny') gate.denyOnce(currentDoc.meta.id);
                    trust = await gate.resolve(currentDoc.meta.id);
                }
            }
            if (!isCurrent()) return;

            // Fail-closed: only `always` may execute templates.
            const mayExecute = hasTemplates && trust === 'always';
            if (mayExecute && !engineRef.current) engineRef.current = createJavaScriptTemplateEngine();
            const engine = mayExecute ? engineRef.current ?? undefined : undefined;

            const csv = await readCsv(csvRepo, currentDoc.data.csv?.csvId);
            if (!isCurrent()) return;

            try {
                const result = await runResolvePass(
                    { doc: currentDoc, csv, rowIndex: currentDoc.data.sampleRowIndex, trust, engine },
                    globalsCache,
                );
                if (!isCurrent()) return;
                setState({
                    overrides: result.overrides,
                    trust,
                    blocked: hasTemplates && trust === 'never',
                    needsApproval: hasTemplates && trust === 'ask',
                    globalWarnings: result.globalWarnings,
                    templateErrors: result.templateErrors,
                    rowCount: result.rowCount,
                    error: null,
                });
            } catch (caught) {
                if (!isCurrent()) return;
                // Keep the last known overrides/trust/rowCount and surface the
                // error; never blank the preview. The sync resolve in
                // `PreviewStage` already handles the static/`fallback` path.
                setState((previous) => ({
                    ...previous,
                    trust,
                    blocked: hasTemplates && trust === 'never',
                    needsApproval: hasTemplates && trust === 'ask',
                    globalWarnings: [],
                    templateErrors: EMPTY_TEMPLATE_ERRORS,
                    error: caught instanceof Error ? caught.message : String(caught),
                }));
            }
        });

        // Keep the chain alive even if a pass rejects (it handles its own catch,
        // but guard anyway so one failure never wedges the queue).
        queueRef.current = task.catch(() => undefined);

        // No cleanup that cancels mid-pass: supersession is handled by `runId`
        // so the serial-use engine is never abandoned with a live request.
    }, [resolveKey, csvRepo, trustRepo, storeGate, trustRevision, globalsCache]);

    // Reset all state when the document identity changes (undo/open/close).
    useEffect(() => {
        setState(initialState());
        globalsCache.clear();
    }, [docId, globalsCache]);

    return state;
};
