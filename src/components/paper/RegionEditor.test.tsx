// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { mmToHm } from '../../core/hm';
import type { Region } from '../../core/doc/types';
import { RegionEditor } from './RegionEditor';

afterEach(cleanup);

type Polygon = Extract<Region, { kind: 'polygon' }>;

const triangle = (): Polygon => ({
    kind: 'polygon',
    points: [
        [0, 0],
        [mmToHm(10), 0],
        [0, mmToHm(10)],
    ],
    closed: true,
});

const points = (region: Region): [number, number][] =>
    (region as Polygon).points;

const invalidCases: Array<[string, Polygon]> = [
    [
        'fewer than 3 distinct points',
        { kind: 'polygon', points: [[0, 0], [mmToHm(10), 0]], closed: true },
    ],
    [
        'a collinear sliver',
        { kind: 'polygon', points: [[0, 0], [mmToHm(10), 0], [mmToHm(20), 0]], closed: true },
    ],
    [
        'a self-touching outline',
        {
            kind: 'polygon',
            points: [
                [0, 0],
                [mmToHm(10), 0],
                [0, mmToHm(10)],
                [mmToHm(10), 0],
            ],
            closed: true,
        },
    ],
];

describe('RegionEditor — polygon validity', () => {
    it('reports a valid polygon as valid (finishPolygonPoints accepts it)', () => {
        const onValidityChange = vi.fn();
        render(
            <RegionEditor
                regions={[triangle()]}
                onChange={() => {}}
                onValidityChange={onValidityChange}
            />,
        );

        expect(onValidityChange).toHaveBeenLastCalledWith(true);
    });

    for (const [label, region] of invalidCases) {
        it(`reports ${label} as invalid (finishPolygonPoints rejects it)`, () => {
            const onValidityChange = vi.fn();
            render(
                <RegionEditor
                    regions={[region]}
                    onChange={() => {}}
                    onValidityChange={onValidityChange}
                />,
            );

            expect(onValidityChange).toHaveBeenLastCalledWith(false);
        });
    }

    it('ignores non-polygon regions for validity', () => {
        const onValidityChange = vi.fn();
        render(
            <RegionEditor
                regions={[{ kind: 'rect', x: 0, y: 0, w: mmToHm(10), h: mmToHm(10) }]}
                onChange={() => {}}
                onValidityChange={onValidityChange}
            />,
        );

        expect(onValidityChange).toHaveBeenLastCalledWith(true);
    });
});

describe('RegionEditor — polygon point editing', () => {
    it('adds a point through onChange', () => {
        const onChange = vi.fn();
        render(<RegionEditor regions={[triangle()]} onChange={onChange} onValidityChange={() => {}} />);

        fireEvent.click(screen.getByRole('button', { name: 'Add point' }));

        expect(onChange).toHaveBeenCalledTimes(1);
        const next = onChange.mock.calls[0]![0] as Region[];
        expect(next[0]!.kind).toBe('polygon');
        expect(points(next[0]!)).toHaveLength(4);
        // `closed` is hard-coded and never user-toggleable.
        expect((next[0] as Polygon).closed).toBe(true);
    });

    it('removes a point through onChange', () => {
        const onChange = vi.fn();
        render(<RegionEditor regions={[triangle()]} onChange={onChange} onValidityChange={() => {}} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Remove point' })[0]!);

        const next = onChange.mock.calls[0]![0] as Region[];
        expect(points(next[0]!)).toHaveLength(2);
    });

    it('adds a default rectangle region', () => {
        const onChange = vi.fn();
        render(<RegionEditor regions={[]} onChange={onChange} onValidityChange={() => {}} />);

        fireEvent.click(screen.getByRole('button', { name: 'Add region' }));

        const next = onChange.mock.calls[0]![0] as Region[];
        expect(next).toHaveLength(1);
        expect(next[0]).toEqual({ kind: 'rect', x: 0, y: 0, w: mmToHm(10), h: mmToHm(10) });
    });
});
