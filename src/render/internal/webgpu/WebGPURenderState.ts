import type Material from '../../../material/Material';
import type { WebGPUFragmentOutput } from '../../shader/GlslToWgsl';
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
    ZERO
} from '../../../constants/webgl';
import { MAX, MIN } from '../../../constants/webgl2';

/** WebGPU color-write flag values, kept internal so browser runtime globals are unnecessary. */
export const WEBGPU_COLOR_WRITE = Object.freeze({
    RED: 0x1,
    GREEN: 0x2,
    BLUE: 0x4,
    ALPHA: 0x8,
    ALL: 0xf
} as const);

export type WebGPUColorMask =
    GPUColorWriteFlags | readonly [red: boolean, green: boolean, blue: boolean, alpha: boolean];

export type WebGPUMaterialRenderState = Pick<
    Material,
    | 'wireframe'
    | 'frontFace'
    | 'depthTest'
    | 'depthMask'
    | 'depthRange'
    | 'depthFunc'
    | 'cullFace'
    | 'cullFaceType'
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

export interface WebGPURenderStateOptions {
    /** One entry per fragment output location. A null entry leaves that location unbound. */
    readonly colorFormats?: readonly (GPUTextureFormat | null)[];
    /** Per-target write masks. When supplied, the length must match colorFormats exactly. */
    readonly colorMasks?: readonly WebGPUColorMask[];
    readonly depthStencilFormat?: GPUTextureFormat;
    /** False disables material depth testing when the active surface has no requested depth buffer. */
    readonly depthTestEnabled?: boolean;
    /** False disables material stencil testing when the active surface has no requested stencil buffer. */
    readonly stencilTestEnabled?: boolean;
    readonly sampleCount?: number;
    /** Required only when primitive restart is used with an indexed strip topology. */
    readonly stripIndexFormat?: GPUIndexFormat;
}

export interface WebGPUDynamicRenderState {
    /** Arguments for GPURenderPassEncoder.setViewport's minDepth and maxDepth fields. */
    readonly depthRange: readonly [minDepth: number, maxDepth: number];
    /** Argument for GPURenderPassEncoder.setStencilReference. */
    readonly stencilReference: number;
}

export interface WebGPURenderState {
    readonly primitive: GPUPrimitiveState;
    readonly colorTargets: readonly (GPUColorTargetState | null)[];
    readonly depthStencil?: GPUDepthStencilState;
    readonly multisample: GPUMultisampleState;
    readonly dynamic: WebGPUDynamicRenderState;
    /** Whether draw encoding must set the material's dynamic stencil reference. */
    readonly usesStencil: boolean;
    /** Canonical key containing every immutable render-state field. */
    readonly cacheKey: string;
}

/**
 * Map explicit GLSL fragment-output locations onto the active render-pass attachment slots.
 * Unwritten attachments stay present in the pass but are null pipeline targets, so their
 * clear/load/store operations remain authoritative without receiving shader writes.
 */
export function resolveWebGPUFragmentColorFormats(
    outputs: readonly WebGPUFragmentOutput[],
    attachmentFormats: readonly (GPUTextureFormat | null)[]
): readonly (GPUTextureFormat | null)[] {
    const result: (GPUTextureFormat | null)[] = attachmentFormats.map(() => null);
    const occupiedLocations = new Set<number>();
    for (const output of outputs) {
        if (!Number.isSafeInteger(output.location) || output.location < 0) {
            throw new RangeError(
                `Fragment output ${output.name} location must be a non-negative safe integer`
            );
        }
        if (occupiedLocations.has(output.location)) {
            throw new TypeError(
                `Fragment output location ${String(output.location)} is declared more than once`
            );
        }
        const format = attachmentFormats[output.location];
        if (format === undefined || format === null) {
            throw new RangeError(
                `Fragment output ${output.name} location ${String(output.location)} has no color attachment`
            );
        }
        occupiedLocations.add(output.location);
        result[output.location] = format;
    }
    return Object.freeze(result);
}

const depthFormats = new Set<GPUTextureFormat>([
    'depth16unorm',
    'depth24plus',
    'depth24plus-stencil8',
    'depth32float',
    'depth32float-stencil8'
]);

const stencilFormats = new Set<GPUTextureFormat>([
    'stencil8',
    'depth24plus-stencil8',
    'depth32float-stencil8'
]);

function immutable<T extends object>(value: T): T {
    return Object.freeze(value);
}

