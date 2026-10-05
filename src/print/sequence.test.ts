import { describe, expect, it } from 'vitest';
import {
    MAX_TOTAL_PAGES,
    planSequence,
    type PagePlan,
    type PrintOrder,
    type SequencePlan,
} from './sequence';

const collect = async (plan: SequencePlan): Promise<PagePlan[]> => {
    const pages: PagePlan[] = [];
    for await (const page of plan.pages) {
        pages.push(page);
    }
    return pages;
};

const sumQuantities = (pages: PagePlan[]): number =>
    pages.reduce((total, page) => total + page.quantity, 0);

/** A `timesFor` backed by a sparse index → copies map (absent → 1, the default). */
const timesMap = (map: Record<number, number>): ((rowIndex: number) => number) => {
    return (rowIndex) => map[rowIndex] ?? 1;
};

/**
 * Test-local mirror of the documented caller contract: read a raw `$times` cell
 * (absent/empty → 1) and let `planSequence` normalise the rest.
 */
const timesFromCell = (cell: string | undefined): number =>
    cell === undefined || cell === '' ? 1 : Number.parseInt(cell, 10);

describe('planSequence — grouped', () => {
    it('emits one plan per record in row order with times × copies', async () => {
        const plan = planSequence(3, timesMap({ 0: 2, 1: 1, 2: 3 }), {
            order: 'grouped',
            copies: 1,
        });

        expect(plan.rows).toBe(3);
        expect(await collect(plan)).toEqual([
            { rowIndex: 0, quantity: 2 },
            { rowIndex: 1, quantity: 1 },
            { rowIndex: 2, quantity: 3 },
        ]);
    });

    it('multiplies the global copies into a single grouped quantity', async () => {
        const plan = planSequence(2, timesMap({ 0: 2, 1: 1 }), {
            order: 'grouped',
            copies: 5,
        });

        expect(await collect(plan)).toEqual([
            { rowIndex: 0, quantity: 10 },
            { rowIndex: 1, quantity: 5 },
        ]);
    });
});

describe('planSequence — interleaved', () => {
    it('emits times × copies quantity-1 plans per record, in row order', async () => {
        const plan = planSequence(2, timesMap({ 0: 2, 1: 1 }), {
            order: 'interleaved',
            copies: 1,
        });

        expect(await collect(plan)).toEqual([
            { rowIndex: 0, quantity: 1 },
            { rowIndex: 0, quantity: 1 },
            { rowIndex: 1, quantity: 1 },
        ]);
    });

    it('repeats each record across the copies multiplier', async () => {
        const plan = planSequence(1, () => 2, { order: 'interleaved', copies: 3 });

        expect(await collect(plan)).toEqual([
            { rowIndex: 0, quantity: 1 },
            { rowIndex: 0, quantity: 1 },
            { rowIndex: 0, quantity: 1 },
            { rowIndex: 0, quantity: 1 },
            { rowIndex: 0, quantity: 1 },
            { rowIndex: 0, quantity: 1 },
        ]);
    });
});

describe('planSequence — $times semantics', () => {
    it('uses the default 1 for an absent/empty $times cell (caller contract)', async () => {
        const cells: Record<number, string | undefined> = { 0: '', 1: undefined, 2: '1' };
        const plan = planSequence(3, (rowIndex) => timesFromCell(cells[rowIndex]), {
            order: 'grouped',
            copies: 1,
        });

        expect(await collect(plan)).toEqual([
            { rowIndex: 0, quantity: 1 },
            { rowIndex: 1, quantity: 1 },
            { rowIndex: 2, quantity: 1 },
        ]);
    });

    it('floors fractional times', async () => {
        const plan = planSequence(2, timesMap({ 0: 2.9, 1: 0.5 }), {
            order: 'grouped',
            copies: 1,
        });

        expect(await collect(plan)).toEqual([{ rowIndex: 0, quantity: 2 }]);
    });

    it('skips negative times (clamped to 0)', async () => {
        const plan = planSequence(3, timesMap({ 0: 2, 1: -4, 2: 1 }), {
            order: 'grouped',
            copies: 1,
        });

        expect(await collect(plan)).toEqual([
            { rowIndex: 0, quantity: 2 },
            { rowIndex: 2, quantity: 1 },
        ]);
    });

    it('skips NaN / non-finite times (treated as 0)', async () => {
        const plan = planSequence(4, timesMap({ 0: Number.NaN, 1: Infinity, 2: 1, 3: -Infinity }), {
            order: 'grouped',
            copies: 1,
        });

        expect(await collect(plan)).toEqual([{ rowIndex: 2, quantity: 1 }]);
    });

    it('skips a row whose times is 0 even with copies > 1', async () => {
        const plan = planSequence(2, timesMap({ 0: 0, 1: 1 }), {
            order: 'interleaved',
            copies: 4,
        });

        expect(await collect(plan)).toEqual([
            { rowIndex: 1, quantity: 1 },
            { rowIndex: 1, quantity: 1 },
            { rowIndex: 1, quantity: 1 },
            { rowIndex: 1, quantity: 1 },
        ]);
    });
});

