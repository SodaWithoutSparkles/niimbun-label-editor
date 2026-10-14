// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { mmToHm } from '../../core/hm';
import type { Guide } from '../../core/doc/types';
import { GuideEditor } from './GuideEditor';

afterEach(cleanup);

describe('GuideEditor', () => {
    it('adds a score guide with a generated id', () => {
        const onChange = vi.fn();
        render(<GuideEditor guides={[]} onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Add guide' }));

        const next = onChange.mock.calls[0]![0] as Guide[];
        expect(next).toHaveLength(1);
        expect(next[0]!.kind).toBe('score');
        expect(typeof next[0]!.id).toBe('string');
        expect(next[0]!.id.length).toBeGreaterThan(0);
        expect(next[0]!.line).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
    });

    it('removes a guide', () => {
        const guide: Guide = { id: 'g1', kind: 'score', line: { x1: 100, y1: 0, x2: 100, y2: 200 } };
        const onChange = vi.fn();
        render(<GuideEditor guides={[guide]} onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Remove guide' }));

        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('edits a line endpoint in mm and emits hm', () => {
        const guide: Guide = { id: 'g1', kind: 'score', line: { x1: 0, y1: 0, x2: 0, y2: 0 } };
        const onChange = vi.fn();
        render(<GuideEditor guides={[guide]} onChange={onChange} />);

        fireEvent.change(screen.getAllByRole('spinbutton')[0]!, { target: { value: '12.5' } });

        const next = onChange.mock.calls[0]![0] as Guide[];
        expect(next[0]!.line).toEqual({ x1: mmToHm(12.5), y1: 0, x2: 0, y2: 0 });
    });
});
