import type { ShapeType } from '../../types';

/**
 * Shape type enum value -> catalogue key. A literal map keeps i18next's
 * typed-key union intact. Keyed on `ShapeType` so every displayed shape type is
 * covered and none can fall back to its lowercase enum value.
 */
export const TOOL_LABEL_KEYS = {
    select: 'tools.select',
    rectangle: 'tools.rectangle',
    ellipse: 'tools.ellipse',
    line: 'tools.line',
    arrow: 'tools.arrow',
    callout: 'tools.callout',
    star: 'tools.star',
    text: 'tools.text',
    image: 'tools.image',
    polygon: 'tools.polygon',
} as const satisfies Record<ShapeType | 'select' | 'callout', string>;

export type ToolLabelKey = (typeof TOOL_LABEL_KEYS)[keyof typeof TOOL_LABEL_KEYS];

/**
 * Resolve a runtime tool id to its translated label. `activeTool` is a typed
 * union in the store, but a project file can smuggle an arbitrary string in, and
 * a missing key would make `t(undefined)` render an empty label. Fall back to
 * the raw id so the label still shows something. Takes `t` so the lookup stays
 * within i18next's typed-key union (mirrors `RightSidebar.toolLabel`).
 */
export const toolLabel = (tool: string, t: (key: ToolLabelKey) => string): string => {
    // hasOwnProperty guard: an unguarded index would match inherited
    // Object.prototype members ('__proto__', 'constructor', ...) smuggled in via
    // a project file, handing a non-string/garbage key to `t`.
    if (!Object.prototype.hasOwnProperty.call(TOOL_LABEL_KEYS, tool)) return tool;
    const key = (TOOL_LABEL_KEYS as Record<string, ToolLabelKey>)[tool];
    return key ? t(key) : tool;
};
