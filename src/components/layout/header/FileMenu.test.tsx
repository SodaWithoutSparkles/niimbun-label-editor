// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../../i18n';
import { FileMenu } from './FileMenu';

type Props = ComponentProps<typeof FileMenu>;

const noop = (): void => undefined;

const renderMenu = (overrides: Partial<Props> = {}): Props => {
    const props: Props = {
        activeMenu: 'file',
        onToggle: noop,
        onCloseMenu: vi.fn(),
        autoSave: false,
        onSave: noop,
        onToggleAutoSave: noop,
        onPrint: vi.fn(),
        saveDisabled: false,
        printDisabled: false,
        onHome: vi.fn(),
        onImport: vi.fn(),
        onExportCurrent: vi.fn(),
        onExportAll: vi.fn(),
        exportDisabled: false,
        exportAllDisabled: false,
        transferBusy: false,
        ...overrides,
    };
    render(<FileMenu {...props} />);
    return props;
};

afterEach(cleanup);

describe('FileMenu — Print item', () => {
    it('is enabled in the editor and opens the print dialog', () => {
        const props = renderMenu({ printDisabled: false });

        const item = screen.getByText('Print…');
        expect(item).toBeInTheDocument();
        fireEvent.click(item);

        expect(props.onPrint).toHaveBeenCalledTimes(1);
        expect(props.onCloseMenu).toHaveBeenCalledTimes(1);
    });

    it('does nothing when disabled (no document / outside the editor)', () => {
        const props = renderMenu({ printDisabled: true });

        fireEvent.click(screen.getByText('Print…'));

        expect(props.onPrint).not.toHaveBeenCalled();
    });

    it('advertises the Ctrl/Cmd+P shortcut', () => {
        renderMenu();
        expect(screen.getByText('Ctrl+P')).toBeInTheDocument();
    });
});

describe('FileMenu — Home item', () => {
    it('returns to the gallery and closes the menu', () => {
        const props = renderMenu();

        fireEvent.click(screen.getByText('Home'));

        expect(props.onHome).toHaveBeenCalledTimes(1);
        expect(props.onCloseMenu).toHaveBeenCalledTimes(1);
    });
});

describe('FileMenu — import/export items', () => {
    it('renders the three transfer items between Save and Print', () => {
        renderMenu();

        const save = screen.getByText('Save Label');
        const importItem = screen.getByText('Import labels…');
        const exportCurrent = screen.getByText('Export this label…');
        const exportAll = screen.getByText('Export all labels…');
        const print = screen.getByText('Print…');

        // Document order: Save → Import → Export this label → Export all → Print.
        const order = [save, importItem, exportCurrent, exportAll, print];
        for (let index = 1; index < order.length; index += 1) {
            expect(
                order[index - 1]!.compareDocumentPosition(order[index]!) &
                    Node.DOCUMENT_POSITION_FOLLOWING,
            ).toBeTruthy();
        }
    });

    it('calls each handler and closes the menu', () => {
        const props = renderMenu();

        fireEvent.click(screen.getByText('Import labels…'));
        expect(props.onImport).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Export this label…'));
        expect(props.onExportCurrent).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Export all labels…'));
        expect(props.onExportAll).toHaveBeenCalledTimes(1);

        expect(props.onCloseMenu).toHaveBeenCalledTimes(3);
    });

    it('disables the two export items from their props', () => {
        const props = renderMenu({ exportDisabled: true, exportAllDisabled: true });

        fireEvent.click(screen.getByText('Export this label…'));
        fireEvent.click(screen.getByText('Export all labels…'));

        expect(props.onExportCurrent).not.toHaveBeenCalled();
        expect(props.onExportAll).not.toHaveBeenCalled();
    });

    it('disables every transfer item while a transfer is busy', () => {
        const props = renderMenu({ transferBusy: true });

        fireEvent.click(screen.getByText('Import labels…'));
        fireEvent.click(screen.getByText('Export this label…'));
        fireEvent.click(screen.getByText('Export all labels…'));

        expect(props.onImport).not.toHaveBeenCalled();
        expect(props.onExportCurrent).not.toHaveBeenCalled();
        expect(props.onExportAll).not.toHaveBeenCalled();
    });
});
