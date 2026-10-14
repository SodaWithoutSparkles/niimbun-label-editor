// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NumberField } from './NumberField';

afterEach(cleanup);

describe('NumberField', () => {
    it('renders the label and reports every keystroke as a string', () => {
        const onChange = vi.fn();
        render(<NumberField label="Width" value="10" onChange={onChange} />);

        const input = screen.getByRole('spinbutton');
        expect(input).toHaveValue(10);
        expect(screen.getByText('Width')).toBeInTheDocument();

        fireEvent.change(input, { target: { value: '12.5' } });
        expect(onChange).toHaveBeenCalledWith('12.5');
    });
});
