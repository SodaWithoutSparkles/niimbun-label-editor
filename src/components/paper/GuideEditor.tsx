import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { hm } from '../../core/hm';
import type { Guide } from '../../core/doc/types';
import { mmString, parseMm } from '../../utils/mm';
import { NumberField } from '../common/forms';

/**
 * Score-line (guide) list editor (phase 8, W4b/W4).
 *
 * A guide is a non-printable editor annotation — the grey dashed semi-cut / fold
 * score. It is deliberately **not** a `Region`: it never clips, prints, or joins
 * `union(regions)`. Each guide is four mm number fields (`x1, y1, x2, y2`) that
 * emit hm; `kind` is fixed to `'score'`.
 *
 * Ids are minted with `crypto.randomUUID()` when available, falling back to a
 * module-local counter (so a jsdom/happy-dom run without the Web Crypto UUID
 * still generates distinct ids and React keys).
 */

const LINE_KEYS = ['x1', 'y1', 'x2', 'y2'] as const;

const GUIDE_FIELD_KEYS = {
    x1: 'paperTypes.guideFields.x1',
    y1: 'paperTypes.guideFields.y1',
    x2: 'paperTypes.guideFields.x2',
    y2: 'paperTypes.guideFields.y2',
} as const;

let fallbackCounter = 0;

const mintId = (): string => {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
    fallbackCounter += 1;
    return `guide-${fallbackCounter}`;
};

export interface GuideEditorProps {
    guides: Guide[];
    onChange: (guides: Guide[]) => void;
}

export const GuideEditor: FC<GuideEditorProps> = ({ guides, onChange }) => {
    const { t } = useTranslation();

    const addGuide = () => {
        onChange([
            ...guides,
            { id: mintId(), kind: 'score', line: { x1: 0, y1: 0, x2: 0, y2: 0 } },
        ]);
    };

    const removeGuide = (index: number) => {
        onChange(guides.filter((_, i) => i !== index));
    };

    const setField = (index: number, key: (typeof LINE_KEYS)[number], value: hm) => {
        onChange(
            guides.map((guide, i) =>
                i === index ? { ...guide, line: { ...guide.line, [key]: value } } : guide,
            ),
        );
    };

    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-gray-300">{t('paperTypes.guides')}</span>
                <button
                    type="button"
                    onClick={addGuide}
                    className="flex items-center gap-1 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                >
                    <Plus size={14} />
                    {t('paperTypes.addGuide')}
                </button>
            </div>
            {guides.length === 0 ? (
                <p className="text-xs text-gray-500">{t('paperTypes.noGuides')}</p>
            ) : (
                <ul className="space-y-2">
                    {guides.map((guide, index) => (
                        <li key={guide.id} className="rounded border border-gray-700 bg-gray-800/60 p-2">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-medium text-gray-300">{t('paperTypes.guideLabel')}</span>
                                <button
                                    type="button"
                                    onClick={() => removeGuide(index)}
                                    title={t('paperTypes.removeGuide')}
                                    aria-label={t('paperTypes.removeGuide')}
                                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-300"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                                {LINE_KEYS.map((key) => (
                                    <NumberField
                                        key={key}
                                        label={t(GUIDE_FIELD_KEYS[key])}
                                        value={mmString(guide.line[key])}
                                        onChange={(value) => setField(index, key, parseMm(value))}
                                    />
                                ))}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
