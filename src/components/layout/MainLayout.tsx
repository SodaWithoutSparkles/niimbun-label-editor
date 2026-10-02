import React, { Suspense, lazy, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { Header } from './Header';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { BottomBar } from './BottomBar';
import { NavSidebar } from './NavSidebar';
import { GalleryView } from '../gallery/GalleryView';

const DrawingCanvas = lazy(() => import('../canvas/DrawingCanvas').then((m) => ({ default: m.DrawingCanvas })));
const KeyboardShortcuts = lazy(() => import('../common/KeyboardShortcuts').then((m) => ({ default: m.KeyboardShortcuts })));

export const MainLayout: React.FC = () => {
    const { t } = useTranslation();
    const view = useStore((state) => state.view);
    const initPersistence = useStore((state) => state.initPersistence);

    // Boot the IDB-backed label library. `initPersistence` is idempotent, so the
    // StrictMode effect replay does not open a second connection or re-create.
    useEffect(() => {
        void initPersistence();
    }, [initPersistence]);

    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-900">
            <Suspense fallback={null}>
                <KeyboardShortcuts />
            </Suspense>
            {/* 1. Top Header (shared by gallery + editor) */}
            <Header />

            {/* 2. Middle Section — gallery home surface or the editor */}
            <div className="flex-1 flex overflow-hidden relative">
                {view === 'gallery' ? (
                    <>
                        <NavSidebar />
                        <GalleryView />
                    </>
                ) : (
                    <>
                        {/* Left Toolbar */}
                        <LeftSidebar />

                        {/* Center Canvas Area */}
                        <div className="flex-1 bg-gray-500 relative overflow-hidden flex flex-col">
                            <div className="flex-1 relative bg-gray-200">
                                <Suspense fallback={<div className="h-full w-full flex items-center justify-center text-gray-700">{t('mainLayout.loadingCanvas')}</div>}>
                                    <DrawingCanvas />
                                </Suspense>
                            </div>
                        </div>

                        {/* Right Panels */}
                        <RightSidebar />
                    </>
                )}
            </div>

            {/* 3. Bottom Status Bar (shared) */}
            <BottomBar />
        </div>
    );
};
