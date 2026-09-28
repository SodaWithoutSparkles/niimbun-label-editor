import React, { Suspense, lazy } from 'react';
import { Header } from './Header';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { BottomBar } from './BottomBar';

const DrawingCanvas = lazy(() => import('../canvas/DrawingCanvas').then((m) => ({ default: m.DrawingCanvas })));
const KeyboardShortcuts = lazy(() => import('../common/KeyboardShortcuts').then((m) => ({ default: m.KeyboardShortcuts })));

export const MainLayout: React.FC = () => {
    return (
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-900">
            <Suspense fallback={null}>
                <KeyboardShortcuts />
            </Suspense>
            {/* 1. Top Header */}
            <Header />

            {/* 2. Middle Section (Tools + Canvas + Panels) */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Left Toolbar */}
                <LeftSidebar />

                {/* Center Canvas Area */}
                <div className="flex-1 bg-gray-500 relative overflow-hidden flex flex-col">
                    <div className="flex-1 relative bg-gray-200">
                        <Suspense fallback={<div className="h-full w-full flex items-center justify-center text-gray-700">Loading canvas...</div>}>
                            <DrawingCanvas />
                        </Suspense>
                    </div>
                </div>

                {/* Right Panels */}
                <RightSidebar />
            </div>

            {/* 3. Bottom Status Bar */}
            <BottomBar />
        </div>
    );
};
