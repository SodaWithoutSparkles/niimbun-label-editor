import { useEffect, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { hm } from '../../core/hm';
import { mmToHm } from '../../core/hm';
import type { Region } from '../../core/doc/types';
import { finishPolygonPoints, type PolygonPoint } from '../../editor/polygonDrawing';
import { mmString, parseMm } from '../../utils/mm';
import { NumberField, Select } from '../common/forms';

/**
 * Region list editor shared by the create-label dialog and the paper-type
 * editor (phase 8, W4).
 *
 * Boxed kinds (`rect` / `roundedRect` / `circle`) keep `CreateLabelDialog`'s
 * old `RegionRow` layout and behaviour: a kind selector, the dimension fields in
 * mm, and a remove button.
 *
 * Polygons are now **editable**, not read-only JSON: one row per vertex with x/y
 * in mm, plus add / remove / reorder. `closed` is hard-coded `true` and is never
 * user-toggleable — an open polygon has no interior and would not print.
 *
 * Validity: the component runs {@link finishPolygonPoints} on every polygon's
 * point list. On a point edit it stores the **normalized** points when they are
 * valid (adjacent duplicates collapsed, repeated closing vertex dropped) and the
 * raw points when they are not, so an in-progress edit keeps its row. It reports
 * the aggregate through `onValidityChange`; a `false` means the caller must
 * block save. This is a derivation of `regions`, so it is re-reported whenever
 * the prop changes (StrictMode-safe; `setState` bails on an unchanged value).
 */

const REGION_KIND_KEYS = {
    rect: 'regionKinds.rect',
    roundedRect: 'regionKinds.roundedRect',
    circle: 'regionKinds.circle',
    polygon: 'regionKinds.polygon',
} as const;

const REGION_KINDS = ['rect', 'roundedRect', 'circle', 'polygon'] as const;

const DEFAULT_BOX_MM = 10;
const DEFAULT_RADIUS_MM = 2;

/** A new region of `kind` at the editor defaults. Polygons start as a valid triangle. */
const defaultRegionOfKind = (kind: Region['kind']): Region => {
    switch (kind) {
        case 'rect':
            return { kind, x: 0, y: 0, w: mmToHm(DEFAULT_BOX_MM), h: mmToHm(DEFAULT_BOX_MM) };
        case 'roundedRect':
            return {
                kind,
                x: 0,
                y: 0,
                w: mmToHm(DEFAULT_BOX_MM),
                h: mmToHm(DEFAULT_BOX_MM),
                r: mmToHm(DEFAULT_RADIUS_MM),
            };
        case 'circle': {
            const r = mmToHm(DEFAULT_BOX_MM) / 2;
            return { kind, cx: r, cy: r, r };
        }
        case 'polygon':
            return {
                kind,
                points: [
                    [0, 0],
                    [mmToHm(DEFAULT_BOX_MM), 0],
                    [0, mmToHm(DEFAULT_BOX_MM)],
                ],
                closed: true,
            };
    }
};

/** True when every polygon region's points survive {@link finishPolygonPoints}. */
const regionsValid = (regions: readonly Region[]): boolean =>
    regions.every((region) => region.kind !== 'polygon' || finishPolygonPoints(region.points) !== null);

interface RegionRowProps {
    region: Region;
    onChange: (region: Region) => void;
    onRemove: () => void;
}

const RegionRow: FC<RegionRowProps> = ({ region, onChange, onRemove }) => {
    const { t } = useTranslation();

    const setPoint = (index: number, axis: 0 | 1, value: hm) => {
        if (region.kind !== 'polygon') return;
        const points: PolygonPoint[] = region.points.map((point, i) =>
            i === index ? (axis === 0 ? [value, point[1]] : [point[0], value]) : point,
        );
        emitPoints(points);
    };

    /**
     * Store the point list, normalized when `finishPolygonPoints` accepts it and
     * raw when it does not (so an unfinished edit keeps its row and shows the
     * invalid hint instead of silently dropping a vertex).
     */
    const emitPoints = (points: PolygonPoint[]) => {
        if (region.kind !== 'polygon') return;
        const finished = finishPolygonPoints(points);
        onChange({ kind: 'polygon', points: finished ?? points, closed: true });
    };

    const addPoint = () => {
        if (region.kind !== 'polygon') return;
        const points = region.points;
        const first = points[0];
        const last = points.at(-1);
        // Insert on the closing edge (last → first) so the new vertex is never an
        // adjacent duplicate of its neighbour and always survives normalization.
        const next: PolygonPoint =
            first && last
                ? [Math.round((last[0] + first[0]) / 2), Math.round((last[1] + first[1]) / 2)]
                : [(last?.[0] ?? 0) + 100, (last?.[1] ?? 0) + 100];
        emitPoints([...points, next]);
    };

    const removePoint = (index: number) => {
        if (region.kind !== 'polygon') return;
        emitPoints(region.points.filter((_, i) => i !== index));
    };

    const movePoint = (index: number, delta: -1 | 1) => {
        if (region.kind !== 'polygon') return;
        const target = index + delta;
        if (target < 0 || target >= region.points.length) return;
        const points = [...region.points];
        [points[index], points[target]] = [points[target]!, points[index]!];
        emitPoints(points);
    };

    const polygonInvalid = region.kind === 'polygon' && finishPolygonPoints(region.points) === null;

    return (
        <li className="rounded border border-gray-700 bg-gray-800/60 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
                <Select
                    value={region.kind}
                    onChange={(value) => onChange(defaultRegionOfKind(value as Region['kind']))}
                    options={REGION_KINDS.map((kind) => ({ value: kind, label: t(REGION_KIND_KEYS[kind]) }))}
                    aria-label={t('paperTypes.regionKind')}
                    className="w-40"
                />
                <button
                    type="button"
                    onClick={onRemove}
                    title={t('paperTypes.removeRegion')}
                    aria-label={t('paperTypes.removeRegion')}
                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-300"
                >
                    <Trash2 size={14} />
                </button>
            </div>

            {region.kind === 'polygon' ? (
                <div className="space-y-1">
                    <span className="text-xs text-gray-400">{t('paperTypes.polygonPoints')}</span>
                    <ul className="space-y-1">
                        {region.points.map((point, index) => (
                            <li key={index} className="flex items-end gap-2">
                                <NumberField
                                    label={t('regionFields.x')}
                                    value={mmString(point[0])}
                                    onChange={(value) => setPoint(index, 0, parseMm(value))}
                                />
                                <NumberField
                                    label={t('regionFields.y')}
                                    value={mmString(point[1])}
                                    onChange={(value) => setPoint(index, 1, parseMm(value))}
                                />
                                <button
                                    type="button"
                                    onClick={() => movePoint(index, -1)}
                                    disabled={index === 0}
                                    title={t('paperTypes.moveUp')}
                                    aria-label={t('paperTypes.moveUp')}
                                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100 disabled:opacity-40"
                                >
                                    <ArrowUp size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => movePoint(index, 1)}
                                    disabled={index === region.points.length - 1}
                                    title={t('paperTypes.moveDown')}
                                    aria-label={t('paperTypes.moveDown')}
                                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-gray-100 disabled:opacity-40"
                                >
                                    <ArrowDown size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => removePoint(index)}
                                    title={t('paperTypes.removePoint')}
                                    aria-label={t('paperTypes.removePoint')}
                                    className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-red-300"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button
                        type="button"
                        onClick={addPoint}
                        className="flex items-center gap-1 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                    >
                        <Plus size={14} />
                        {t('paperTypes.addPoint')}
                    </button>
                    {polygonInvalid && <p className="text-xs text-red-400">{t('paperTypes.invalidPoints')}</p>}
                </div>
            ) : (
                <div className="grid grid-cols-4 gap-2">
                    {region.kind === 'circle' ? (
                        <>
                            <NumberField label={t('regionFields.cx')} value={mmString(region.cx)} onChange={(v) => onChange({ ...region, cx: parseMm(v) })} />
                            <NumberField label={t('regionFields.cy')} value={mmString(region.cy)} onChange={(v) => onChange({ ...region, cy: parseMm(v) })} />
                            <NumberField label={t('regionFields.r')} value={mmString(region.r)} onChange={(v) => onChange({ ...region, r: parseMm(v) })} />
                        </>
                    ) : (
                        <>
                            <NumberField label={t('regionFields.x')} value={mmString(region.x)} onChange={(v) => onChange({ ...region, x: parseMm(v) })} />
                            <NumberField label={t('regionFields.y')} value={mmString(region.y)} onChange={(v) => onChange({ ...region, y: parseMm(v) })} />
                            <NumberField label={t('regionFields.w')} value={mmString(region.w)} onChange={(v) => onChange({ ...region, w: parseMm(v) })} />
                            <NumberField label={t('regionFields.h')} value={mmString(region.h)} onChange={(v) => onChange({ ...region, h: parseMm(v) })} />
                            {region.kind === 'roundedRect' && (
                                <NumberField label={t('regionFields.r')} value={mmString(region.r)} onChange={(v) => onChange({ ...region, r: parseMm(v) })} />
                            )}
                        </>
                    )}
                </div>
            )}
        </li>
    );
};

export interface RegionEditorProps {
    regions: Region[];
    onChange: (regions: Region[]) => void;
    /**
     * Aggregate polygon validity. `false` when any polygon's points fail
     * `finishPolygonPoints` (fewer than 3 distinct vertices, a self-touching
     * outline, or a zero-area sliver); the caller must block save.
     */
    onValidityChange?: (valid: boolean) => void;
}

export const RegionEditor: FC<RegionEditorProps> = ({ regions, onChange, onValidityChange }) => {
    const { t } = useTranslation();
    const valid = regionsValid(regions);

    useEffect(() => {
        onValidityChange?.(valid);
    }, [valid, onValidityChange]);

    const addRegion = () => {
        onChange([...regions, defaultRegionOfKind('rect')]);
    };

    const updateRegion = (index: number, region: Region) => {
        onChange(regions.map((entry, i) => (i === index ? region : entry)));
    };

    const removeRegion = (index: number) => {
        onChange(regions.filter((_, i) => i !== index));
    };

    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-gray-300">{t('paperTypes.regions')}</span>
                <button
                    type="button"
                    onClick={addRegion}
                    className="flex items-center gap-1 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                >
                    <Plus size={14} />
                    {t('paperTypes.addRegion')}
                </button>
            </div>
            {regions.length === 0 ? (
                <p className="text-xs text-gray-500">{t('paperTypes.noRegions')}</p>
            ) : (
                <ul className="space-y-2">
                    {regions.map((region, index) => (
                        <RegionRow
                            key={index}
                            region={region}
                            onChange={(next) => updateRegion(index, next)}
                            onRemove={() => removeRegion(index)}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
};
