import type { hm } from '../../core/hm';

/**
 * Grid step for the preview overlay and snap candidates (ui-spec.md §6). 5 mm
 * is a comfortable drafting grid at label scale; purely a view aid, never
 * document data.
 */
export const GRID_STEP_HM: hm = 500;
