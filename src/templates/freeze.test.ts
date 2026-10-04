import { describe, expect, it } from 'vitest';
import { createFrozenContext } from './freeze';

describe('createFrozenContext', () => {
    it('passes reads through for nested objects and arrays', () => {
        const ctx = createFrozenContext({ row: { name: 'Ada' }, tags: ['x', 'y'] });
        expect(ctx.row.name).toBe('Ada');
        expect(ctx.tags[1]).toBe('y');
        expect(ctx.tags).toHaveLength(2);
    });

    it('throws TypeError on nested set', () => {
        const ctx = createFrozenContext({ row: { name: 'Ada' } });
        expect(() => {
            ctx.row.name = 'Grace';
        }).toThrow(TypeError);
        expect(ctx.row.name).toBe('Ada');
    });

    it('throws TypeError on nested delete', () => {
        const ctx = createFrozenContext({ row: { name: 'Ada' } });
        const row = ctx.row as { name?: string };
        expect(() => {
            delete row.name;
        }).toThrow(TypeError);
        expect(ctx.row.name).toBe('Ada');
    });

    it('throws TypeError on nested defineProperty', () => {
        const ctx = createFrozenContext({ row: { name: 'Ada' } });
        expect(() => {
            Object.defineProperty(ctx.row, 'name', { value: 'Grace' });
        }).toThrow(TypeError);
        expect(ctx.row.name).toBe('Ada');
    });

    it('throws TypeError on array mutation', () => {
        const ctx = createFrozenContext({ tags: ['x'] });
        expect(() => {
            ctx.tags.push('y');
        }).toThrow(TypeError);
        expect(() => {
            ctx.tags[0] = 'z';
        }).toThrow(TypeError);
        expect(ctx.tags).toEqual(['x']);
    });

    it('wraps getOwnPropertyDescriptor values so they cannot mutate the target', () => {
        const ctx = createFrozenContext({ row: { name: 'Ada' } });
        const descriptor = Object.getOwnPropertyDescriptor(ctx, 'row') as PropertyDescriptor;
        expect(descriptor.value).not.toBe(undefined);
        expect(() => {
            (descriptor.value as { name: string }).name = 'Grace';
        }).toThrow(TypeError);

        const descriptors = Object.getOwnPropertyDescriptors(ctx);
        expect(() => {
            (descriptors.row.value as { name: string }).name = 'Grace';
        }).toThrow(TypeError);
        expect(ctx.row.name).toBe('Ada');
    });

    it('reads an own constructor column normally', () => {
        const ctx = createFrozenContext({ row: { constructor: 'widget' } });
        expect(ctx.row.constructor).toBe('widget');
        expect(Object.getOwnPropertyDescriptor(ctx.row, 'constructor')?.value).toBe('widget');
    });

    it('keeps prototype identity so instanceof Object works', () => {
        const ctx = createFrozenContext({ row: { name: 'Ada' } });
        expect(ctx.row instanceof Object).toBe(true);
        expect(Object.prototype.isPrototypeOf(ctx.row)).toBe(true);
        expect(Object.getPrototypeOf(ctx.row)).toBe(Object.prototype);
    });

    it('preserves Array.prototype identity so instanceof still works', () => {
        const ctx = createFrozenContext({ tags: ['x'] });
        expect(Array.isArray(ctx.tags)).toBe(true);
        expect(ctx.tags instanceof Array).toBe(true);
        expect(Object.getPrototypeOf(ctx.tags)).toBe(Array.prototype);
    });

    it('best-effort freezes object-likes without crashing on typed arrays', () => {
        const when = new Date('2020-01-01T00:00:00Z');
        const map = new Map<string, number>([['a', 1]]);
        const typed = new Uint8Array([1, 2]);
        const ctx = createFrozenContext({ when, map, typed });
        expect(Object.isFrozen(ctx.when)).toBe(true);
        expect(Object.isFrozen(ctx.map)).toBe(true);
        // A typed array with elements cannot be frozen; it must still be readable.
        expect(ctx.typed[0]).toBe(1);
    });

    it('returns primitives unchanged', () => {
        expect(createFrozenContext(7)).toBe(7);
        expect(createFrozenContext('a')).toBe('a');
        expect(createFrozenContext(null)).toBeNull();
    });
});
