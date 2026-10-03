import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * MFP → Data source tab (ui-spec.md §8). **Stub** for P6: CSV attach/import,
 * columns, the virtualized preview table, sample-row pick and globals all land
 * with the CSV engine. Nothing here is wired.
 */
export const DataSourceTab: React.FC = () => {
    const { t } = useTranslation();
    return (
        <div className="p-3 text-sm text-gray-500">
            <p>{t('editor.mfp.contentSourceDisabled')}</p>
        </div>
    );
};
