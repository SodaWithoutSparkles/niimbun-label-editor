import { useTranslation } from 'react-i18next';
import type { CsvRecord } from '../../data/csvRepo';
import { Modal } from '../common/dialogs/Modal';

/**
 * Read-only CSV preview dialog (phase 9, W1b; plan decision **D3**).
 *
 * The gallery's "edit" for a table is a rename plus this preview: full cell
 * editing is out of scope. The table renders `columns` as the header and up to
 * {@link CSV_VIEW_ROW_LIMIT} rows; a longer table says so via `csvs.truncated`
 * rather than silently dropping rows.
 *
 * Purely presentational — the section owns the record and the open state.
 */

/** Rows rendered before the truncation note appears. */
export const CSV_VIEW_ROW_LIMIT = 50;

export interface CsvViewDialogProps {
    open: boolean;
    record: CsvRecord | null;
    onClose: () => void;
}

export const CsvViewDialog = ({ open, record, onClose }: CsvViewDialogProps) => {
    const { t } = useTranslation();
    const columns = record?.columns ?? [];
    const rows = record?.rows ?? [];
    const visible = rows.slice(0, CSV_VIEW_ROW_LIMIT);
    const truncated = rows.length > CSV_VIEW_ROW_LIMIT;

    return (
        <Modal open={open} onClose={onClose} title={t('csvs.viewTitle')} size="xl">
            <div className="overflow-auto rounded border border-gray-700">
                <table
                    className="w-full border-collapse text-left text-xs text-gray-300"
                    aria-label={t('csvs.viewTitle')}
                >
                    <thead className="sticky top-0 bg-gray-800 text-gray-400">
                        <tr>
                            {columns.map((column, index) => (
                                <th
                                    key={`${column}-${index}`}
                                    scope="col"
                                    className="border-l border-gray-700 px-2 py-1 font-medium first:border-l-0"
                                >
                                    {column}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-t border-gray-800">
                                {columns.map((column, columnIndex) => (
                                    <td
                                        key={`${column}-${columnIndex}`}
                                        className="whitespace-nowrap border-l border-gray-800 px-2 py-1 first:border-l-0"
                                    >
                                        {row[columnIndex] ?? ''}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {truncated && (
                <p className="mt-2 text-xs text-gray-500">
                    {t('csvs.truncated', { shown: CSV_VIEW_ROW_LIMIT, total: rows.length })}
                </p>
            )}
        </Modal>
    );
};
