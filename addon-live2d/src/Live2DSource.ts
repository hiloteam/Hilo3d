/** Fixed-function blend modes supported by the portable Live2D renderer. */
export type Live2DBlendMode = 'normal' | 'additive' | 'multiply';

/** One drawable in Core model coordinates. Buffers remain owned by the source. */
export interface Live2DDrawable {
    /** Stable model-local identity. */
    id: string;
    /** Interleaved XY positions in Cubism model units, with positive Y upwards. */
    positions: Float32Array;
    /** Fixed interleaved Cubism UVs, with V=0 at the bottom of an image. */
    uvs: Float32Array;
    /** Fixed triangle topology for the lifetime of a source. */
    indices: Uint16Array;
    /** Fixed texture slot for the lifetime of a source. */
    textureIndex: number;
    /** Current drawable opacity in the inclusive range zero to one. */
    opacity: number;
    /** Current model-local drawing order; smaller values draw first. */
    renderOrder: number;
    /** Whether this drawable participates in the model's color rendering. */
    visible: boolean;
    /** Fixed culling policy for the lifetime of a source. */
    doubleSided: boolean;
    /** Fixed blend policy for the lifetime of a source. */
    blendMode: Live2DBlendMode;
    /** Fixed source drawable indices forming this drawable's clipping mask. */
    masks: readonly number[];
    /** Use the complement of the clipping mask when true. */
    invertedMask: boolean;
    /** RGBA multiplier. The renderer consumes RGB; alpha is reserved by Cubism. */
    multiplyColor: Float32Array;
    /** RGBA screen color. The renderer consumes RGB; alpha is reserved by Cubism. */
    screenColor: Float32Array;
}

/** SDK-independent model data consumed by Live2D rendering. */
export interface Live2DSource {
    /** Optional animated model opacity, multiplied by node and drawable opacity. */
    readonly modelOpacity?: number;
    /**
     * Fixed drawable identities and array order, with frame properties mutated in place.
     * Custom sources must preserve UV/index values, mask membership and material policy.
     * Create a new source/node when these fixed properties change.
     */
    readonly drawables: readonly Live2DDrawable[];
    /** Refresh frame data after the application updates its Cubism Core/Framework model. */
    sync(): void;
}

/** Minimal structural view of Core drawable buffers; no SDK runtime is bundled. */
export interface CubismCoreDrawables {
    /** Number of drawable entries in the model. */
    readonly count: number;
    /** Stable model-local drawable identifiers. */
    readonly ids: readonly string[];
    /** Per-drawable blend, culling and mask flags interpreted by Core utilities. */
    readonly constantFlags: Uint8Array;
    /** Per-drawable current visibility and frame-change flags. */
    readonly dynamicFlags: Uint8Array;
    /** Texture slot assigned to each drawable. */
    readonly textureIndices: Int32Array;
    /** Current drawable opacities computed by Core. */
    readonly opacities: Float32Array;
    /** Number of clipping-mask source drawables for each drawable. */
    readonly maskCounts: Int32Array;
    /** Model-local source drawable indices for each clipping mask. */
    readonly masks: readonly Int32Array[];
    /** Number of vertices in each drawable. */
    readonly vertexCounts: Int32Array;
    /** Live interleaved XY positions for each drawable, in model coordinates. */
    readonly vertexPositions: readonly Float32Array[];
    /** Fixed interleaved UV coordinates for each drawable, with bottom-left origin. */
    readonly vertexUvs: readonly Float32Array[];
    /** Number of triangle indices in each drawable. */
    readonly indexCounts: Int32Array;
    /** Fixed triangle indices for each drawable. */
    readonly indices: readonly Uint16Array[];
    /** Packed RGBA multiply colors, four components per drawable. */
    readonly multiplyColors: Float32Array;
    /** Packed RGBA screen colors, four components per drawable. */
    readonly screenColors: Float32Array;
    /** Render orders exposed by Core versions before the combined object-order API. */
    readonly renderOrders?: Int32Array;
    /** Packed Cubism 5.3 color/alpha blend modes, when supplied by Core. */
    readonly blendModes?: Int32Array;
}

