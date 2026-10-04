/**
 * Public surface of the pure color pipeline (`src/core/render/`).
 *
 * Headless and React/Konva/DOM-free: operates on the structural `RgbaBuffer`
 * shape, not the DOM `ImageData`. The raster/editor layer owns canvas work.
 */

export { HM_PER_INCH, hmToPx, rasterDimensions, type RasterDimensions } from './dimensions';

export {
    COLOR_SPACES,
    MonoColorSpace,
    MONO_BLUE_WEIGHT,
    MONO_GREEN_WEIGHT,
    MONO_RED_WEIGHT,
    monoLuminance,
    toGrayBuffer,
    type ColorSpace,
    type ColorSpaceId,
    type RgbaBuffer,
} from './colorspace';

export {
    atkinson,
    createDiffuser,
    floydSteinberg,
    QUANTIZERS,
    stucki,
    threshold,
    type Quantizer,
    type QuantizerId,
    type QuantizeOptions,
} from './quantize';

export {
    applyPolicy,
    DEFAULT_POLICY_BY_TYPE,
    resolveQuantizer,
    type PolicyMask,
    type PolicyNode,
    type QuantizerPolicies,
} from './policy';

export { quantizeRgba, type QuantizeRequest } from './pipeline';
