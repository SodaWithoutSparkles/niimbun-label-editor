import React from 'react';
import { useStore } from '../../store/useStore';
import { MousePointer2, Square, Circle, Minus, Star, Type, ArrowRight, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { DualColorPicker } from '../common/DualColorPicker';
import { ToolSettingsModal } from '../common/ToolSettingsModal';

export const LeftSidebar: React.FC = () => {
    const activeTool = useStore((state) => state.activeTool);
    const setActiveTool = useStore((state) => state.setActiveTool);
    const colors = useStore((state) => state.colors);
    const setColors = useStore((state) => state.setColors);
    const isDropperActive = useStore((state) => state.isDropperActive);
    const setDropperActive = useStore((state) => state.setDropperActive);

    const tools = [
        { id: 'select', icon: MousePointer2, label: 'Select (V)' },
        { id: 'rectangle', icon: Square, label: 'Rectangle (M)' },
        { id: 'ellipse', icon: Circle, label: 'Ellipse (L)' },
        { id: 'line', icon: Minus, label: 'Line (P)' },
        { id: 'arrow', icon: ArrowRight, label: 'Arrow (A)' },
        { id: 'callout', icon: MessageSquare, label: 'Text Box + Arrow (C)' },
        { id: 'star', icon: Star, label: 'Star (S)' },
        { id: 'text', icon: Type, label: 'Text (T)' },
    ] as const;

    return (
        <div className="w-12 bg-gray-800 border-r border-gray-700 flex flex-col items-center py-2 space-y-1 z-20 overflow-visible">
            {tools.map((tool) => (
                <div key={tool.id} className="relative w-full flex justify-center">
                    <button
                        onClick={() => {
                            setActiveTool(tool.id);
                            setDropperActive(false);
                        }}
                        className={clsx(
                            "p-2 rounded hover:bg-gray-700 transition-colors relative group",
                            activeTool === tool.id && !isDropperActive ? "bg-gray-700 text-blue-400" : "text-gray-400"
                        )}
                        title={tool.label}
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
