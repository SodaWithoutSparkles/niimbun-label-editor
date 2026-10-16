import React, { useMemo, useState } from 'react';
import { Keyboard, Palette, Settings, ShieldCheck, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { confirm, Modal } from '../common/dialogs';
import { GeneralSection } from './GeneralSection';
import { RenderingSection } from './RenderingSection';
import { ShortcutsSection } from './ShortcutsSection';
import { ToolsSection } from './ToolsSection';
import { TrustSection } from './TrustSection';
import type { SettingsSection } from './types';

interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Settings window shell: icon sidebar on the left, optional tab row and a
 * scrollable content area on the right. All overlay behaviour (Escape,
 * backdrop, focus trap, portal) comes from the shared `Modal`.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({ open, onClose }) => {
    const { t } = useTranslation();
    const resetSettings = useStore((state) => state.resetSettings);
    // The store's shared repo/gate: Settings revokes must lift the editor's
    // session overlay, so both must use the SAME gate instance.
    const trustRepo = useStore((state) => state.trustRepo);
    const trustGate = useStore((state) => state.trustGate);

    const sections = useMemo<SettingsSection[]>(
        () => [
            {
                id: 'general',
                label: t('settings.general.label'),
                icon: <Settings size={18} />,
                content: <GeneralSection />
            },
            {
                id: 'rendering',
                label: t('settings.rendering.label'),
                icon: <Palette size={18} />,
                content: <RenderingSection />
            },
            {
                id: 'shortcuts',
                label: t('settings.shortcuts.label'),
                icon: <Keyboard size={18} />,
                content: <ShortcutsSection />
            },
            {
                id: 'trust',
                label: t('settings.trust.label'),
                icon: <ShieldCheck size={18} />,
                content: <TrustSection repo={trustRepo ?? undefined} gate={trustGate ?? undefined} />
            },
            {
                id: 'tools',
                label: t('settings.tools.label'),
                icon: <Wrench size={18} />,
                tabs: [
                    {
                        id: 'shape',
                        label: t('settings.tools.shapeTab'),
                        content: <ToolsSection tab="shape" />
                    },
                    {
                        id: 'text',
                        label: t('settings.tools.textTab'),
                        content: <ToolsSection tab="text" />
                    }
                ]
            }
        ],
        [t, trustRepo, trustGate]
    );

    const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id);
    const [activeTabId, setActiveTabId] = useState<string>();

    const section = sections.find((s) => s.id === activeSectionId) ?? sections[0];
    const tab = section?.tabs?.find((t) => t.id === activeTabId) ?? section?.tabs?.[0];

    const handleReset = async () => {
        const ok = await confirm({ message: t('settings.resetConfirm'), danger: true });
        if (!ok) return;
        resetSettings();
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('settings.title')}
            // `max-w-none` cancels `Modal`'s default `max-w-md`: both are in
            // tailwind-merge's `max-w` group, unlike `w` (a different group), so
            // the incoming max-w-* is dropped rather than unioned. Without it the
            // box is min(75vw, 28rem) = 448px on any wide viewport.
            className="w-[75vw] h-[80vh] max-w-none"
            footer={
                <button
                    type="button"
                    onClick={handleReset}
                    className="rounded bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-500"
                >
                    {t('settings.reset')}
                </button>
            }
        >
            <div className="flex h-full">
                <nav className="w-1/5 max-[850px]:w-14 shrink-0 overflow-y-auto border-r border-gray-800 py-2">
                    {sections.map((s) => (
                        <button
                            key={s.id}
                            onClick={() => {
                                setActiveSectionId(s.id);
                                setActiveTabId(undefined); // fall back to the section's first tab
                            }}
                            title={s.label}
                            aria-current={s.id === section?.id ? 'true' : undefined}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                s.id === section?.id
                                    ? 'bg-gray-800 text-emerald-400'
                                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                            }`}
                        >
                            <span className="shrink-0">{s.icon}</span>
                            <span className="truncate max-[850px]:hidden">{s.label}</span>
                        </button>
                    ))}
                </nav>

                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center border-b border-gray-800 px-4 py-2">
                        <h2 className="text-sm font-semibold text-gray-300">{section?.label}</h2>
                    </div>

                    {section?.tabs && (
                        <div
                            role="tablist"
                            className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-800 px-4"
                            onKeyDown={(e) => {
                                const tabs = section?.tabs;
                                if (!section || !tabs) return;
                                const index = tabs.findIndex((t) => t.id === tab?.id);
                                const next =
                                    e.key === 'ArrowRight'
                                        ? tabs[(index + 1) % tabs.length]
                                        : e.key === 'ArrowLeft'
                                          ? tabs[(index - 1 + tabs.length) % tabs.length]
                                          : e.key === 'Home'
                                            ? tabs[0]
                                            : e.key === 'End'
                                              ? tabs[tabs.length - 1]
                                              : undefined;
                                if (!next) return;
                                e.preventDefault();
                                setActiveTabId(next.id);
                                document.getElementById(`tab-${section.id}-${next.id}`)?.focus();
                            }}
                        >
                            {section.tabs.map((t) => (
                                <button
                                    key={t.id}
                                    role="tab"
                                    id={`tab-${section.id}-${t.id}`}
                                    aria-selected={t.id === tab?.id}
                                    aria-controls={`tabpanel-${section.id}-${t.id}`}
                                    tabIndex={t.id === tab?.id ? 0 : -1}
                                    onClick={() => setActiveTabId(t.id)}
                                    className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                                        t.id === tab?.id
                                            ? 'border-emerald-500 text-emerald-400'
                                            : 'border-transparent text-gray-500 hover:text-gray-300'
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {section?.tabs && tab ? (
                        <div
                            role="tabpanel"
                            id={`tabpanel-${section.id}-${tab.id}`}
                            aria-labelledby={`tab-${section.id}-${tab.id}`}
                            className="flex-1 overflow-y-auto p-4"
                        >
                            {tab.content}
                        </div>
                    ) : (
                        // Section without tabs: a plain scroll area, not a tabpanel.
                        <div className="flex-1 overflow-y-auto p-4">{section?.content}</div>
                    )}
                </div>
            </div>
        </Modal>
    );
};
