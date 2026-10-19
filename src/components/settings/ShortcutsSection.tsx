import React, { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import type { ModifierKey, TextSaveModifier } from '../../store/storeTypes';
import { Input, Select, SettingRow } from '../common/forms';
import { formatKey } from '../../utils/formatKey';

interface ShortcutInputProps {
    value: string;
    onChange: (value: string) => void;
    label: string;
    /** Optional help text under the label (e.g. what the binding does). */
    description?: string;
}

const normalizeKey = (key: string) => {
    if (key.length === 1) return key.toLowerCase();
    return key;
};

const isModifierOnly = (key: string) => ['Shift', 'Control', 'Alt', 'Meta'].includes(key);

/**
 * Keys the capture field must skip. `Escape` closes the dialog and `Tab` moves
 * focus, so intercepting them would turn the dialog into a keyboard trap.
 * `Enter` is skipped because this `Modal` has no default action to submit (the
 * footer button is `type="button"` and it is not a `<form>`) and because
 * `Enter`/`Escape`/`Tab` are deliberately unbindable in capture fields — the
 * window-level handlers still own them. Filtering must happen BEFORE stopping
 * propagation, otherwise the enclosing Modal never sees Escape.
 */
const isDialogNavKey = (key: string) => key === 'Escape' || key === 'Enter' || key === 'Tab';

/**
 * A capture field records a *plain single key*. Modifier combinations belong to
 * the global shortcut layer, not to these bindings: swallowing e.g. Ctrl+, here
 * would both corrupt the binding (storing ",") and steal the app-level chord
 * that opens Settings. So skip any ctrl/meta/alt combination untouched, letting
 * it propagate to the rest of the app. Shift is a deliberate exception: the app
 * legitimately binds Shift-combinations (e.g. textSave uses modifier 'ctrl' with
 * key 'Enter'; the tool-shortcut system stores modifier flags separately), so a
 * user pressing Shift while capturing must still capture the key.
 */
const isModifierCombo = (e: React.KeyboardEvent<HTMLInputElement>) => e.ctrlKey || e.metaKey || e.altKey;

/**
 * Shared capture handler so Escape cannot be forgotten in one copy of the
 * logic: skip dialog-navigation keys and modifier combinations untouched,
 * otherwise swallow the event and persist the captured binding (modifier-only
 * keys are ignored).
 */
const captureKey = (e: React.KeyboardEvent<HTMLInputElement>, onChange: (value: string) => void) => {
    if (isDialogNavKey(e.key)) return;
    if (isModifierCombo(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (isModifierOnly(e.key)) return;
    onChange(normalizeKey(e.key));
};

/** Read-only capture field: the next non-modifier keypress is persisted. */
const ShortcutInput: React.FC<ShortcutInputProps> = ({ value, onChange, label, description }) => {
    const { t } = useTranslation();
    const id = useId();
    return (
        <SettingRow label={label} description={description} htmlFor={id}>
            <Input
                id={id}
                className="w-28 text-xs"
                readOnly
                value={formatKey(value, t)}
                onChange={() => {}}
                onKeyDown={(e) => captureKey(e, onChange)}
            />
        </SettingRow>
    );
};

/**
 * Absorbed content of the old `ShortcutConfigModal`: drawing modifiers, tool
 * shortcuts and editing shortcuts. Every capture writes straight to the store.
 */
export const ShortcutsSection: React.FC = () => {
    const { t } = useTranslation();
    const constrainId = useId();
    const textSaveModifierId = useId();
    const textSaveKeyId = useId();
    const keyboardShortcuts = useStore((state) => state.keyboardShortcuts);
    const setModifyKey = useStore((state) => state.setModifyKey);
    const setCancelKey = useStore((state) => state.setCancelKey);
    const setTextSaveShortcut = useStore((state) => state.setTextSaveShortcut);
    const setToolShortcut = useStore((state) => state.setToolShortcut);
    const setQuantizedViewShortcut = useStore((state) => state.setQuantizedViewShortcut);

    const modifierOptions = useMemo<Array<{ value: ModifierKey | 'none'; label: string }>>(
        () => [
            { value: 'ctrl', label: t('keyLabels.ctrl') },
            { value: 'shift', label: t('keyLabels.shift') },
            { value: 'alt', label: t('keyLabels.alt') },
            { value: 'none', label: t('settings.shortcuts.modifierNone') }
        ],
        [t]
    );

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    {t('settings.shortcuts.drawingModifiers')}
                </h3>
                <SettingRow label={t('settings.shortcuts.constrain')} htmlFor={constrainId}>
                    <Select
                        id={constrainId}
                        value={keyboardShortcuts.modifyKey}
                        onChange={(value) => setModifyKey(value as ModifierKey)}
                        options={modifierOptions.filter((option) => option.value !== 'none')}
                    />
                </SettingRow>
            </div>

            <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    {t('settings.shortcuts.toolShortcuts')}
                </h3>
                <ShortcutInput
                    label={t('settings.shortcuts.select')}
                    value={keyboardShortcuts.tools.select}
                    onChange={(value) => setToolShortcut('select', value)}
                />
                <ShortcutInput
                    label={t('settings.shortcuts.rectangle')}
                    value={keyboardShortcuts.tools.rectangle}
                    onChange={(value) => setToolShortcut('rectangle', value)}
                />
                <ShortcutInput
                    label={t('settings.shortcuts.ellipse')}
                    value={keyboardShortcuts.tools.ellipse}
                    onChange={(value) => setToolShortcut('ellipse', value)}
                />
                <ShortcutInput
                    label={t('settings.shortcuts.line')}
                    value={keyboardShortcuts.tools.line}
                    onChange={(value) => setToolShortcut('line', value)}
                />
                <ShortcutInput
                    label={t('settings.shortcuts.text')}
                    value={keyboardShortcuts.tools.text}
                    onChange={(value) => setToolShortcut('text', value)}
                />
            </div>

            <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    {t('settings.shortcuts.viewShortcuts')}
                </h3>
                <ShortcutInput
                    label={t('settings.shortcuts.quantizedView')}
                    description={t('settings.shortcuts.quantizedViewDescription')}
                    value={keyboardShortcuts.quantizedView}
                    onChange={(value) => setQuantizedViewShortcut(value)}
                />
            </div>

            <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-3">
                    {t('settings.shortcuts.editing')}
                </h3>
                <ShortcutInput
                    label={t('settings.shortcuts.cancelKey')}
                    value={keyboardShortcuts.cancelKey}
                    onChange={(value) => setCancelKey(value)}
                />
                <SettingRow label={t('settings.shortcuts.saveText')} htmlFor={textSaveModifierId}>
                    <div className="flex items-center gap-2">
                        <Select
                            id={textSaveModifierId}
                            value={keyboardShortcuts.textSave.modifier}
                            onChange={(value) =>
                                setTextSaveShortcut(
                                    value as TextSaveModifier,
                                    keyboardShortcuts.textSave.key
                                )
                            }
                            options={modifierOptions}
                        />
                        <Input
                            id={textSaveKeyId}
                            aria-label={t('settings.shortcuts.saveText')}
                            className="w-24 text-xs"
                            readOnly
                            value={formatKey(keyboardShortcuts.textSave.key, t)}
                            onChange={() => {}}
                            onKeyDown={(e) =>
                                captureKey(e, (value) =>
                                    setTextSaveShortcut(keyboardShortcuts.textSave.modifier, value)
                                )
                            }
                        />
                    </div>
                </SettingRow>
            </div>
        </div>
    );
};
