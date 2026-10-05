import React, { useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { InsertRail } from './InsertRail';
import { PreviewStage } from './PreviewStage';
import { ViewControls } from './ViewControls';
import { MfpPanel } from './MfpPanel';
import { LayersPanel } from './LayersPanel';
import { EditorStatusBar } from './EditorStatusBar';
import { EditorKeyboardShortcuts } from './EditorKeyboardShortcuts';
import { SampleRowProvider } from './sampleRowContext';

/**
 * Editor shell (ui-spec.md §2). Grid:
 *
 *   row A: [Insert rail ~48px] [Preview flex] [View controls 280px]
 *   row B: [MFP spanning col 1–2]              [Object/layers 280px]
 *
 * Row A / row B split is ~55/45, a tunable constant. Header and status bar stay.
 */

const ROW_A_FR = 55;
const ROW_B_FR = 45;
const RIGHT_COLUMN_PX = 280;

export const EditorShell: React.FC = () => {
    const clearActiveTool = useStore((state) => state.clearActiveTool);

    // Leaving the editor must not leave an insert action armed for the next
    // mount (the preview cursor would open in crosshair mode).
    useEffect(() => () => clearActiveTool(), [clearActiveTool]);

    return (
        <SampleRowProvider>
            <div className="flex min-h-0 flex-1 flex-col">
                <EditorKeyboardShortcuts />
                <div
                    className="grid min-h-0 flex-1"
                    style={{
                        gridTemplateColumns: `3rem minmax(0, 1fr) ${RIGHT_COLUMN_PX}px`,
                        gridTemplateRows: `${ROW_A_FR}fr ${ROW_B_FR}fr`,
                    }}
                >
                    {/* Row A */}
                    <div className="row-start-1 col-start-1 flex min-h-0">
                        <InsertRail />
                    </div>
                    <div className="row-start-1 col-start-2 flex min-h-0 min-w-0">
                        <PreviewStage />
                    </div>
                    <div className="row-start-1 col-start-3 flex min-h-0 flex-col overflow-hidden">
                        <ViewControls />
                    </div>

                    {/* Row B */}
                    <div className="row-start-2 col-start-1 col-span-2 flex min-h-0 min-w-0">
                        <MfpPanel />
                    </div>
                    <div className="row-start-2 col-start-3 flex min-h-0 flex-col overflow-hidden">
                        <LayersPanel />
                    </div>
                </div>
                <EditorStatusBar />
            </div>
        </SampleRowProvider>
    );
};