/** Caller-owned Core model, or an object exposing equivalent live drawable buffers. */
export interface CubismCoreModel {
    /** Drawable buffers owned by the application's initialized Core model. */
    readonly drawables: CubismCoreDrawables;
    /** Cubism 5.3 grouped offscreen composition is rejected by this adapter. */
    readonly offscreens?: {
        /** Number of grouped offscreen objects; must be zero for this adapter. */
        readonly count: number;
    };
    /** Combined object render orders supplied by Cubism 5.3 and later. */
    getRenderOrders?(): Int32Array;
}

/** Flag predicates supplied by the application's initialized Core SDK. */
export interface CubismCoreUtils {
    /** Test whether constant flags select the compatible additive blend mode. */
    hasBlendAdditiveBit(flags: number): boolean;
    /** Test whether constant flags select the compatible multiply blend mode. */
    hasBlendMultiplicativeBit(flags: number): boolean;
    /** Test whether constant flags disable back-face culling. */
    hasIsDoubleSidedBit(flags: number): boolean;
    /** Test whether constant flags select inverted clipping coverage. */
    hasIsInvertedMaskBit(flags: number): boolean;
    /** Test the persistent visible bit in a drawable's dynamic flags. */
    hasIsVisibleBit(flags: number): boolean;
}

function at<T>(values: ArrayLike<T>, index: number): T {
    const value = values[index];
    if (value === undefined) throw new Error(`Missing Live2D value at index ${String(index)}`);
    return value;
}

