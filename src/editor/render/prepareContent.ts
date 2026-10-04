import type { ContentSource, LabelDoc, Node } from '../../core/doc/types';
import { buildRowContext } from '../../core/doc/rowContext';
import type { CsvRecord } from '../../data/csvRepo';
import type { TemplateEngine, TemplateFormat, TemplateLabel } from '../../templates/engine';
import { DEFAULT_EMPTY_TEXT, type ResolvedContent } from './resolve';

/**
 * Async binding/execution pre-pass of the render path (P6 W2).
 *
 * `resolve` stays synchronous and DOM-free; this module evaluates `csv` and
 * `template` {@link ContentSource}s for one row and returns an **override map**
 * keyed by node id. `resolve` consumes that map and falls back to today's
 * static/`fallback` path for every node not present. It mirrors P5's
 * `prepareResolvedAssets`: an async pre-pass injects data the sync resolver
 * cannot compute.
 *
 * Contract:
 * - `csv` binds by **column name** via `CsvRecord.columns`. An absent CSV, an
 *   absent column, an absent row, or an empty cell degrades to the source
 *   `fallback` (an empty fallback becomes the `{empty}` placeholder).
 * - `template` runs **only** through an injected {@link TemplateEngine}; this
 *   module never fetches. A rejected evaluation, `undefined`, or an empty
 *   string degrades to the source `fallback`. With no engine, a template source
 *   degrades too.
 * - `static` sources are **left out** of the map; `resolve` handles them.
 * - Every non-primitive template value (object/array/symbol) degrades to the
 *   fallback rather than stringifying to `"[object Object]"`.
 * - Never throws: a per-node failure degrades to the fallback. Never mutates the
 *   document (invariant 2).
 */

/** Final content per node id: the text and whether it is the placeholder. */
export type ResolvedContentMap = Map<string, ResolvedContent>;

/**
 * Shared empty map with a stable identity, for callers (e.g. React memo
 * comparisons) that need "no overrides". Never mutate it.
 */
export const EMPTY_RESOLVED_CONTENT: ReadonlyMap<string, ResolvedContent> = new Map();

/** Host-supplied, non-row context pieces forwarded to the engine as `ctx`. */
export interface PrepareContentContext {
    /** Label metadata for templates. */
    label?: TemplateLabel;
    /** Prefetched globals keyed by `GlobalSpec.name`. */
    globals?: Record<string, unknown>;
    /** Formatting settings. */
    fmt?: TemplateFormat;
}

export interface PrepareContentInput {
    /** Document whose `nodes[].text`/`data` sources are evaluated. */
    doc: LabelDoc;
    /** Parsed CSV table, or `null` when the document has no CSV attached. */
    csv: CsvRecord | null;
    /** Zero-based row to bind. Out of range → empty row → fallbacks. */
    rowIndex: number;
    /** Injected template executor (W3). Absent → template sources degrade. */
    engine?: TemplateEngine;
    /** Static context pieces (label/globals/fmt); `now` is read internally. */
    ctx?: PrepareContentContext;
}

/** The `ContentSource` carried by a leaf, if the node has one. */
const contentSourceOf = (node: Node): ContentSource | undefined => {
    switch (node.type) {
        case 'text':
            return node.text;
        case 'qr':
        case 'barcode':
            return node.data;
        default:
            return undefined;
    }
};

/**
 * Coerce a template result to a non-empty string, or `undefined` when it must
 * degrade to the fallback. Primitive numbers/booleans/bigints stringify;
 * objects, arrays, functions, symbols, `null`, `undefined`, and `''` degrade.
 */
const coerceText = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value.length > 0 ? value : undefined;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value);
    }
    return undefined;
};

/** Pick the raw value if non-empty, else the fallback; empty → placeholder. */
const finalize = (raw: string | undefined, fallback: string): ResolvedContent => {
    const value = raw !== undefined && raw.length > 0 ? raw : fallback;
    if (value.length === 0) return { text: DEFAULT_EMPTY_TEXT, placeholder: true };
    return { text: value, placeholder: false };
};

/** Cell at `rowIndex` for the named column, or `undefined` when unbindable. */
const csvCell = (csv: CsvRecord | null, column: string, rowIndex: number): string | undefined => {
    if (csv === null) return undefined;
    const columnIndex = csv.columns.indexOf(column);
    if (columnIndex < 0) return undefined;
    const row = csv.rows[rowIndex];
    if (row === undefined) return undefined;
    return row[columnIndex];
};

/**
 * Evaluate every csv/template source in `doc.nodes` for `rowIndex` (decision 24:
 * the clock is read **once per call**, and one row context is shared by all
 * nodes). Returns an override map for `resolve`; static sources are omitted.
 */
export const prepareResolvedContent = async (input: PrepareContentInput): Promise<ResolvedContentMap> => {
    const { doc, csv, rowIndex, engine, ctx } = input;
    const overrides: ResolvedContentMap = new Map();

    // Decision 24: the host reads the clock at resolve time, once per pass.
    const now = Date.now();
    const rowCtx = buildRowContext({
        columns: csv?.columns ?? [],
        rows: csv?.rows ?? [],
        index: rowIndex,
        ...(ctx?.label === undefined ? {} : { label: ctx.label }),
        ...(ctx?.globals === undefined ? {} : { globals: ctx.globals }),
        ...(ctx?.fmt === undefined ? {} : { fmt: ctx.fmt }),
        now,
    });

    for (const node of doc.nodes) {
        const source = contentSourceOf(node);
        if (source === undefined || source.kind === 'static') continue;

        let resolved: ResolvedContent;
        try {
            if (source.kind === 'csv') {
                resolved = finalize(csvCell(csv, source.column, rowIndex), source.fallback);
            } else {
                const raw =
                    engine === undefined
                        ? undefined
                        : coerceText(await engine.evaluate(source.code, rowCtx));
                resolved = finalize(raw, source.fallback);
            }
        } catch {
            // A hostile/rejecting engine must never break the render.
            resolved = finalize(undefined, source.fallback);
        }
        overrides.set(node.id, resolved);
    }

    return overrides;
};
