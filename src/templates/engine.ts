/**
 * Template engine contract and the shapes that cross the worker boundary.
 *
 * Threat model (owner decision 3): templates are **trusted user code** — the
 * Office-macro boundary. The worker is a correctness/isolation seam (no DOM/app
 * refs, a hard timeout), not a hostile sandbox. Do not harden this beyond
 * removing the obvious browser egress points.
 *
 * `src/templates/` is the browser edge; `src/core/` stays React/Konva/DOM-free.
 */

/** Whatever a template returns. The host decides how to coerce it. */
export type Value = unknown;

/**
 * Failure classes a template can produce.
 *
 * - `timeout`  — execution exceeded the budget (host-side).
 * - `syntax`   — the source failed to compile.
 * - `runtime`  — the compiled source threw while running.
 * - `context`  — the host-side context could not be serialized to the worker.
 * - `worker`   — the worker itself failed (creation, crash, protocol, reset).
 */
export type TemplateErrorKind = 'timeout' | 'syntax' | 'runtime' | 'context' | 'worker';

/** A classified template failure. `kind` is what the UI badges on. */
export class TemplateError extends Error {
    readonly kind: TemplateErrorKind;

    constructor(kind: TemplateErrorKind, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'TemplateError';
        this.kind = kind;
    }
}

/**
 * Label metadata handed to templates as `ctx.label`. Loose on purpose: the
 * binding/resolution pre-pass (W2) owns the concrete projection of the document
 * `label` fields. Typed hints are provided for the fields templates are most
 * likely to read.
 */
export interface TemplateLabel {
    name?: string;
    width?: number;
    height?: number;
    dpi?: number;
    printDirection?: string;
    [key: string]: unknown;
}

/**
 * Formatting helpers/data exposed as `ctx.fmt`. Kept loose — W2/W5 own the
 * concrete contents. Everything in the context crosses the worker boundary via
 * `postMessage`, so it must be structured-cloneable: expose formatting
 * *settings* (locale, currency, patterns), not callables. Functions cannot be
 * cloned, and helper callables belong in the worker module, not in `ctx`.
 */
export type TemplateFormat = Record<string, unknown>;

/**
 * Host-supplied per-document seeds. `docSeed` is **stable per document** —
 * `= doc.meta.id` — so a template can derive repeatable pseudo-random values
 * (task ids, asset tags) for the same document + data across passes and saves.
 * It carries no persisted state of its own: it is always derived from
 * `meta.id`, which is required, unique, and survives round-trip.
 */
export interface TemplateSeeds {
    docSeed: string;
}

/**
 * Per-evaluation context. `now` is epoch **milliseconds** at resolve time and is
 * supplied by the host — the worker never reads the clock. It is a
 * template-resolution detail only and is never stored; document `meta`
 * timestamps stay epoch seconds, and the two clocks are independent by design.
 */
export interface TemplateContext {
    /** Zero-based row index within the job. */
    index: number;
    /** Total rows in the job. */
    total: number;
    /** The current CSV row keyed by column name. */
    row: Record<string, string>;
    /** Number of rows in the job (`total` alias kept for template ergonomics). */
    rowCount: number;
    /** Epoch ms at resolve time, supplied by the host. Never stored. */
    now: number;
    label: TemplateLabel;
    globals: Record<string, unknown>;
    fmt?: TemplateFormat;
    /** Stable per-document seed (`docSeed = doc.meta.id`). */
    seeds: TemplateSeeds;
}

/**
 * Host input for {@link createTemplateContext}. `now` is **required**: the host
 * reads the clock at resolve time and passes it in — this module never calls
 * `Date.now()`.
 */
export interface TemplateContextInput {
    index: number;
    total: number;
    row: Record<string, string>;
    /** Defaults to `total`. */
    rowCount?: number;
    /** Epoch ms at resolve time. Required — the host owns the clock. */
    now: number;
    label?: TemplateLabel;
    globals?: Record<string, unknown>;
    fmt?: TemplateFormat;
    /** Defaults to `{ docSeed: '' }`. */
    seeds?: TemplateSeeds;
}

/**
 * Build a well-formed {@link TemplateContext}. Exists so `ctx.now` is always
 * populated by the host (decision 24) rather than left to each call site, and so
 * the loose optional fields (`label`, `globals`, `fmt`) get the documented
 * defaults.
 */
export const createTemplateContext = (input: TemplateContextInput): TemplateContext => ({
    index: input.index,
    total: input.total,
    row: input.row,
    rowCount: input.rowCount ?? input.total,
    now: input.now,
    label: input.label ?? {},
    globals: input.globals ?? {},
    seeds: input.seeds ?? { docSeed: '' },
    ...(input.fmt === undefined ? {} : { fmt: input.fmt }),
});

/** The seam the editor calls once per row. Implemented by `jsEngine`. */
export interface TemplateEngine {
    evaluate(source: string, context: TemplateContext): Promise<Value>;
}

/**
 * Authoring convention (worked out from the source, not a full function).
 * `source` is JavaScript statement(s) forming the body of a function:
 *
 *     // source passed to evaluate()
 *     return `${ctx.row.name} — ${ctx.label.name}`
 *
 * The worker compiles it as the body of a function over `ctx` and awaits the
 * returned value. A source with no `return` resolves to `undefined`.
 *
 * The body runs in **strict mode** (`"use strict"` is a directive prologue of
 * the compiled function), so `with` is a syntax error and assignment to an
 * undeclared name throws a `ReferenceError` instead of creating a global. See
 * `worker.ts`.
 */

/** Request posted host -> worker. */
export interface TemplateWorkerRequest {
    id: number;
    code: string;
    ctx: TemplateContext;
}

/** Error payload posted worker -> host. */
export interface TemplateWorkerError {
    kind: TemplateErrorKind;
    message: string;
}

/** Reply posted worker -> host. `value` is present only when `ok`. */
export interface TemplateWorkerResponse {
    id: number;
    ok: boolean;
    value?: unknown;
    error?: TemplateWorkerError;
}

/**
 * Readiness handshake posted worker -> host once the message listener is
 * installed. The host waits for it (bounded) before starting the 250 ms
 * execution timer, so worker startup is not charged against the template.
 */
export interface TemplateWorkerReady {
    type: 'ready';
}

/** Any message the worker may post. */
export type TemplateWorkerOutbound = TemplateWorkerReady | TemplateWorkerResponse;
