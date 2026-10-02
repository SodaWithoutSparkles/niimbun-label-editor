import { describe, expect, it } from 'vitest';
import { formatKey } from './formatKey';
import { cn } from './cn';

const t = (key: 'keyLabels.ctrl' | 'keyLabels.alt' | 'keyLabels.shift' | 'keyLabels.esc' | 'keyLabels.space') => `t:${key}`;

describe('formatKey', () => {
    it('maps named modifier and control keys', () => {
        expect(formatKey('ctrl', t)).toBe('t:keyLabels.ctrl');
        expect(formatKey('CTRL', t)).toBe('t:keyLabels.ctrl');
        expect(formatKey('alt', t)).toBe('t:keyLabels.alt');
        expect(formatKey('shift', t)).toBe('t:keyLabels.shift');
        expect(formatKey('Escape', t)).toBe('t:keyLabels.esc');
    });

    it('renders a single space as Space', () => {
        expect(formatKey(' ', t)).toBe('t:keyLabels.space');
    });

    it('upper-cases single characters and preserves other names', () => {
        expect(formatKey('a', t)).toBe('A');
        expect(formatKey('Enter', t)).toBe('Enter');
    });

    it('degrades non-strings and empty strings to empty output', () => {
        expect(formatKey(undefined, t)).toBe('');
        expect(formatKey(null, t)).toBe('');
        expect(formatKey(7, t)).toBe('');
        expect(formatKey('', t)).toBe('');
    });
});

describe('cn', () => {
    it('joins classes and lets tailwind-merge resolve conflicts', () => {
        expect(cn('p-2', 'p-4')).toBe('p-4');
        expect(cn('text-sm', false && 'hidden', undefined, 'font-bold')).toBe('text-sm font-bold');
    });
});
