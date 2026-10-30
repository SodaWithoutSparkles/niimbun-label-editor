import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Shared gallery card art block — the white 160 px preview area.
 *
 * Label cards and preset cards show the same art: the saved thumbnail when
 * `LabelSummary.thumb` resolved, the backing outline otherwise. Extracted from
 * `LabelCard` (P3) so the preset card does not duplicate the render order or
 * the NaN-safe placeholder.
 *
 * The block is deliberately **not** interactive: `LabelCard` wraps it in its own
 * open button, and the preset card (no open/fill action before P5) renders it
 * plain. Never put a button inside here.
 */

/**
 * Generated placeholder art — backing outline only.
 *
 * Decision: P2 renders the cheap placeholder from the denormalized
 * `backingW/H` already on `LabelSummary`, with no per-card `repo.get`. The
 * region-union silhouette would require decompressing every thumbless doc,
 * defeating the backingW/H denormalization; denormalizing union bounds into
 * the record is a larger change deferred to P4 (real rendering).
 *
 * Decorative: the card's name text (and `LabelCard`'s open button) carries the
 * meaning, so the SVG is hidden from assistive tech instead of exposing an
 * unnamed image.
 */
const PlaceholderArt: React.FC<{ backingW: number; backingH: number }> = ({
    backingW,
    backingH,
}) => {
    // NaN/Infinity in `viewBox`/`width`/`height` blanks the SVG silently. Fall
    // back to a small positive placeholder so a corrupt summary still renders.
    const safeW = Number.isFinite(backingW) && backingW > 0 ? backingW : 100;
    const safeH = Number.isFinite(backingH) && backingH > 0 ? backingH : 100;
    return (
        <svg
            viewBox={`0 0 ${safeW} ${safeH}`}
            width={safeW}
            height={safeH}
            className="h-auto max-h-full w-auto max-w-full"
            aria-hidden="true"
        >
            {/*
              * `viewBox` is in hm, so a stroke in user units scales with the
              * fit: a 25×78 mm label rendered into the 144 px art area drew a
              * 0.46 px hairline and the card looked blank. `non-scaling-stroke`
              * keeps the backing outline a constant 1 CSS px on the white art
              * area, whatever the label's aspect ratio.
              */}
            <rect
                x={0}
                y={0}
                width={safeW}
                height={safeH}
                fill="#ffffff"
                stroke="#9ca3af"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
};

export interface CardArtProps {
    /** Data URL resolved by `labelRepo.resolveThumb`, when one exists. */
    thumb?: string;
    backingW: number;
    backingH: number;
    /** Display name used for the preview's alt text. */
    name: string;
}

export const CardArt: React.FC<CardArtProps> = ({ thumb, backingW, backingH, name }) => {
    const { t } = useTranslation();

    return (
        <div className="flex h-40 items-center justify-center overflow-hidden bg-white p-2">
            {thumb ? (
                <img
                    src={thumb}
                    alt={t('gallery.previewAlt', { name })}
                    className="max-h-full max-w-full object-contain"
                />
            ) : (
                <PlaceholderArt backingW={backingW} backingH={backingH} />
            )}
        </div>
    );
};
