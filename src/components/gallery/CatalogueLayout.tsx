import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Input } from '../common/forms';

/**
 * Presentational shell shared by the gallery catalogue sections (phase 9, W1).
 *
 * Extracted from `PaperTypeSection` (phase 8) so CSV and media read the same:
 * a title bar with an add button, a search `Input`, a state body
 * (loading/error/empty/search-empty/card grid) and a dialog slot.
 *
 * All copy arrives pre-resolved (`t()` at the call site) and the data lives in
 * the caller — this component only lays it out.
 */

/** Which body state to render. `ready` shows the card grid (`children`). */
export type CatalogueStatus =
    | { kind: 'loading'; message: string }
    | { kind: 'error'; message: string }
    | { kind: 'empty'; message: string }
    | { kind: 'searchEmpty'; message: string }
    | { kind: 'ready' };

export interface CatalogueLayoutProps {
    title: string;
    addLabel: string;
    onAdd: () => void;
    search: {
        value: string;
        onChange: (value: string) => void;
        placeholder: string;
    };
    status: CatalogueStatus;
    /** The grid cards, rendered only while `status.kind === 'ready'`. */
    children: ReactNode;
    /** Dialog/drawer slot, rendered as a sibling of the scroll area. */
    dialog?: ReactNode;
    /**
     * Optional header actions (e.g. the CSV/media "delete unused" button),
     * rendered left of the add button. The section owns the behaviour.
     */
    actions?: ReactNode;
}

export const CatalogueLayout = ({
    title,
    addLabel,
    onAdd,
    search,
    status,
    children,
    dialog,
    actions,
}: CatalogueLayoutProps) => {
    const body = (() => {
        switch (status.kind) {
            case 'loading':
                return (
                    <p role="status" className="text-sm text-gray-400">
                        {status.message}
                    </p>
                );
            case 'error':
                return (
                    <p role="alert" className="text-sm text-red-400">
                        {status.message}
                    </p>
                );
            case 'empty':
            case 'searchEmpty':
                return <p className="text-sm text-gray-500">{status.message}</p>;
            case 'ready':
                return (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                        {children}
                    </div>
                );
        }
    })();

    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-gray-900">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-700 px-6 py-4">
                <h1 className="text-lg font-semibold text-gray-100">{title}</h1>
                <div className="flex items-center gap-3">
                    {actions}
                    <button
                        type="button"
                        onClick={onAdd}
                        className="flex items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                    >
                        <Plus size={16} />
                        {addLabel}
                    </button>
                </div>
            </div>

            <div className="shrink-0 px-6 pt-4">
                <Input
                    value={search.value}
                    onChange={search.onChange}
                    placeholder={search.placeholder}
                    aria-label={search.placeholder}
                    className="max-w-sm"
                />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6 [scrollbar-gutter:stable]">{body}</div>

            {dialog}
        </div>
    );
};
