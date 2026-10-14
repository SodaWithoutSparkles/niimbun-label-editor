import type { FC } from 'react';
import { Input } from './Input';

export interface NumberFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
}

/**
 * Labelled numeric text input. Lifted verbatim from `CreateLabelDialog.tsx`
 * (`:43-52`) so the create-label dialog and the paper-type editor share one
 * field.
 *
 * `min`/`step` are advisory — a browser still accepts free text — so callers
 * parse the emitted string defensively (see `parseMm` in `utils/mm.ts`).
 */
export const NumberField: FC<NumberFieldProps> = ({ label, value, onChange }) => (
    <label className="flex flex-col gap-1 text-xs text-gray-400">
        {label}
        <Input type="number" min="0" step="0.1" value={value} onChange={onChange} />
    </label>
);
