import { X } from 'lucide-react';

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const HelpModal = ({ isOpen, onClose }: HelpModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
            <div className="bg-gray-900 text-white rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-700">
                <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-lg font-semibold">Help</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                        aria-label="Close help"
                    >
                        <X size={18} />
                    </button>
                </div>
                <div className="p-6 text-sm text-gray-300 space-y-3">
                    <p>
                        Welcome to the drawing app. Use the left toolbar to add shapes
                        (rectangle, ellipse, line, arrow, star, text, callout), pick colors,
                        and draw on the canvas.
                    </p>
                    <p>
                        The right panel lets you edit the selected object's properties, review
                        the action history, and manage layers. Use the top menus to create,
                        open, save, and export your project.
                    </p>
                </div>
            </div>
        </div>
    );
};
