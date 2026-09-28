import { useEffect } from 'react';
import { useStore } from '../../store/useStore';

export const KeyboardShortcuts = () => {
    const undo = useStore((state) => state.undo);
    const redo = useStore((state) => state.redo);
    const cloneSelected = useStore((state) => state.cloneSelected);
    const deleteSelected = useStore((state) => state.deleteSelected);
    const moveSelectedLayer = useStore((state) => state.moveSelectedLayer);
    const selectAllItems = useStore((state) => state.selectAllItems);
    const selectedIds = useStore((state) => state.selectedIds);
    const objects = useStore((state) => state.objects);
    const setActiveTool = useStore((state) => state.setActiveTool);
    const setDropperActive = useStore((state) => state.setDropperActive);
    const keyboardShortcuts = useStore((state) => state.keyboardShortcuts);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if typing in an input field
            const target = e.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            // Ctrl/Cmd + Z - Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
                return;
            }

            // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z - Redo
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                redo();
                return;
            }

            // Ctrl/Cmd + D - Clone
            if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
                e.preventDefault();
                cloneSelected();
                return;
            }

            // Ctrl/Cmd + A - Select all (when there is already a selection)
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                if (selectedIds.length > 0 && objects.length > 0) {
                    e.preventDefault();
                    selectAllItems();
                }
                return;
            }

            // Delete or Backspace - Delete selected
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                deleteSelected();
                return;
            }

            // [ - Move layer down
            if (e.key === '[') {
                e.preventDefault();
                moveSelectedLayer('down');
                return;
            }

            // ] - Move layer up
            if (e.key === ']') {
                e.preventDefault();
                moveSelectedLayer('up');
                return;
            }

            // Tool shortcuts (only when no modifier keys are pressed)
            if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                const key = e.key.toLowerCase();
                const toolByKey = new Map<string, Exclude<keyof typeof keyboardShortcuts.tools, 'dropper'>>(
                    Object.entries(keyboardShortcuts.tools)
                        .filter(([tool]) => tool !== 'dropper')
                        .map(([tool, shortcut]) => [shortcut.toLowerCase(), tool as Exclude<keyof typeof keyboardShortcuts.tools, 'dropper'>])
                );

                const tool = toolByKey.get(key);
                if (tool) {
                    e.preventDefault();
                    setActiveTool(tool);
                    setDropperActive(false);
                    return;
                }

                if (key === keyboardShortcuts.tools.dropper.toLowerCase()) {
                    e.preventDefault();
                    setDropperActive(true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo, cloneSelected, deleteSelected, moveSelectedLayer, selectAllItems, selectedIds.length, objects.length, setActiveTool, setDropperActive, keyboardShortcuts]);

    return null;
};
