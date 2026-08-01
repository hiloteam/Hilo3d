import type GeometryData from '../../geometry/GeometryData';
import type Material from '../../material/Material';
import type { CameraDepthMode } from '../../camera/Camera';
import {
    ALWAYS,
    BACK,
    CCW,
    CONSTANT_ALPHA,
    CONSTANT_COLOR,
    CW,
    DECR,
    DECR_WRAP,
    DST_ALPHA,
    DST_COLOR,
    EQUAL,
    FRONT,
    FRONT_AND_BACK,
    FUNC_ADD,
    FUNC_REVERSE_SUBTRACT,
    FUNC_SUBTRACT,
    GEQUAL,
    GREATER,
    INCR,
    INCR_WRAP,
    INVERT,
    KEEP,
    LEQUAL,
    LESS,
    LINES,
    LINE_LOOP,
    LINE_STRIP,
    NEVER,
    NOTEQUAL,
    ONE,
    ONE_MINUS_CONSTANT_ALPHA,
    ONE_MINUS_CONSTANT_COLOR,
    ONE_MINUS_DST_ALPHA,
    ONE_MINUS_DST_COLOR,
    ONE_MINUS_SRC_ALPHA,
    ONE_MINUS_SRC_COLOR,
    POINTS,
    REPLACE,
    SRC_ALPHA,
    SRC_ALPHA_SATURATE,
    SRC_COLOR,
    TRIANGLES,
    TRIANGLE_FAN,
    TRIANGLE_STRIP,
    UNSIGNED_INT,
    UNSIGNED_SHORT,
    FLOAT,
    ZERO
} from '../../constants/webgl';
import { MAX, MIN } from '../../constants/webgl2';
import {
    RHIColorWrite,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHIBlendState,
    type RHIBlendFactor,
    type RHIBlendOperation,
    type RHIColorTargetState,
    type RHICompareFunction,
    type RHICullMode,
    type RHIDepthStencilState,
    type RHIFrontFace,
    type RHIIndexFormat,
    type RHIMultisampleState,
    type RHIPrimitiveState,
    type RHIShaderFragmentOutputReflection,
    type RHIPrimitiveTopology,
    type RHIStencilOperation,
    type RHITextureFormat,
    type RHIVertexBufferLayout,
    type RHIVertexFormat,
    type RHICapabilities
} from '../rhi/core';
import { applyDepthModeToComparison } from './DepthConvention';

/** Render-target identity required to create the first production mesh-draw pipeline. */
export interface RHIMeshDrawTargetDescriptor {
    readonly colorFormats: readonly (RHITextureFormat | null)[];
    readonly depthStencilFormat?: RHITextureFormat | null;
    readonly sampleCount: number;
}

/** The portable capability subset used while validating target formats and sample counts. */
export type RHIMeshDrawTargetCapabilities = Pick<RHICapabilities, 'getTextureFormatCapabilities'>;

/** Material state intentionally supported by the first sampler-free mesh-draw slice. */
export type RHIMeshDrawMaterialState = Pick<
    Material,
    | 'wireframe'
    | 'frontFace'
    | 'cullFace'
    | 'cullFaceType'
    | 'depthTest'
    | 'depthMask'
    | 'depthRange'
    | 'depthFunc'
    | 'transparent'
    | 'premultiplyAlpha'
    | 'blend'
    | 'blendEquation'
    | 'blendEquationAlpha'
    | 'blendSrc'
    | 'blendDst'
    | 'blendSrcAlpha'
    | 'blendDstAlpha'
    | 'stencilTest'
    | 'stencilMask'
    | 'stencilFunc'
    | 'stencilFuncRef'
    | 'stencilFuncMask'
    | 'stencilOpFail'
    | 'stencilOpZFail'
    | 'stencilOpZPass'
    | 'sampleAlphaToCoverage'
>;

