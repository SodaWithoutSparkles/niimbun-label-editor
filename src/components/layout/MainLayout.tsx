import React, { useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Header } from './Header';
import { NavSidebar } from './NavSidebar';
import { GalleryView } from '../gallery/GalleryView';
import { PaperTypeSection } from '../gallery/PaperTypeSection';
import { CsvSection } from '../gallery/CsvSection';
import { MediaSection } from '../gallery/MediaSection';
import { EditorShell } from '../editor/EditorShell';

/**
 * App shell. `Header` is shared; the gallery renders `NavSidebar` + a main pane
 * (the label card grid, the paper-type manager, the CSV manager, or the media
 * manager when the sidebar selects one), while the editor renders the P3
 * `EditorShell` (ui-spec.md §2), which owns its own status bar. The template's
 * `LeftSidebar` / `RightSidebar` / `DrawingCanvas` are no longer referenced from
 * either path (stripped in W6).
 */
export const MainLayout: React.FC = () => {
    const view = useStore((state) => state.view);
    const gallerySection = useStore((state) => state.gallerySection);
    const initPersistence = useStore((state) => state.initPersistence);

    // Boot the IDB-backed label library. `initPersistence` is idempotent, so the
    // StrictMode effect replay does not open a second connection or re-create.
    useEffect(() => {
        void initPersistence();
    }, [initPersistence]);

    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-900">
            {/* 1. Top Header (shared by gallery + editor) */}
            <Header />

            {/* 2. Middle Section — gallery home surface or the editor shell */}
            {view === 'gallery' ? (
                <div className="flex-1 flex overflow-hidden relative">
                    <NavSidebar />
                    {gallerySection === 'paper' ? (
                        <PaperTypeSection />
                    ) : gallerySection === 'csv' ? (
                        <CsvSection />
                    ) : gallerySection === 'media' ? (
                        <MediaSection />
                    ) : (
                        <GalleryView />
                    )}
                </div>
            ) : (
                <EditorShell />
            )}
        </div>
    );
};
