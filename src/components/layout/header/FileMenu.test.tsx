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
