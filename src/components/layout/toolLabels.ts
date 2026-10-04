/**
 * Tool id -> catalogue key. A literal map keeps i18next's typed-key union
 * intact. Keyed on the insert-rail's `InsertAction` vocabulary plus `select`;
 * legacy draw-tool ids (`arrow`, `callout`, `star`) were stripped with the
 * deleted drawing canvas and now fall back to their raw id.
 */
const BASE_LABEL_KEYS = {
    select: 'tools.select',
    rectangle: 'tools.rectangle',
    ellipse: 'tools.ellipse',
    line: 'tools.line',
    text: 'tools.text',
    image: 'tools.image',
    polygon: 'tools.polygon',
} as const;

/**
 * One-shot insert-rail shape actions (ui-spec.md §4). Kept beside the shape
 * catalogue so a label resolved from `activeTool` always finds a real key,
 * never the raw `shape:x`.
 */
const SHAPE_ACTION_LABEL_KEYS = {
    'shape:line': 'tools.line',
    'shape:rectangle': 'tools.rectangle',
    'shape:ellipse': 'tools.ellipse',
    'shape:polygon': 'tools.polygon',
} as const satisfies Record<string, string>;

export const TOOL_LABEL_KEYS = { ...BASE_LABEL_KEYS, ...SHAPE_ACTION_LABEL_KEYS };

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
