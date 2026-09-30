/**
 * Promise-based dialog API.
 *
 * Callable from anywhere -- React components, async event handlers and plain
 * modules. It is a module-level store rather than a zustand slice because the
 * pending dialog is transient UI state and must be resolvable from code that
 * has no React context.
 *
 * Exactly one request is pending at a time. A new request cancels the current
 * one first, so a caller's `await` can never hang.
 */

export interface ConfirmOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
    defaultValue?: string;
    placeholder?: string;
}

export interface AlertOptions {
    title?: string;
    message: string;
    confirmLabel?: string;
}

export type PendingDialog =
    | { id: number; kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
    | { id: number; kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
    | { id: number; kind: 'alert'; options: AlertOptions; resolve: () => void };

/** The module-level pending object itself -- a stable reference for useSyncExternalStore. */
let pending: PendingDialog | null = null;

/** Identity for each request, so a displaced dialog can remount with fresh state. */
let nextId = 0;

const listeners = new Set<() => void>();

function notify(): void {
    // Iterate a copy so a listener may unsubscribe during the pass.
    for (const listener of Array.from(listeners)) listener();
}

function request<T>(
    create: (id: number, resolve: (value: T) => void) => PendingDialog
): Promise<T> {
    return new Promise<T>((resolve) => {
        // One at a time: settle the previous request as cancelled first, so its
        // caller is never left waiting.
        if (pending) resolvePending();
        pending = create(++nextId, resolve);
        notify();
    });
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
    return request<boolean>((id, resolve) => ({ id, kind: 'confirm', options, resolve }));
}

export function promptText(options: PromptOptions): Promise<string | null> {
    return request<string | null>((id, resolve) => ({ id, kind: 'prompt', options, resolve }));
}

export function alert(options: AlertOptions): Promise<void> {
    return request<void>((id, resolve) => ({ id, kind: 'alert', options, resolve }));
}

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getPending(): PendingDialog | null {
    return pending;
}

/**
 * The single exit path for every dialog: confirm, cancel, Escape, backdrop and
 * the close button all route through here. A missing value settles as
 * cancelled (`false` / `null` / nothing).
 */
export function resolvePending(value?: unknown): void {
    const current = pending;
    if (!current) return;
    // Clear before resolving: a re-entrant render must not observe the dialog
    // that is already settled.
    pending = null;
    notify();

    switch (current.kind) {
        case 'confirm':
            current.resolve(typeof value === 'boolean' ? value : false);
            break;
        case 'prompt':
            current.resolve(typeof value === 'string' ? value : null);
            break;
        case 'alert':
            current.resolve();
            break;
    }
}
