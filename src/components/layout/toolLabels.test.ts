import { describe, expect, it } from 'vitest';
import { TOOL_LABEL_KEYS, toolLabel } from './toolLabels';
import type { ToolLabelKey } from './toolLabels';

/** Translator stub that echoes the catalogue key back. */
const t = (key: ToolLabelKey) => `t:${key}`;

const VALID_TOOLS = [
    'select',
    'rectangle',
    'ellipse',
    'line',
    'arrow',
    'callout',
    'star',
    'text',
    'image',
    'polygon',
] as const;

describe('toolLabel', () => {
    it('returns the mapped translated label for every valid tool', () => {
        for (const tool of VALID_TOOLS) {
            expect(toolLabel(tool, t)).toBe(`t:${TOOL_LABEL_KEYS[tool]}`);
        }
    });

    it('falls back to the raw id for an unknown tool', () => {
        expect(toolLabel('mystery-tool', t)).toBe('mystery-tool');
        expect(toolLabel('', t)).toBe('');
    });

    // Prototype members are not own keys, so `toolLabel`'s hasOwnProperty guard
    // makes these fall back to the raw id. They are reachable from a crafted
    // save file's `activeTool`.
    it('falls back to the raw id for prototype-inherited keys', () => {
        expect(toolLabel('__proto__', t)).toBe('__proto__');
        expect(toolLabel('constructor', t)).toBe('constructor');
        expect(toolLabel('toString', t)).toBe('toString');
        expect(toolLabel('hasOwnProperty', t)).toBe('hasOwnProperty');
    });
});
