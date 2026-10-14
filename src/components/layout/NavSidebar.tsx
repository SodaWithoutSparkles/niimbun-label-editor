import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, FileText, FolderOpen, Plus, Table2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { GallerySection } from '../../store/slices/viewSlice';
import { cn } from '../../utils/cn';
import { CreateLabelDialog } from '../labels/CreateLabelDialog';

/** Literal map so the dynamic section id keeps `t()` typed. */
const SECTION_LABEL_KEYS = {
    recent: 'nav.recent',
    paper: 'nav.paperManagement',
    templates: 'nav.templates',
    csv: 'nav.dataSource',
} as const;

const SECTION_ICONS = {
    recent: Clock,
    paper: FileText,
    templates: FolderOpen,
    csv: Table2,
} as const;

const ORDERED_SECTIONS: GallerySection[] = ['recent', 'paper', 'templates', 'csv'];

/**
 * Gallery nav sidebar: Recent / Paper management / Templates / Data source,
 * plus the `＋ New label` CTA. The active section lives in the store
 * (`gallerySection`) so `MainLayout` can swap the pane; `Recent` lists the
 * labels while `Paper management` points at the paper-type manager. Templates
 * and CSV stay placeholders (P9).
 */
export const NavSidebar: React.FC = () => {
    const { t } = useTranslation();
    const gallery = useStore((state) => state.gallery);
    const openLabel = useStore((state) => state.openLabel);
    const addNotification = useStore((state) => state.addNotification);
    const gallerySection = useStore((state) => state.gallerySection);
    const setGallerySection = useStore((state) => state.setGallerySection);
    const [showCreate, setShowCreate] = useState(false);

    const handleOpen = (id: string) => {
        void openLabel(id).then((doc) => {
            // Mirror GalleryView: a corrupt payload yields `null`, not a silent
            // no-op click.
            if (!doc) {
                addNotification({ type: 'error', message: t('gallery.openFailed') });
            }
        });
    };

    return (
        <div className="flex w-56 shrink-0 flex-col border-r border-gray-700 bg-gray-800">
            <div className="border-b border-gray-700 p-3">
                <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                    <Plus size={16} />
                    {t('nav.newLabel')}
                </button>
            </div>

            <nav className="flex flex-col gap-0.5 p-2">
                {ORDERED_SECTIONS.map((id) => {
                    const Icon = SECTION_ICONS[id];
                    const active = gallerySection === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setGallerySection(id)}
                            className={cn(
                                'flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
                                active ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700/60',
                            )}
                        >
                            <Icon size={16} />
                            {t(SECTION_LABEL_KEYS[id])}
                        </button>
                    );
                })}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto border-t border-gray-700 p-2">
                {gallerySection === 'recent' ? (
                    gallery.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-gray-500">{t('nav.emptyRecent')}</p>
                    ) : (
                        <ul className="space-y-0.5">
                            {gallery.map((summary) => (
                                <li key={summary.id}>
                                    <button
                                        type="button"
                                        onClick={() => handleOpen(summary.id)}
                                        className="w-full truncate rounded px-2 py-1.5 text-left text-sm text-gray-300 transition-colors hover:bg-gray-700/60"
                                        title={summary.name}
                                    >
                                        {summary.name.length > 0 ? summary.name : t('nav.newLabel')}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )
                ) : (
                    <p className="px-2 py-3 text-xs text-gray-500">
                        {gallerySection === 'paper' ? t('paperTypes.sidebarHint') : t('nav.comingSoon')}
                    </p>
                )}
            </div>

            <CreateLabelDialog open={showCreate} onClose={() => setShowCreate(false)} />
        </div>
    );
};
