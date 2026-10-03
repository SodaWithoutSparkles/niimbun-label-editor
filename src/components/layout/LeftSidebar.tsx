import React from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { MousePointer2, Square, Circle, Minus, Star, Type, ArrowRight, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { DualColorPicker } from '../common/DualColorPicker';
import { ToolSettingsModal } from '../common/ToolSettingsModal';
import { formatKey } from '../../utils/formatKey';
import { TOOL_LABEL_KEYS } from './toolLabels';
import type { InsertAction } from '../../store/slices/toolsSlice';

export const LeftSidebar: React.FC = () => {
    const { t } = useTranslation();
    const activeTool = useStore((state) => state.activeTool);
    const setActiveTool = useStore((state) => state.setActiveTool);
    const colors = useStore((state) => state.colors);
    const setColors = useStore((state) => state.setColors);
    const isDropperActive = useStore((state) => state.isDropperActive);
    const setDropperActive = useStore((state) => state.setDropperActive);
    const toolShortcuts = useStore((state) => state.keyboardShortcuts.tools);

    const tools = [
        { id: 'select', icon: MousePointer2 },
        { id: 'rectangle', icon: Square },
        { id: 'ellipse', icon: Circle },
        { id: 'line', icon: Minus },
        { id: 'arrow', icon: ArrowRight },
        { id: 'callout', icon: MessageSquare },
        { id: 'star', icon: Star },
        { id: 'text', icon: Type },
    ] as const;

    return (
        <div className="w-12 bg-gray-800 border-r border-gray-700 flex flex-col items-center py-2 space-y-1 z-20 overflow-visible">
            {tools.map((tool) => (
                <div key={tool.id} className="relative w-full flex justify-center">
                    <button
                        onClick={() => {
                            setActiveTool(tool.id as unknown as InsertAction);
                            setDropperActive(false);
                        }}
                        className={clsx(
                            "p-2 rounded hover:bg-gray-700 transition-colors relative group",
                            activeTool === tool.id && !isDropperActive ? "bg-gray-700 text-blue-400" : "text-gray-400"
                        )}
                        title={`${t(TOOL_LABEL_KEYS[tool.id])} (${formatKey(toolShortcuts[tool.id], t)})`}
                    >
                        <tool.icon size={20} />
                    </button>
                    {activeTool === tool.id && <ToolSettingsModal />}
                </div>
            ))}

            <div className="w-8 h-px bg-gray-600 my-2" />

            <div className="mt-4 flex flex-col items-center space-y-3">
                <DualColorPicker
                    strokeColor={colors.stroke}
                    fillColor={colors.fill}
                    activeType={colors.active}
                    onColorChange={(type, color) => setColors({ [type]: color, active: type })}
                    onActiveTypeChange={(type) => setColors({ active: type })}
                    onPick={() => {
                        setDropperActive(true);
                    }}
                />
            </div>
        </div>
    );
};
