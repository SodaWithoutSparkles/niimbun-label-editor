import React, { useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { Header } from './Header';
import { BottomBar } from './BottomBar';
import { NavSidebar } from './NavSidebar';
import { GalleryView } from '../gallery/GalleryView';
import { EditorShell } from '../editor/EditorShell';

/**
 * App shell. Header + status bar are shared; the gallery keeps
 * `NavSidebar` + `GalleryView`, while the editor renders the P3 `EditorShell`
 * (ui-spec.md §2). The template's `LeftSidebar` / `RightSidebar` /
 * `DrawingCanvas` are no longer referenced from either path (stripped in W6).
 */
export const MainLayout: React.FC = () => {
    const view = useStore((state) => state.view);
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
                    <GalleryView />
                </div>
            ) : (
                <EditorShell />
            )}

            {/* 3. Bottom Status Bar (gallery only; the editor shell owns its own) */}
            {view === 'gallery' && <BottomBar />}
        </div>
    );
};
