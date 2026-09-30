import type { AppState } from '../../store/storeTypes';

/** Tool enum value -> catalogue key. A literal map keeps i18next's typed-key union intact. */
export const TOOL_LABEL_KEYS = {
    select: 'tools.select',
    rectangle: 'tools.rectangle',
    ellipse: 'tools.ellipse',
    line: 'tools.line',
    arrow: 'tools.arrow',
    callout: 'tools.callout',
    star: 'tools.star',
    text: 'tools.text',
} as const satisfies Partial<Record<AppState['activeTool'], string>>;

export type ToolLabelKey = (typeof TOOL_LABEL_KEYS)[keyof typeof TOOL_LABEL_KEYS];
