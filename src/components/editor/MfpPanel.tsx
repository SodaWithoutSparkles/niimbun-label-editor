import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { ObjectTab } from './ObjectTab';
import { DataSourceTab } from './DataSourceTab';
import { GlobalDataTab } from './GlobalDataTab';
import { JsTab } from './JsTab';
import { WarningsTab } from './WarningsTab';
import { carriesContentSource } from '../../editor/contentSource';
import type { Node } from '../../core/doc/types';

/**
 * Multi-function panel (ui-spec.md §8) — row B, spanning the insert rail and
 * preview. Tabs: Object (always, default; bulk mode on multi-select), Data
 * source (CSV attach/preview + sample row), Global data (O6), JS (the
 * selected node's content source), and Warnings (the aggregated P6 warning
 * center). Every tab scrolls internally because the panel height is limited.
 */

type MfpTab = 'object' | 'data' | 'globals' | 'js' | 'warnings';

const TAB_LABEL_KEYS = {
    object: 'editor.mfp.object',
    data: 'editor.mfp.dataSource',
    globals: 'editor.mfp.globalData',
    js: 'editor.mfp.js',
    warnings: 'editor.mfp.warnings',
} as const;

export const MfpPanel: React.FC = () => {
    const { t } = useTranslation();
    const doc = useStore((state) => state.currentDoc);
    const selectedNodeIds = useStore((state) => state.selectedNodeIds);
    const [tab, setTab] = useState<MfpTab>('object');

    const selected = useMemo<Node[]>(
        () => (doc ? doc.nodes.filter((node) => selectedNodeIds.includes(node.id)) : []),
        [doc, selectedNodeIds],
    );

    // The JS tab is contextual to a selection that can carry a content source.
    const canAuthorSource = selected.some((node) => carriesContentSource(node));

    const tabs: MfpTab[] = canAuthorSource
        ? ['object', 'data', 'globals', 'js', 'warnings']
        : ['object', 'data', 'globals', 'warnings'];
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
                {activeTab === 'data' && doc && <DataSourceTab doc={doc} />}
                {activeTab === 'globals' && doc && <GlobalDataTab doc={doc} />}
                {activeTab === 'js' && <JsTab selected={selected} />}
                {activeTab === 'warnings' && <WarningsTab />}
            </div>
        </div>
    );
};
