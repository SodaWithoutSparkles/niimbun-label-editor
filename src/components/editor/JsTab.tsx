import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * MFP → JS tab (ui-spec.md §8). Shown only when the selection's content source
 * is a template; **disabled-with-reason** until the P6 trust store ships, so the
 * user sees why it is unavailable rather than a vanished tab.
 */
export const JsTab: React.FC = () => {
    const { t } = useTranslation();
    return (
        <div className="p-3">
            <p className="rounded border border-amber-700 bg-amber-900/30 px-2 py-1 text-sm text-amber-200">
                {t('editor.mfp.jsDisabled')}
            </p>
        </div>
    );
};
