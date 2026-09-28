import React from 'react';
import { useStore } from '../../store/useStore';

type ModifierKey = 'ctrl' | 'alt' | 'shift';

type ShortcutInputProps = {
    value: string;
    onChange: (value: string) => void;
    label: string;
};

const modifierOptions: Array<{ value: ModifierKey | 'none'; label: string }> = [
    { value: 'ctrl', label: 'Ctrl' },
    { value: 'shift', label: 'Shift' },
    { value: 'alt', label: 'Alt' },
    { value: 'none', label: 'None' }
];

const formatKey = (key: string) => {
    if (key === ' ') return 'Space';
    if (key.length === 1) return key.toUpperCase();
    return key;
};

const normalizeKey = (key: string) => {
    if (key.length === 1) return key.toLowerCase();
    return key;
};

const isModifierOnly = (key: string) => ['Shift', 'Control', 'Alt', 'Meta'].includes(key);

const ShortcutInput: React.FC<ShortcutInputProps> = ({ value, onChange, label }) => {
    return (
        <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-200">{label}</span>
            <input
                className="w-28 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                readOnly
                value={formatKey(value)}
                onKeyDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isModifierOnly(e.key)) return;
                    onChange(normalizeKey(e.key));
                }}
            />
        </div>
    );
};

interface ShortcutConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ShortcutConfigModal: React.FC<ShortcutConfigModalProps> = ({ isOpen, onClose }) => {
    const keyboardShortcuts = useStore((state) => state.keyboardShortcuts);
    const setModifyKey = useStore((state) => state.setModifyKey);
    const setCancelKey = useStore((state) => state.setCancelKey);
    const setTextSaveShortcut = useStore((state) => state.setTextSaveShortcut);
    const setToolShortcut = useStore((state) => state.setToolShortcut);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-gray-900 text-white rounded-lg shadow-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col border border-gray-700">
                <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
                    <button
                        className="text-gray-300 hover:text-white transition-colors"
                        onClick={onClose}
                        aria-label="Close keyboard shortcuts"
                    >
                        ✕
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    <div>
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Drawing Modifiers</h3>
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-200">Constrain (square/circle/45°)</span>
                            <select
                                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                value={keyboardShortcuts.modifyKey}
                                onChange={(e) => setModifyKey(e.target.value as ModifierKey)}
                            >
                                {modifierOptions.filter((option) => option.value !== 'none').map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Tool Shortcuts</h3>
                        <ShortcutInput
                            label="Select"
                            value={keyboardShortcuts.tools.select}
                            onChange={(value) => setToolShortcut('select', value)}
                        />
                        <ShortcutInput
                            label="Rectangle"
                            value={keyboardShortcuts.tools.rectangle}
                            onChange={(value) => setToolShortcut('rectangle', value)}
                        />
                        <ShortcutInput
                            label="Ellipse"
                            value={keyboardShortcuts.tools.ellipse}
                            onChange={(value) => setToolShortcut('ellipse', value)}
                        />
                        <ShortcutInput
                            label="Line"
                            value={keyboardShortcuts.tools.line}
                            onChange={(value) => setToolShortcut('line', value)}
                        />
                        <ShortcutInput
                            label="Arrow"
                            value={keyboardShortcuts.tools.arrow}
                            onChange={(value) => setToolShortcut('arrow', value)}
                        />
                        <ShortcutInput
                            label="Callout"
                            value={keyboardShortcuts.tools.callout}
                            onChange={(value) => setToolShortcut('callout', value)}
                        />
                        <ShortcutInput
                            label="Star"
                            value={keyboardShortcuts.tools.star}
                            onChange={(value) => setToolShortcut('star', value)}
                        />
                        <ShortcutInput
                            label="Text"
                            value={keyboardShortcuts.tools.text}
                            onChange={(value) => setToolShortcut('text', value)}
                        />
                        <ShortcutInput
                            label="Color Dropper"
                            value={keyboardShortcuts.tools.dropper}
                            onChange={(value) => setToolShortcut('dropper', value)}
                        />
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">Editing</h3>
                        <ShortcutInput
                            label="Cancel (Esc)"
                            value={keyboardShortcuts.cancelKey}
                            onChange={(value) => setCancelKey(value)}
                        />
                        <div className="flex items-center justify-between py-2">
                            <span className="text-sm text-gray-200">Save Text</span>
                            <div className="flex items-center space-x-2">
                                <select
                                    className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    value={keyboardShortcuts.textSave.modifier}
                                    onChange={(e) => setTextSaveShortcut(e.target.value as ModifierKey | 'none', keyboardShortcuts.textSave.key)}
                                >
                                    {modifierOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    className="w-24 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    readOnly
                                    value={formatKey(keyboardShortcuts.textSave.key)}
                                    onKeyDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (isModifierOnly(e.key)) return;
                                        setTextSaveShortcut(keyboardShortcuts.textSave.modifier, normalizeKey(e.key));
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-3 border-t border-gray-700 flex justify-end">
                    <button
                        className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded"
                        onClick={onClose}
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