function requireCount(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Live2D ${label} must be a non-negative integer`);
    }
}

function requireLength(value: ArrayLike<unknown>, expected: number, label: string): void {
    if (value.length !== expected) {
        throw new Error(
            `Live2D ${label} length must be ${String(expected)}, received ${String(value.length)}`
        );
    }
}

function requireFinite(values: Float32Array, label: string): void {
    for (const value of values) {
        if (!Number.isFinite(value)) throw new Error(`Live2D ${label} contains a non-finite value`);
    }
}

function requireUnit(value: number, label: string): void {
    // Authored interpolation and Core Float32 evaluation can slightly exceed endpoints:
    // official Haru 5-r.5 starts at 1.0000499486923218. Normalize errors within 0.01%;
    // keep larger out-of-range values and non-finite model data explicit failures.
    if (!Number.isFinite(value) || value < -1e-4 || value > 1 + 1e-4) {
        throw new Error(`Live2D ${label} must be in [0, 1], received ${String(value)}`);
    }
}

function opacity(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function blendMode(
    data: CubismCoreDrawables,
    index: number,
    utils: CubismCoreUtils
): Live2DBlendMode {
    const packed = data.blendModes?.[index];
    if (packed !== undefined) {
        // Core's packed values 0/1/2 are NormalOver/AddCompatible/MultiplyCompatible.
        // Other values require destination sampling or grouped offscreen composition.
        if (packed === 0) return 'normal';
        if (packed === 1) return 'additive';
        if (packed === 2) return 'multiply';
        throw new Error(
            `Live2D drawable ${String(index)} uses unsupported Cubism 5.3 blend mode ${String(packed)}`
        );
    }
    const flags = at(data.constantFlags, index);
    if (utils.hasBlendAdditiveBit(flags)) return 'additive';
    if (utils.hasBlendMultiplicativeBit(flags)) return 'multiply';
    return 'normal';
}

function validateModel(model: CubismCoreModel, utils: CubismCoreUtils): Int32Array {
    const data = model.drawables;
    requireCount(data.count, 'drawable count');
    if (model.offscreens !== undefined) {
        requireCount(model.offscreens.count, 'offscreen count');
        if (model.offscreens.count !== 0) {
            throw new Error('Live2D Cubism 5.3 grouped offscreen composition is not supported');
        }
    }
    const orders = model.getRenderOrders?.() ?? data.renderOrders;
    if (orders === undefined) throw new Error('Live2D Core model does not expose render orders');
    requireLength(orders, data.count, 'render orders');
    requireLength(data.ids, data.count, 'drawable IDs');
    requireLength(data.constantFlags, data.count, 'constant flags');
    requireLength(data.dynamicFlags, data.count, 'dynamic flags');
    requireLength(data.textureIndices, data.count, 'texture indices');
    requireLength(data.opacities, data.count, 'opacities');
    requireLength(data.maskCounts, data.count, 'mask counts');
    requireLength(data.masks, data.count, 'masks');
    requireLength(data.vertexCounts, data.count, 'vertex counts');
    requireLength(data.vertexPositions, data.count, 'positions');
    requireLength(data.vertexUvs, data.count, 'UVs');
    requireLength(data.indexCounts, data.count, 'index counts');
    requireLength(data.indices, data.count, 'indices');
    requireLength(data.multiplyColors, data.count * 4, 'multiply colors');
    requireLength(data.screenColors, data.count * 4, 'screen colors');
    requireFinite(data.multiplyColors, 'multiply colors');
    requireFinite(data.screenColors, 'screen colors');
    // Core 5.3 can expose a capacity-sized blend buffer (two entries per drawable).
    // The SDK indexes the packed mode at drawableIndex; trailing capacity is not model data.
    if (data.blendModes !== undefined && data.blendModes.length < data.count) {
        throw new Error('Live2D blend modes buffer is shorter than the drawable count');
    }
    for (let index = 0; index < data.count; index++) {
        const vertices = at(data.vertexCounts, index);
        const indices = at(data.indices, index);
        const masks = at(data.masks, index);
        const id = at(data.ids, index);
        if (id.length === 0) throw new Error(`Live2D drawable ${String(index)} has an empty ID`);
        requireCount(vertices, 'drawable vertex count');
        requireCount(at(data.indexCounts, index), 'drawable index count');
        requireCount(at(data.textureIndices, index), 'drawable texture index');
        requireCount(at(data.maskCounts, index), 'drawable mask count');
        requireLength(at(data.vertexPositions, index), vertices * 2, 'drawable positions');
        requireLength(at(data.vertexUvs, index), vertices * 2, 'drawable UVs');
        requireLength(indices, at(data.indexCounts, index), 'drawable indices');
        requireLength(masks, at(data.maskCounts, index), 'drawable masks');
        requireFinite(at(data.vertexPositions, index), 'drawable positions');
        requireFinite(at(data.vertexUvs, index), 'drawable UVs');
        requireUnit(at(data.opacities, index), 'drawable opacity');
        if (indices.length % 3 !== 0)
            throw new Error(`Live2D drawable ${String(index)} must contain triangles`);
        for (const vertex of indices) {
            if (vertex >= vertices)
                throw new Error(`Live2D drawable ${String(index)} has an invalid vertex index`);
        }
        for (const mask of masks) {
            if (mask < 0 || mask >= data.count || mask === index) {
                throw new Error(
                    `Live2D drawable ${String(index)} has an invalid mask reference ${String(mask)}`
                );
            }
        }
        blendMode(data, index, utils);
    }
    return orders;
}

/**
 * Adapt a caller-owned Core model without loading, updating, or destroying the SDK.
 * Call `sync()` after Framework/Core updates. Change flags are deliberately ignored because
 * Framework may reset them before rendering; visibility is read from the persistent visible bit.
 * Topology must stay fixed for the lifetime of a source. Unsupported Cubism 5.3 composition fails
 * immediately instead of silently producing an approximation.
 */
export function createCubismCoreSource(
    model: CubismCoreModel,
    utils: CubismCoreUtils
): Live2DSource {
    const orders = validateModel(model, utils);
    const ids = new Set<string>();
    const data = model.drawables;
    const drawables: Live2DDrawable[] = data.ids.map((id, index) => {
        if (ids.has(id)) throw new Error(`Live2D duplicate drawable ID ${id}`);
        ids.add(id);
        const flags = at(data.constantFlags, index);
        return {
            id,
            positions: at(data.vertexPositions, index),
            uvs: at(data.vertexUvs, index),
            indices: at(data.indices, index),
            textureIndex: at(data.textureIndices, index),
            opacity: opacity(at(data.opacities, index)),
            renderOrder: at(orders, index),
            visible: utils.hasIsVisibleBit(at(data.dynamicFlags, index)),
            doubleSided: utils.hasIsDoubleSidedBit(flags),
            blendMode: blendMode(data, index, utils),
            masks: Object.freeze(Array.from(at(data.masks, index))),
            invertedMask: utils.hasIsInvertedMaskBit(flags),
            multiplyColor: data.multiplyColors.subarray(index * 4, index * 4 + 4),
            screenColor: data.screenColors.subarray(index * 4, index * 4 + 4)
        };
    });
    const topology = drawables.map(drawable => ({
        uvs: drawable.uvs.slice(),
        indices: drawable.indices.slice(),
        textureIndex: drawable.textureIndex,
        blendMode: drawable.blendMode,
        doubleSided: drawable.doubleSided
    }));
    return {
        drawables,
        sync(): void {
            const current = model.drawables;
            if (current.count !== drawables.length)
                throw new Error('Live2D drawable topology changed');
            const currentOrders = validateModel(model, utils);
            for (let index = 0; index < drawables.length; index++) {
                const drawable = at(drawables, index);
                const initial = at(topology, index);
                const flags = at(current.constantFlags, index);
                if (
                    current.ids[index] !== drawable.id ||
                    at(current.vertexPositions, index).length !== drawable.positions.length ||
                    at(current.indices, index).length !== drawable.indices.length ||
                    at(current.masks, index).length !== drawable.masks.length
                ) {
                    throw new Error(`Live2D drawable ${String(index)} topology changed`);
                }
                if (
                    at(current.textureIndices, index) !== initial.textureIndex ||
                    blendMode(current, index, utils) !== initial.blendMode ||
                    utils.hasIsDoubleSidedBit(flags) !== initial.doubleSided
                ) {
                    throw new Error(
                        `Live2D drawable ${String(index)} fixed material policy changed`
                    );
                }
                const uvs = at(current.vertexUvs, index);
                for (let offset = 0; offset < initial.uvs.length; offset++) {
                    if (uvs[offset] !== initial.uvs[offset]) {
                        throw new Error(`Live2D drawable ${String(index)} UV topology changed`);
                    }
                }
                const indices = at(current.indices, index);
                for (let offset = 0; offset < initial.indices.length; offset++) {
                    if (indices[offset] !== initial.indices[offset]) {
                        throw new Error(`Live2D drawable ${String(index)} index topology changed`);
                    }
                }
                for (let offset = 0; offset < drawable.masks.length; offset++) {
                    if (at(current.masks, index)[offset] !== drawable.masks[offset]) {
                        throw new Error(`Live2D drawable ${String(index)} mask topology changed`);
                    }
                }
            }
            for (let index = 0; index < drawables.length; index++) {
                const drawable = at(drawables, index);
                const flags = at(current.constantFlags, index);
                drawable.positions = at(current.vertexPositions, index);
                drawable.uvs = at(current.vertexUvs, index);
                drawable.indices = at(current.indices, index);
                drawable.textureIndex = at(current.textureIndices, index);
                drawable.opacity = opacity(at(current.opacities, index));
                drawable.renderOrder = at(currentOrders, index);
                drawable.visible = utils.hasIsVisibleBit(at(current.dynamicFlags, index));
                drawable.doubleSided = utils.hasIsDoubleSidedBit(flags);
                drawable.invertedMask = utils.hasIsInvertedMaskBit(flags);
                drawable.blendMode = blendMode(current, index, utils);
                if (
                    drawable.multiplyColor.buffer !== current.multiplyColors.buffer ||
                    drawable.multiplyColor.byteOffset !==
                        current.multiplyColors.byteOffset + index * 16
                ) {
                    drawable.multiplyColor = current.multiplyColors.subarray(
                        index * 4,
                        index * 4 + 4
                    );
                }
                if (
                    drawable.screenColor.buffer !== current.screenColors.buffer ||
                    drawable.screenColor.byteOffset !== current.screenColors.byteOffset + index * 16
                ) {
                    drawable.screenColor = current.screenColors.subarray(index * 4, index * 4 + 4);
                }
            }
        }
    };
}