describe('planSequence — totalPages', () => {
    for (const order of ['grouped', 'interleaved'] as PrintOrder[]) {
        it(`equals the sum of generated quantities (${order})`, async () => {
            const plan = planSequence(4, timesMap({ 0: 3, 1: 0, 2: 2, 3: 5 }), {
                order,
                copies: 3,
            });
            const pages = await collect(plan);

            expect(plan.totalPages).toBe(sumQuantities(pages));
            expect(plan.totalPages).toBe((3 + 2 + 5) * 3);
        });
    }

    it('is 0 for an empty CSV', async () => {
        const plan = planSequence(0, () => 1, { order: 'grouped', copies: 1 });

        expect(plan.totalPages).toBe(0);
        expect(await collect(plan)).toEqual([]);
    });

    it('equals the sum of generated quantities for a pure timesFor', async () => {
        // Purity is a documented requirement: timesFor runs once per row in the
        // Σ pass and again per row in the generator. A row-indexed (stable)
        // callback keeps both passes identical.
        const plan = planSequence(3, timesMap({ 0: 2, 1: 3, 2: 4 }), {
            order: 'interleaved',
            copies: 2,
        });
        const pages = await collect(plan);

        expect(plan.totalPages).toBe(sumQuantities(pages));
        expect(plan.totalPages).toBe((2 + 3 + 4) * 2);
    });

    it('is 0 when every row is skipped', async () => {
        const plan = planSequence(3, () => 0, { order: 'interleaved', copies: 2 });

        expect(plan.totalPages).toBe(0);
        expect(await collect(plan)).toEqual([]);
    });
});

describe('planSequence — interleaved warning', () => {
    it('does not warn at exactly the default cap of 50', () => {
        const plan = planSequence(50, () => 1, { order: 'interleaved', copies: 1 });

        expect(plan.totalPages).toBe(50);
        expect(plan.warning).toBeUndefined();
    });

    it('warns above the default cap with pages and cap', () => {
        const plan = planSequence(51, () => 1, { order: 'interleaved', copies: 1 });

        expect(plan.warning).toEqual({ kind: 'interleaved-pages', pages: 51, cap: 50 });
    });

    it('honours a custom interleaveWarnAt', () => {
        const plan = planSequence(2, () => 3, {
            order: 'interleaved',
            copies: 1,
            interleaveWarnAt: 5,
        });

        expect(plan.totalPages).toBe(6);
        expect(plan.warning).toEqual({ kind: 'interleaved-pages', pages: 6, cap: 5 });
    });

    it('never warns for grouped even when the page count is large', () => {
        const plan = planSequence(100, () => 1, { order: 'grouped', copies: 2 });

        expect(plan.totalPages).toBe(200);
        expect(plan.warning).toBeUndefined();
    });
});

describe('planSequence — laziness', () => {
    it('does not build the remaining pages when the consumer stops early', async () => {
        const rows = 100_000;
        let calls = 0;
        const timesFor = (): number => {
            calls += 1;
            return 1;
        };

        const plan = planSequence(rows, timesFor, { order: 'interleaved', copies: 1 });
        // The cheap upfront Σ visits each row exactly once.
        const afterPlanning = calls;
        expect(afterPlanning).toBe(rows);

        const iterator = plan.pages[Symbol.asyncIterator]();
        const first = await iterator.next();
        expect(first.done).toBe(false);
        expect(first.value).toEqual({ rowIndex: 0, quantity: 1 });

        // One more source step ran for the pulled page. An eager generator that
        // materialised everything on `next()` would add `rows` more calls here.
        expect(calls).toBe(rows + 1);
    });
});

describe('planSequence — validation', () => {
    it('rejects a non-positive or fractional copies', () => {
        expect(() => planSequence(1, () => 1, { order: 'grouped', copies: 0 })).toThrow(
            RangeError,
        );
        expect(() => planSequence(1, () => 1, { order: 'grouped', copies: 1.5 })).toThrow(
            RangeError,
        );
    });

    it.each([Number.POSITIVE_INFINITY, -1, 1.5, Number.NaN])(
        'rejects an invalid rows count (%s)',
        (rows) => {
            expect(() =>
                planSequence(rows, () => 1, { order: 'grouped', copies: 1 }),
            ).toThrow(RangeError);
        },
    );

    it.each([-1, 1.5, Number.NaN])(
        'rejects an invalid interleaveWarnAt (%s)',
        (interleaveWarnAt) => {
            expect(() =>
                planSequence(1, () => 1, {
                    order: 'grouped',
                    copies: 1,
                    interleaveWarnAt,
                }),
            ).toThrow(RangeError);
        },
    );

    it('accepts an interleaveWarnAt of 0', () => {
        const plan = planSequence(1, () => 1, {
            order: 'interleaved',
            copies: 1,
            interleaveWarnAt: 0,
        });

        expect(plan.warning).toEqual({ kind: 'interleaved-pages', pages: 1, cap: 0 });
    });

    it('rejects a $times that pushes totalPages above MAX_TOTAL_PAGES', () => {
        expect(() =>
            planSequence(1, () => MAX_TOTAL_PAGES + 1, { order: 'grouped', copies: 1 }),
        ).toThrow(RangeError);
    });

    it('rejects a copies multiplier that pushes totalPages above MAX_TOTAL_PAGES', () => {
        expect(() =>
            planSequence(1, () => 1, { order: 'grouped', copies: MAX_TOTAL_PAGES + 1 }),
        ).toThrow(RangeError);
    });

    it('allows a total exactly at MAX_TOTAL_PAGES', () => {
        const plan = planSequence(1, () => MAX_TOTAL_PAGES, {
            order: 'grouped',
            copies: 1,
        });

        expect(plan.totalPages).toBe(MAX_TOTAL_PAGES);
    });

    it('exposes the passed rows count', () => {
        const plan = planSequence(7, () => 1, { order: 'grouped', copies: 1 });
        expect(plan.rows).toBe(7);
    });
});
