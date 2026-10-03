import React from 'react';
import type { Viewport } from '../../core/viewport';
import { hmToMm } from '../../core/hm';

/**
 * mm rulers on the preview's top and left edges (ui-spec.md §6). DOM overlay
 * (not Konva) so it can sit in the gutter outside the Stage. Ticks every 1 mm,
 * labels every 5 mm.
 *
 * At `rotation: 90` the view transform is `screen = pan + R·(world·zoom)` with
 * a clockwise quarter turn in y-down space, i.e.
 *
 *     screen.x = viewport.x - world.y·zoom
 *     screen.y = viewport.y + world.x·zoom
 *
 * so the top ruler follows the world **y** axis from `viewport.x` **leftwards**
 * over `backingH`, and the left ruler follows the world **x** axis from
 * `viewport.y` **downwards** over `backingW`. `rulerTicks` is the pure mapping
 * the render and the tests share.
 */

const TICK_MM = 1;
const LABEL_MM = 5;

/** mm values from 0 to the backing extent (inclusive). */
const mmTicks = (lengthHm: number): number[] => {
    const mm = Math.floor(hmToMm(lengthHm));
    const out: number[] = [];
    for (let i = 0; i <= mm; i += TICK_MM) out.push(i);
    return out;
};

export interface RulerTick {
    mm: number;
    /** CSS px offset along the dominant screen axis (left for top, top for left). */
    offset: number;
    major: boolean;
}

/**
 * Screen offsets for one ruler along `lengthHm`, starting at `origin` and
 * stepping `+1` (unrotated) or `-1` (rotated top ruler) mm. Pure so the
 * rotation-90 direction is unit-tested without a DOM.
 */
export const rulerTicks = (
    lengthHm: number,
    origin: number,
    zoom: number,
    direction: 1 | -1,
): RulerTick[] =>
    mmTicks(lengthHm).map((mm) => ({
        mm,
        offset: origin + direction * mm * 100 * zoom,
        major: mm % LABEL_MM === 0,
    }));

interface RulersProps {
    viewport: Viewport;
    backingW: number;
    backingH: number;
    /** Accent colour for the label extent on the ruler. */
    className?: string;
}

export const Rulers: React.FC<RulersProps> = ({ viewport, backingW, backingH }) => {
    const { zoom, rotation } = viewport;
    const rotated = rotation === 90;

    // Rotated: top measures world-y (backingH) from viewport.x going left;
    // left measures world-x (backingW) from viewport.y going down.
    const topLengthHm = rotated ? backingH : backingW;
    const leftLengthHm = rotated ? backingW : backingH;

    // The world origin sits at `(viewport.x, viewport.y)` in both rotations; the
    // rotation only flips which world axis each ruler reads and the top ruler's
    // step direction.
    const topDirection: 1 | -1 = rotated ? -1 : 1;

    const topTicks = rulerTicks(topLengthHm, viewport.x, zoom, topDirection);
    const leftTicks = rulerTicks(leftLengthHm, viewport.y, zoom, 1);

    return (
        <>
            <div className="pointer-events-none absolute left-6 top-0 right-0 h-6 border-b border-gray-300 bg-gray-100 text-[9px] text-gray-500">
                {topTicks.map(({ mm, offset, major }) => (
                    <div key={`t-${mm}`} className="absolute top-0" style={{ left: offset }}>
                        <div className="absolute top-0 w-px bg-gray-400" style={{ height: major ? 8 : 4 }} />
                        {major && <span className="absolute top-1.5 -translate-x-1/2">{mm}</span>}
                    </div>
                ))}
            </div>
            <div className="pointer-events-none absolute left-0 top-6 bottom-0 w-6 border-r border-gray-300 bg-gray-100 text-[9px] text-gray-500">
                {leftTicks.map(({ mm, offset, major }) => (
                    <div key={`l-${mm}`} className="absolute left-0" style={{ top: offset }}>
                        <div className="absolute left-0 h-px bg-gray-400" style={{ width: major ? 8 : 4 }} />
                        {major && (
                            <span className="absolute left-1.5 -translate-y-1/2 -rotate-90 origin-left">
                                {mm}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </>
    );
};