export interface RHIMeshDrawPipelineState {
    readonly primitive: Readonly<RHIPrimitiveState>;
    readonly colorTargets: readonly (Readonly<RHIColorTargetState> | null)[];
    readonly depthStencil?: Readonly<RHIDepthStencilState>;
    readonly multisample: Readonly<RHIMultisampleState>;
}

export interface RHIMeshDrawDynamicState {
    readonly minDepth: number;
    readonly maxDepth: number;
    readonly stencilReference: number;
    readonly usesStencil: boolean;
}

export type RHIMeshDrawFragmentOutputMode = 'color' | 'depth-only';

interface CachedPositionLayout {
    readonly shaderLocation: number;
    readonly byteLength: number;
    readonly size: number;
    readonly type: number;
    readonly normalized: boolean;
    readonly stride: number;
    readonly offset: number;
    readonly layout: Readonly<RHIVertexBufferLayout>;
}

const positionLayouts = new WeakMap<GeometryData, CachedPositionLayout[]>();

function requireNonNegativeSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

function requireUInt32(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${name} must be an unsigned 32-bit integer`);
    }
    return value;
}

function mapFloat32VertexFormat(size: number): RHIVertexFormat {
    switch (size) {
        case 1:
            return 'float32';
        case 2:
            return 'float32x2';
        case 3:
            return 'float32x3';
        case 4:
            return 'float32x4';
        default:
            throw new TypeError(
                `The first mesh-draw slice supports only scalar through vec4 positions; received ${String(size)} components`
            );
    }
}

/** Map one Float32 position stream onto one RHI vertex-buffer slot. */
export function mapRHIFloat32PositionLayout(
    position: GeometryData,
    shaderLocation = 0
): Readonly<RHIVertexBufferLayout> {
    requireNonNegativeSafeInteger(shaderLocation, 'Position shader location');
    if (!(position.data instanceof Float32Array) || position.type !== FLOAT) {
        throw new TypeError('The first mesh-draw slice requires Float32 position data');
    }
    if (position.normalized) {
        throw new TypeError('Float32 position data must not be normalized');
    }

    const format = mapFloat32VertexFormat(position.size);
    const attributeByteLength = position.size * Float32Array.BYTES_PER_ELEMENT;
    const offset = position.offset;
    requireNonNegativeSafeInteger(offset, 'Position byte offset');
    if (offset % Float32Array.BYTES_PER_ELEMENT !== 0) {
        throw new RangeError('Position byte offset must be aligned to Float32 components');
    }

    if (position.stride === 0 && offset !== 0) {
        throw new RangeError('A tightly packed position stream cannot have a non-zero byte offset');
    }
    const arrayStride = position.stride === 0 ? attributeByteLength : position.stride;
    if (!Number.isSafeInteger(arrayStride) || arrayStride <= 0) {
        throw new RangeError('Position array stride must be a positive safe integer');
    }
    if (arrayStride % Float32Array.BYTES_PER_ELEMENT !== 0) {
        throw new RangeError('Position array stride must be aligned to Float32 components');
    }
    if (offset + attributeByteLength > arrayStride) {
        throw new RangeError('Position attribute exceeds its vertex array stride');
    }
    if (position.data.byteLength === 0 || position.data.byteLength % arrayStride !== 0) {
        throw new RangeError('Position data must contain a whole number of complete vertices');
    }

    let cachedLayouts = positionLayouts.get(position);
    if (cachedLayouts !== undefined) {
        for (const cached of cachedLayouts) {
            if (
                cached.shaderLocation === shaderLocation &&
                cached.byteLength === position.data.byteLength &&
                cached.size === position.size &&
                cached.type === position.type &&
                cached.normalized === position.normalized &&
                cached.stride === position.stride &&
                cached.offset === position.offset
            ) {
                return cached.layout;
            }
        }
    } else {
        cachedLayouts = [];
        positionLayouts.set(position, cachedLayouts);
    }

    const attribute = Object.freeze({ format, offset, shaderLocation });
    const layout = Object.freeze({
        arrayStride,
        stepMode: 'vertex',
        attributes: Object.freeze([attribute])
    });
    const replacement: CachedPositionLayout = {
        shaderLocation,
        byteLength: position.data.byteLength,
        size: position.size,
        type: position.type,
        normalized: position.normalized,
        stride: position.stride,
        offset: position.offset,
        layout
    };
    const existing = cachedLayouts.findIndex(cached => cached.shaderLocation === shaderLocation);
    if (existing < 0) cachedLayouts.push(replacement);
    else cachedLayouts[existing] = replacement;
    return layout;
}

/** Map contiguous scalar engine indices to the two formats supported by RHI. */
export function mapRHIIndexFormat(indices: GeometryData): RHIIndexFormat {
    if (indices.size !== 1 || indices.stride !== 0 || indices.offset !== 0 || indices.normalized) {
        throw new TypeError(
            'RHI index data must be contiguous, non-normalized, and contain one component per index'
        );
    }
    if (indices.data.length === 0) {
        throw new RangeError('RHI index data must contain at least one index');
    }
    if (indices.data instanceof Uint8Array || indices.data instanceof Uint8ClampedArray) {
        throw new TypeError('Uint8 index data must be widened before creating an RHI draw');
    }
    if (indices.data instanceof Uint16Array) {
        if (indices.type !== UNSIGNED_SHORT) {
            throw new TypeError('Uint16 index data must use the UNSIGNED_SHORT component type');
        }
        return 'uint16';
    }
    if (indices.data instanceof Uint32Array) {
        if (indices.type !== UNSIGNED_INT) {
            throw new TypeError('Uint32 index data must use the UNSIGNED_INT component type');
        }
        return 'uint32';
    }
    throw new TypeError('RHI index data must use Uint16Array or Uint32Array storage');
}

/** Map every portable primitive topology; WebGL-only loop/fan modes must be normalized first. */
export function mapRHIPrimitiveTopology(mode: number): RHIPrimitiveTopology {
    if (mode === POINTS) return 'point-list';
    if (mode === LINES) return 'line-list';
    if (mode === LINE_STRIP) return 'line-strip';
    if (mode === TRIANGLES) return 'triangle-list';
    if (mode === TRIANGLE_STRIP) return 'triangle-strip';
    if (mode === LINE_LOOP || mode === TRIANGLE_FAN) {
        throw new TypeError(
            `Primitive topology ${String(mode)} must be normalized to an explicit list before RHI preparation`
        );
    }
    throw new TypeError(`Unsupported primitive topology ${String(mode)}`);
}

export function mapRHIFrontFace(frontFace: number): RHIFrontFace {
    if (frontFace === CCW) return 'ccw';
    if (frontFace === CW) return 'cw';
    throw new TypeError(`Unsupported front-face mode ${String(frontFace)}`);
}

export function mapRHICullMode(enabled: boolean, cullFaceType: number): RHICullMode {
    if (!enabled || cullFaceType === FRONT_AND_BACK) return 'none';
    if (cullFaceType === FRONT) return 'front';
    if (cullFaceType === BACK) return 'back';
    throw new TypeError(`Unsupported cull-face mode ${String(cullFaceType)}`);
}

export function mapRHICompareFunction(value: number): RHICompareFunction {
    switch (value) {
        case NEVER:
            return 'never';
        case LESS:
            return 'less';
        case EQUAL:
            return 'equal';
        case LEQUAL:
            return 'less-equal';
        case GREATER:
            return 'greater';
        case NOTEQUAL:
            return 'not-equal';
        case GEQUAL:
            return 'greater-equal';
        case ALWAYS:
            return 'always';
        default:
            throw new TypeError(`Unsupported depth comparison ${String(value)}`);
    }
}

export function mapRHIStencilOperation(value: number): RHIStencilOperation {
    switch (value) {
        case KEEP:
            return 'keep';
        case ZERO:
            return 'zero';
        case REPLACE:
            return 'replace';
        case INVERT:
            return 'invert';
        case INCR:
            return 'increment-clamp';
        case DECR:
            return 'decrement-clamp';
        case INCR_WRAP:
            return 'increment-wrap';
        case DECR_WRAP:
            return 'decrement-wrap';
        default:
            throw new TypeError(`Unsupported stencil operation ${String(value)}`);
    }
}

/** Validate the per-draw state that cannot be baked into an immutable graphics pipeline. */
export function mapRHIMeshDrawDynamicState(
    material: RHIMeshDrawMaterialState
): Readonly<RHIMeshDrawDynamicState> {
    const [minDepth, maxDepth] = material.depthRange;
    if (
        !Number.isFinite(minDepth) ||
        !Number.isFinite(maxDepth) ||
        minDepth < 0 ||
        maxDepth > 1 ||
        minDepth > maxDepth
    ) {
        throw new RangeError('depthRange must satisfy 0 <= minDepth <= maxDepth <= 1');
    }
    return Object.freeze({
        minDepth,
        maxDepth,
        stencilReference: material.stencilTest
            ? requireUInt32(material.stencilFuncRef, 'stencilFuncRef')
            : 0,
        usesStencil: material.stencilTest
    });
}

export function mapRHIBlendFactor(value: number): RHIBlendFactor {
    switch (value) {
        case ZERO:
            return 'zero';
        case ONE:
            return 'one';
        case SRC_COLOR:
            return 'src';
        case ONE_MINUS_SRC_COLOR:
            return 'one-minus-src';
        case SRC_ALPHA:
            return 'src-alpha';
        case ONE_MINUS_SRC_ALPHA:
            return 'one-minus-src-alpha';
        case DST_COLOR:
            return 'dst';
        case ONE_MINUS_DST_COLOR:
            return 'one-minus-dst';
        case DST_ALPHA:
            return 'dst-alpha';
        case ONE_MINUS_DST_ALPHA:
            return 'one-minus-dst-alpha';
        case SRC_ALPHA_SATURATE:
            return 'src-alpha-saturated';
        case CONSTANT_COLOR:
        case CONSTANT_ALPHA:
            return 'constant';
        case ONE_MINUS_CONSTANT_COLOR:
        case ONE_MINUS_CONSTANT_ALPHA:
            return 'one-minus-constant';
        default:
            throw new TypeError(`Unsupported blend factor ${String(value)}`);
    }
}

export function mapRHIBlendOperation(value: number): RHIBlendOperation {
    switch (value) {
        case FUNC_ADD:
            return 'add';
        case FUNC_SUBTRACT:
            return 'subtract';
        case FUNC_REVERSE_SUBTRACT:
            return 'reverse-subtract';
        case MIN:
            return 'min';
        case MAX:
            return 'max';
        default:
            throw new TypeError(`Unsupported blend equation ${String(value)}`);
    }
}

/** Map Material's complete portable fixed-function blend state. */
export function mapRHIDefaultBlendState(
    material: RHIMeshDrawMaterialState
): Readonly<RHIBlendState> | undefined {
    if (!material.blend) return undefined;
    return Object.freeze({
        color: Object.freeze({
            operation: mapRHIBlendOperation(material.blendEquation),
            srcFactor: mapRHIBlendFactor(material.blendSrc),
            dstFactor: mapRHIBlendFactor(material.blendDst)
        }),
        alpha: Object.freeze({
            operation: mapRHIBlendOperation(material.blendEquationAlpha),
            srcFactor: mapRHIBlendFactor(material.blendSrcAlpha),
            dstFactor: mapRHIBlendFactor(material.blendDstAlpha)
        })
    });
}

export function mapRHIDepthStencilState(
    material: RHIMeshDrawMaterialState,
    format: RHITextureFormat | null | undefined,
    depthMode: CameraDepthMode = 'standard'
): Readonly<RHIDepthStencilState> | undefined {
    mapRHIMeshDrawDynamicState(material);
    if (format === null || format === undefined) {
        if (material.depthTest || material.stencilTest) {
            throw new Error('Enabled depth or stencil testing requires a depth/stencil attachment');
        }
        return undefined;
    }
    const hasDepth = rhiTextureFormatHasDepth(format);
    const hasStencil = rhiTextureFormatHasStencil(format);
    if (material.depthTest && !hasDepth) {
        throw new TypeError(`Mesh-draw depth state requires a depth format; received ${format}`);
    }
    if (material.stencilTest && !hasStencil) {
        throw new TypeError(
            `Mesh-draw stencil state requires a stencil format; received ${format}`
        );
    }
    if (!hasDepth && !hasStencil) {
        throw new TypeError(`Mesh-draw depth/stencil state requires an attachment format`);
    }
    let stencilState: Partial<RHIDepthStencilState> = {};
    if (hasStencil) {
        if (material.stencilTest) {
            const face = Object.freeze({
                compare: mapRHICompareFunction(material.stencilFunc),
                failOp: mapRHIStencilOperation(material.stencilOpFail),
                depthFailOp: mapRHIStencilOperation(material.stencilOpZFail),
                passOp: mapRHIStencilOperation(material.stencilOpZPass)
            });
            stencilState = {
                stencilFront: face,
                stencilBack: face,
                stencilReadMask: requireUInt32(material.stencilFuncMask, 'stencilFuncMask'),
                stencilWriteMask: requireUInt32(material.stencilMask, 'stencilMask')
            };
        } else {
            stencilState = { stencilReadMask: 0xffffffff, stencilWriteMask: 0 };
        }
    }
    return Object.freeze({
        format,
        depthCompare:
            hasDepth && material.depthTest
                ? applyDepthModeToComparison(mapRHICompareFunction(material.depthFunc), depthMode)
                : 'always',
        depthWriteEnabled: hasDepth && material.depthTest && material.depthMask,
        ...stencilState
    });
}

export function mapRHIMultisampleState(
    sampleCount: number,
    sampleAlphaToCoverage: boolean
): Readonly<RHIMultisampleState> {
    if (!Number.isSafeInteger(sampleCount) || (sampleCount !== 1 && sampleCount !== 4)) {
        throw new RangeError('The first mesh-draw slice supports sample counts 1 and 4');
    }
    if (sampleAlphaToCoverage && sampleCount === 1) {
        throw new TypeError('Alpha-to-coverage requires multisampling');
    }
    return Object.freeze({
        count: sampleCount,
        mask: 0xffffffff,
        alphaToCoverageEnabled: sampleAlphaToCoverage
    });
}

/** Validate a color target layout and return its required attachment-zero format. */
export function validateRHIMeshDrawTarget(
    target: RHIMeshDrawTargetDescriptor,
    capabilities?: RHIMeshDrawTargetCapabilities
): RHITextureFormat {
    const colorFormat = validateRHIMeshDrawColorTargets(target, capabilities)[0];
    if (colorFormat === null || colorFormat === undefined) {
        throw new Error('Mesh-draw color target zero is not bound');
    }
    return colorFormat;
}

/** Validate one RHI-compatible, optionally sparse color-target array. */
export function validateRHIMeshDrawColorTargets(
    target: RHIMeshDrawTargetDescriptor,
    capabilities?: RHIMeshDrawTargetCapabilities
): readonly (RHITextureFormat | null)[] {
    if (target.colorFormats.length < 1) {
        throw new RangeError('A color mesh draw requires at least one color target');
    }
    mapRHIMultisampleState(target.sampleCount, false);

    const depthStencilFormat = target.depthStencilFormat;
    if (
        depthStencilFormat !== null &&
        depthStencilFormat !== undefined &&
        !rhiTextureFormatHasDepth(depthStencilFormat)
    ) {
        throw new TypeError(
            `Mesh-draw depth/stencil target ${depthStencilFormat} has no depth aspect`
        );
    }

    const colorFormats = new Array<RHITextureFormat | null>(target.colorFormats.length);
    let boundColorCount = 0;
    for (let index = 0; index < target.colorFormats.length; index += 1) {
        const colorFormat = target.colorFormats[index];
        if (colorFormat === null || colorFormat === undefined) {
            colorFormats[index] = null;
            continue;
        }
        boundColorCount++;
        if (rhiTextureFormatHasDepth(colorFormat) || rhiTextureFormatHasStencil(colorFormat)) {
            throw new TypeError(`Mesh-draw color target ${colorFormat} is a depth/stencil format`);
        }
        if (capabilities === undefined) {
            colorFormats[index] = colorFormat;
            continue;
        }
        const colorCapabilities = capabilities.getTextureFormatCapabilities(colorFormat);
        if (!colorCapabilities.renderable) {
            throw new TypeError(`Mesh-draw color target ${colorFormat} is not renderable`);
        }
        if (!colorCapabilities.sampleCounts.includes(target.sampleCount)) {
            throw new RangeError(
                `Mesh-draw color target ${colorFormat} does not support sample count ${String(target.sampleCount)}`
            );
        }
        colorFormats[index] = colorFormat;
    }
    if (boundColorCount === 0) {
        throw new TypeError('A color mesh draw requires at least one bound color target');
    }
    if (
        capabilities !== undefined &&
        depthStencilFormat !== null &&
        depthStencilFormat !== undefined
    ) {
        const depthCapabilities = capabilities.getTextureFormatCapabilities(depthStencilFormat);
        if (!depthCapabilities.renderable) {
            throw new TypeError(
                `Mesh-draw depth/stencil target ${depthStencilFormat} is not renderable`
            );
        }
        if (!depthCapabilities.sampleCounts.includes(target.sampleCount)) {
            throw new RangeError(
                `Mesh-draw depth/stencil target ${depthStencilFormat} does not support sample count ${String(target.sampleCount)}`
            );
        }
    }
    return Object.freeze(colorFormats);
}

/** Validate the attachment shape used by shadow/depth-only mesh pipelines. */
export function validateRHIMeshDepthOnlyTarget(
    target: RHIMeshDrawTargetDescriptor,
    capabilities?: RHIMeshDrawTargetCapabilities
): RHITextureFormat {
    if (target.colorFormats.length !== 0) {
        throw new RangeError('A depth-only mesh draw must not declare color targets');
    }
    const depthFormat = target.depthStencilFormat;
    if (depthFormat === null || depthFormat === undefined) {
        throw new TypeError('A depth-only mesh draw requires a depth target');
    }
    if (!rhiTextureFormatHasDepth(depthFormat)) {
        throw new TypeError(`Depth-only mesh target ${depthFormat} has no depth aspect`);
    }
    mapRHIMultisampleState(target.sampleCount, false);
    if (capabilities !== undefined) {
        const depthCapabilities = capabilities.getTextureFormatCapabilities(depthFormat);
        if (!depthCapabilities.renderable) {
            throw new TypeError(`Depth-only mesh target ${depthFormat} is not renderable`);
        }
        if (!depthCapabilities.sampleCounts.includes(target.sampleCount)) {
            throw new RangeError(
                `Depth-only mesh target ${depthFormat} does not support sample count ${String(target.sampleCount)}`
            );
        }
    }
    return depthFormat;
}

function createRHIPrimitiveState(
    material: RHIMeshDrawMaterialState,
    mode: number,
    stripIndexFormat?: RHIIndexFormat
): Readonly<RHIPrimitiveState> {
    const topology = mapRHIPrimitiveTopology(mode);
    const strip = topology === 'line-strip' || topology === 'triangle-strip';
    if (!strip && stripIndexFormat !== undefined) {
        throw new TypeError('stripIndexFormat is valid only for line-strip or triangle-strip');
    }
    if (material.wireframe && topology !== 'line-list') {
        throw new TypeError('Wireframe rendering requires geometry converted to a line list');
    }
    return Object.freeze({
        topology,
        ...(stripIndexFormat === undefined ? {} : { stripIndexFormat }),
        frontFace: mapRHIFrontFace(material.frontFace),
        cullMode: mapRHICullMode(material.cullFace, material.cullFaceType)
    });
}

/** Create the immutable RHI pipeline-state portion shared by both RHI backends. */
export function createRHIMeshDrawPipelineState(
    material: RHIMeshDrawMaterialState,
    mode: number,
    target: RHIMeshDrawTargetDescriptor,
    capabilities?: RHIMeshDrawTargetCapabilities,
    fragmentOutputMode: RHIMeshDrawFragmentOutputMode = 'color',
    stripIndexFormat?: RHIIndexFormat,
    fragmentOutputs?: readonly Readonly<RHIShaderFragmentOutputReflection>[],
    depthMode: CameraDepthMode = 'standard'
): Readonly<RHIMeshDrawPipelineState> {
    if (fragmentOutputMode === 'depth-only') {
        const depthFormat = validateRHIMeshDepthOnlyTarget(target, capabilities);
        const mappedDepth = mapRHIDepthStencilState(material, depthFormat, depthMode);
        if (mappedDepth === undefined) {
            throw new Error('Depth-only mesh state could not be created');
        }
        const primitive = createRHIPrimitiveState(material, mode, stripIndexFormat);
        return Object.freeze({
            primitive,
            colorTargets: Object.freeze([]),
            depthStencil: Object.freeze({
                ...mappedDepth,
                depthCompare: applyDepthModeToComparison(
                    mapRHICompareFunction(material.depthFunc),
                    depthMode
                ),
                depthWriteEnabled: true
            }),
            multisample: mapRHIMultisampleState(target.sampleCount, material.sampleAlphaToCoverage)
        });
    }
    const colorFormats = validateRHIMeshDrawColorTargets(target, capabilities);
    const blend = mapRHIDefaultBlendState(material);
    const activeFragmentOutputs =
        fragmentOutputs === undefined
            ? undefined
            : new Set(fragmentOutputs.map(output => output.location));
    if (blend !== undefined && capabilities !== undefined) {
        for (let index = 0; index < colorFormats.length; index += 1) {
            const colorFormat = colorFormats[index];
            if (colorFormat === null || colorFormat === undefined) continue;
            if (activeFragmentOutputs?.has(index) === false) continue;
            if (!capabilities.getTextureFormatCapabilities(colorFormat).blendable) {
                throw new TypeError(
                    `Mesh-draw color target ${colorFormat} does not support blending`
                );
            }
        }
    }

    const primitive = createRHIPrimitiveState(material, mode, stripIndexFormat);
    const colorTargets = Object.freeze(
        colorFormats.map((colorFormat, index) => {
            if (colorFormat === null) return null;
            const hasFragmentOutput = activeFragmentOutputs?.has(index) !== false;
            return Object.freeze({
                format: colorFormat,
                ...(hasFragmentOutput && blend !== undefined ? { blend } : {}),
                writeMask: hasFragmentOutput ? RHIColorWrite.ALL : 0
            });
        })
    );
    const depthStencil = mapRHIDepthStencilState(material, target.depthStencilFormat, depthMode);
    const multisample = mapRHIMultisampleState(target.sampleCount, material.sampleAlphaToCoverage);

    return Object.freeze({
        primitive,
        colorTargets,
        ...(depthStencil === undefined ? {} : { depthStencil }),
        multisample
    });
}