function assertUnsigned32(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${name} must be an unsigned 32-bit integer`);
    }
    return value;
}

export function mapWebGPUPrimitiveTopology(mode: GLenum): GPUPrimitiveTopology {
    switch (mode) {
        case POINTS:
            return 'point-list';
        case LINES:
            return 'line-list';
        case LINE_STRIP:
            return 'line-strip';
        case TRIANGLES:
            return 'triangle-list';
        case TRIANGLE_STRIP:
            return 'triangle-strip';
        case LINE_LOOP:
            throw new TypeError(
                'WebGPU has no LINE_LOOP topology; convert the geometry to an explicit line list'
            );
        case TRIANGLE_FAN:
            throw new TypeError(
                'WebGPU has no TRIANGLE_FAN topology; convert the geometry to an explicit triangle list'
            );
        default:
            throw new TypeError(`Unsupported geometry draw mode ${String(mode)}`);
    }
}

export function mapWebGPUFrontFace(frontFace: GLenum): GPUFrontFace {
    if (frontFace === CCW) return 'ccw';
    if (frontFace === CW) return 'cw';
    throw new TypeError(`Unsupported front-face mode ${String(frontFace)}`);
}

export function mapWebGPUCullMode(enabled: boolean, cullFaceType: GLenum): GPUCullMode {
    if (!enabled || cullFaceType === FRONT_AND_BACK) return 'none';
    if (cullFaceType === FRONT) return 'front';
    if (cullFaceType === BACK) return 'back';
    throw new TypeError(`Unsupported cull-face mode ${String(cullFaceType)}`);
}

export function mapWebGPUCompareFunction(value: GLenum): GPUCompareFunction {
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
            throw new TypeError(`Unsupported depth/stencil comparison ${String(value)}`);
    }
}

export function mapWebGPUStencilOperation(value: GLenum): GPUStencilOperation {
    switch (value) {
        case KEEP:
            return 'keep';
        case ZERO:
            return 'zero';
        case REPLACE:
            return 'replace';
        case INCR:
            return 'increment-clamp';
        case INCR_WRAP:
            return 'increment-wrap';
        case DECR:
            return 'decrement-clamp';
        case DECR_WRAP:
            return 'decrement-wrap';
        case INVERT:
            return 'invert';
        default:
            throw new TypeError(`Unsupported stencil operation ${String(value)}`);
    }
}

export function mapWebGPUBlendFactor(value: GLenum): GPUBlendFactor {
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
        case DST_ALPHA:
            return 'dst-alpha';
        case ONE_MINUS_DST_ALPHA:
            return 'one-minus-dst-alpha';
        case DST_COLOR:
            return 'dst';
        case ONE_MINUS_DST_COLOR:
            return 'one-minus-dst';
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

export function mapWebGPUBlendOperation(value: GLenum): GPUBlendOperation {
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

export function resolveWebGPUColorWriteMask(mask: WebGPUColorMask): GPUColorWriteFlags {
    if (typeof mask === 'number') {
        if (!Number.isSafeInteger(mask) || mask < 0 || (mask & ~WEBGPU_COLOR_WRITE.ALL) !== 0) {
            throw new RangeError('WebGPU color write mask contains unknown flag bits');
        }
        return mask;
    }
    const channels = mask as readonly unknown[];
    if (channels.length !== 4 || channels.some(value => typeof value !== 'boolean')) {
        throw new TypeError('WebGPU color mask must contain four boolean channels');
    }
    return (
        (channels[0] === true ? WEBGPU_COLOR_WRITE.RED : 0) |
        (channels[1] === true ? WEBGPU_COLOR_WRITE.GREEN : 0) |
        (channels[2] === true ? WEBGPU_COLOR_WRITE.BLUE : 0) |
        (channels[3] === true ? WEBGPU_COLOR_WRITE.ALPHA : 0)
    );
}

function createBlendState(material: WebGPUMaterialRenderState): GPUBlendState | undefined {
    if (!material.blend) return undefined;
    return immutable({
        color: immutable({
            srcFactor: mapWebGPUBlendFactor(material.blendSrc),
            dstFactor: mapWebGPUBlendFactor(material.blendDst),
            operation: mapWebGPUBlendOperation(material.blendEquation)
        }),
        alpha: immutable({
            srcFactor: mapWebGPUBlendFactor(material.blendSrcAlpha),
            dstFactor: mapWebGPUBlendFactor(material.blendDstAlpha),
            operation: mapWebGPUBlendOperation(material.blendEquationAlpha)
        })
    });
}

function createColorTargets(
    material: WebGPUMaterialRenderState,
    formats: readonly (GPUTextureFormat | null)[],
    masks: readonly WebGPUColorMask[] | undefined
): readonly (GPUColorTargetState | null)[] {
    if (masks && masks.length !== formats.length) {
        throw new RangeError('colorMasks length must match colorFormats length');
    }
    const blend = createBlendState(material);
    return immutable(
        formats.map((format, index) => {
            if (format === null) return null;
            const mask = masks?.[index] ?? WEBGPU_COLOR_WRITE.ALL;
            return immutable({
                format,
                ...(blend === undefined ? {} : { blend }),
                writeMask: resolveWebGPUColorWriteMask(mask)
            });
        })
    );
}

function createStencilFace(
    material: WebGPUMaterialRenderState,
    stencilTest: boolean
): GPUStencilFaceState {
    if (!stencilTest) {
        return immutable({
            compare: 'always',
            failOp: 'keep',
            depthFailOp: 'keep',
            passOp: 'keep'
        });
    }
    return immutable({
        compare: mapWebGPUCompareFunction(material.stencilFunc),
        failOp: mapWebGPUStencilOperation(material.stencilOpFail),
        depthFailOp: mapWebGPUStencilOperation(material.stencilOpZFail),
        passOp: mapWebGPUStencilOperation(material.stencilOpZPass)
    });
}

function createDepthStencilState(
    material: WebGPUMaterialRenderState,
    format: GPUTextureFormat | undefined,
    depthTestEnabled: boolean,
    stencilTestEnabled: boolean
): GPUDepthStencilState | undefined {
    const depthTest = depthTestEnabled && material.depthTest;
    const stencilTest = stencilTestEnabled && material.stencilTest;
    if (!format) {
        if (depthTest || stencilTest) {
            throw new Error('Enabled depth/stencil testing requires a depthStencilFormat');
        }
        return undefined;
    }
    const hasDepth = depthFormats.has(format);
    const hasStencil = stencilFormats.has(format);
    if (!hasDepth && !hasStencil) {
        throw new TypeError(`${format} is not a WebGPU depth/stencil format`);
    }
    if (depthTest && !hasDepth) {
        throw new Error(`Depth testing requires a depth aspect, but ${format} has none`);
    }
    if (stencilTest && !hasStencil) {
        throw new Error(`Stencil testing requires a stencil aspect, but ${format} has none`);
    }

    const result: GPUDepthStencilState = { format };
    if (hasDepth) {
        result.depthCompare = depthTest ? mapWebGPUCompareFunction(material.depthFunc) : 'always';
        result.depthWriteEnabled = depthTest && material.depthMask;
    }
    if (hasStencil) {
        const face = createStencilFace(material, stencilTest);
        result.stencilFront = face;
        result.stencilBack = face;
        result.stencilReadMask = stencilTest
            ? assertUnsigned32(material.stencilFuncMask, 'stencilFuncMask')
            : 0xffffffff;
        result.stencilWriteMask = stencilTest
            ? assertUnsigned32(material.stencilMask, 'stencilMask')
            : 0;
    }
    return immutable(result);
}

function createPrimitiveState(
    material: WebGPUMaterialRenderState,
    mode: GLenum,
    stripIndexFormat: GPUIndexFormat | undefined
): GPUPrimitiveState {
    if (material.wireframe && mode !== LINES) {
        throw new Error(
            'Wireframe rendering requires geometry converted to LINES before pipeline creation'
        );
    }
    const topology = mapWebGPUPrimitiveTopology(mode);
    const isStrip = topology === 'line-strip' || topology === 'triangle-strip';
    if (!isStrip && stripIndexFormat !== undefined) {
        throw new Error('stripIndexFormat is valid only for line-strip or triangle-strip topology');
    }
    return immutable({
        topology,
        frontFace: mapWebGPUFrontFace(material.frontFace),
        cullMode: mapWebGPUCullMode(material.cullFace, material.cullFaceType),
        ...(stripIndexFormat === undefined ? {} : { stripIndexFormat })
    });
}

function createMultisampleState(
    material: WebGPUMaterialRenderState,
    requestedSampleCount: number | undefined
): GPUMultisampleState {
    const count = requestedSampleCount ?? 1;
    if (count !== 1 && count !== 4) {
        throw new RangeError('WebGPU render sampleCount must be 1 or 4');
    }
    if (material.sampleAlphaToCoverage && count === 1) {
        throw new Error('Alpha-to-coverage requires multisampling');
    }
    return immutable({
        count,
        mask: 0xffffffff,
        alphaToCoverageEnabled: material.sampleAlphaToCoverage
    });
}

function createDynamicState(
    material: WebGPUMaterialRenderState,
    stencilTestEnabled: boolean
): WebGPUDynamicRenderState {
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
    return immutable({
        depthRange: immutable([minDepth, maxDepth] as const),
        stencilReference:
            stencilTestEnabled && material.stencilTest
                ? assertUnsigned32(material.stencilFuncRef, 'stencilFuncRef')
                : 0
    });
}

function stencilFaceKey(face: GPUStencilFaceState | undefined): string {
    return face
        ? `${face.compare ?? 'always'},${face.failOp ?? 'keep'},${face.depthFailOp ?? 'keep'},${face.passOp ?? 'keep'}`
        : 'always,keep,keep,keep';
}

function blendComponentKey(component: GPUBlendComponent): string {
    return `${component.operation ?? 'add'},${component.srcFactor ?? 'one'},${component.dstFactor ?? 'zero'}`;
}

/**
 * Build the exact immutable pipeline-state signature without reflective serialization.
 *
 * Every string field is a closed WebGPU enum and every separator is outside that vocabulary, so
 * the signature is collision-free for normalized descriptors. Defaults are folded exactly as the
 * WebGPU descriptor does. The function is exported for the device-level pipeline cache, which
 * must derive its key from the actual fields rather than trust a caller-provided cache key.
 */
export function getWebGPURenderStateCacheKey(
    primitive: GPUPrimitiveState,
    colorTargets: readonly (GPUColorTargetState | null)[],
    depthStencil: GPUDepthStencilState | undefined,
    multisample: GPUMultisampleState
): string {
    let key = `p:${primitive.topology ?? 'triangle-list'},${primitive.stripIndexFormat ?? '-'},${primitive.frontFace ?? 'ccw'},${primitive.cullMode ?? 'none'},${primitive.unclippedDepth === true ? '1' : '0'}|c:${String(colorTargets.length)}`;
    for (const target of colorTargets) {
        if (!target) {
            key += '|-';
            continue;
        }
        key += `|${target.format},${String(target.writeMask ?? WEBGPU_COLOR_WRITE.ALL)}`;
        const blend = target.blend;
        key += blend
            ? `,${blendComponentKey(blend.color)},${blendComponentKey(blend.alpha)}`
            : ',-';
    }
    if (depthStencil) {
        key += `|d:${depthStencil.format},${depthStencil.depthWriteEnabled === true ? '1' : '0'},${depthStencil.depthCompare ?? 'always'},${stencilFaceKey(depthStencil.stencilFront)},${stencilFaceKey(depthStencil.stencilBack)},${String(depthStencil.stencilReadMask ?? 0xffffffff)},${String(depthStencil.stencilWriteMask ?? 0xffffffff)},${String(depthStencil.depthBias ?? 0)},${String(depthStencil.depthBiasSlopeScale ?? 0)},${String(depthStencil.depthBiasClamp ?? 0)}`;
    } else {
        key += '|d:-';
    }
    return `${key}|m:${String(multisample.count ?? 1)},${String(multisample.mask ?? 0xffffffff)},${multisample.alphaToCoverageEnabled === true ? '1' : '0'}`;
}

/** Convert Hilo3d material and geometry state into immutable WebGPU pipeline state. */
export function createWebGPURenderState(
    material: WebGPUMaterialRenderState,
    geometryMode: GLenum,
    options: WebGPURenderStateOptions = {}
): WebGPURenderState {
    const primitive = createPrimitiveState(material, geometryMode, options.stripIndexFormat);
    const colorTargets = createColorTargets(
        material,
        options.colorFormats ?? [],
        options.colorMasks
    );
    const depthTestEnabled = options.depthTestEnabled ?? true;
    const stencilTestEnabled = options.stencilTestEnabled ?? true;
    const depthStencil = createDepthStencilState(
        material,
        options.depthStencilFormat,
        depthTestEnabled,
        stencilTestEnabled
    );
    const multisample = createMultisampleState(material, options.sampleCount);
    const dynamic = createDynamicState(material, stencilTestEnabled);
    const usesStencil = stencilTestEnabled && material.stencilTest;
    return immutable({
        primitive,
        colorTargets,
        ...(depthStencil === undefined ? {} : { depthStencil }),
        multisample,
        dynamic,
        usesStencil,
        cacheKey: getWebGPURenderStateCacheKey(primitive, colorTargets, depthStencil, multisample)
    });
}
