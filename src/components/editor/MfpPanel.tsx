import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { ObjectTab } from './ObjectTab';
import { DataSourceTab } from './DataSourceTab';
import { JsTab } from './JsTab';
import type { ContentSource, Node } from '../../core/doc/types';

/**
 * Multi-function panel (ui-spec.md §8) — row B, spanning the insert rail and
 * preview. Tabs: Object (always, default; bulk mode on multi-select), Data
 * source (stub), JS (contextual to template sources, disabled until P6). Every
 * tab scrolls internally because the panel height is limited.
 */

type MfpTab = 'object' | 'data' | 'js';

const TAB_LABEL_KEYS = {
    object: 'editor.mfp.object',
    data: 'editor.mfp.dataSource',
    js: 'editor.mfp.js',
} as const;

/** The content source a node carries, if any (text / qr / barcode). */
const contentSourceOf = (node: Node): ContentSource | undefined => {
    if (node.type === 'text') return node.text;
    if (node.type === 'qr') return node.data;
    if (node.type === 'barcode') return node.data;
    return undefined;
};

export const MfpPanel: React.FC = () => {
    const { t } = useTranslation();
    const doc = useStore((state) => state.currentDoc);
    const selectedNodeIds = useStore((state) => state.selectedNodeIds);
    const [tab, setTab] = useState<MfpTab>('object');

    const selected = useMemo<Node[]>(
        () => (doc ? doc.nodes.filter((node) => selectedNodeIds.includes(node.id)) : []),
        [doc, selectedNodeIds],
    );

    const hasTemplateSource = useMemo(
        () => selected.some((node) => contentSourceOf(node)?.kind === 'template'),
        [selected],
    );

    const tabs: MfpTab[] = hasTemplateSource ? ['object', 'data', 'js'] : ['object', 'data'];
    const activeTab: MfpTab = tabs.includes(tab) ? tab : 'object';

    return (
        <div className="flex min-h-0 flex-1 flex-col border-t border-gray-700 bg-gray-800">
            <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-gray-700 px-2">
                {tabs.map((id) => (
                    <button
                        key={id}
                        role="tab"
                        type="button"
                        aria-selected={activeTab === id}
                        onClick={() => setTab(id)}
                        className={cn(
                            'border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
                            activeTab === id
                                ? 'border-blue-500 text-blue-400'
                                : 'border-transparent text-gray-400 hover:text-gray-200',
                        )}
                    >
                        {t(TAB_LABEL_KEYS[id])}
                    </button>
                ))}
            </div>
            <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
                {activeTab === 'object' && <ObjectTab selected={selected} />}
                {activeTab === 'data' && <DataSourceTab />}
                {activeTab === 'js' && <JsTab />}
            </div>
        </div>
    );
};
