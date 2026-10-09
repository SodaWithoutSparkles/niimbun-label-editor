/**
 * Classification of a wheel event into the editor's gesture semantics.
 *
 * The mapping is explicit (modifier-driven, no mouse/touchpad heuristics):
 *   - Ctrl+wheel, and a touchpad pinch (browsers report it as `ctrlKey`) → zoom.
 *   - Shift+wheel → horizontal pan.
 *   - Plain wheel → vertical pan (also applies any `deltaX`, so a horizontal
 *     trackpad swipe pans horizontally even without shift).
 */
export interface WheelInput {
    ctrlKey: boolean;
    shiftKey: boolean;
}
export type WheelIntent = 'zoom' | 'pan-horizontal' | 'pan-vertical';
export const classifyWheel = (e: WheelInput): WheelIntent => {
    if (e.ctrlKey) return 'zoom';
    if (e.shiftKey) return 'pan-horizontal';
    return 'pan-vertical';
};