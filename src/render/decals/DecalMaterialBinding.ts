import Texture from '../../texture/Texture';
import { TEXTURE_2D } from '../../constants/webgl';
import UniformBuffer from '../UniformBuffer';
import { createStd140Layout } from '../ubo/Std140Layout';
import {
    DecalProjector,
    decalDirection,
    decalHandedness,
    decalLayerMask,
    decalProjectorState
} from './DecalProjector';

/** Bounded atlas and projector membership for one opaque PBR receiver material. */
export interface PBRDecalOptions {
    /** One to eight projectors. Membership is copied; projector data can change through update(). */
    readonly projectors: readonly DecalProjector[];
    /** Shared RGBA color atlas; alpha supplies coverage for color, normal and roughness together. */
    readonly baseColorAtlas: Texture<unknown>;
    /** Encoding of sampled RGB. Use linear for hardware-sRGB textures. Defaults to srgb. */
    readonly baseColorEncoding?: 'linear' | 'srgb';
    /** Optional tangent-space normal atlas, with the same rectangles as baseColorAtlas. */
    readonly normalAtlas?: Texture<unknown>;
    /** Optional linear roughness atlas, sampled from red; same rectangles as baseColorAtlas. */
    readonly roughnessAtlas?: Texture<unknown>;
    /** Material receiver mask intersected with each projector's layer. Defaults to all bits. */
    readonly receiverMask?: number;
}

export const MAX_MATERIAL_DECALS = 8;

/** @internal Fixed portable std140 ABI: 8 * (64 + 6 * 16) = 1280 bytes. */
export const DECAL_BLOCK_LAYOUT = createStd140Layout({
    u_decalWorldToLocal: { type: 'mat4', arrayLength: MAX_MATERIAL_DECALS },
    u_decalAtlasRect: { type: 'vec4', arrayLength: MAX_MATERIAL_DECALS },
    u_decalColor: { type: 'vec4', arrayLength: MAX_MATERIAL_DECALS },
    u_decalNormal: { type: 'vec4', arrayLength: MAX_MATERIAL_DECALS },
    u_decalTangent: { type: 'vec4', arrayLength: MAX_MATERIAL_DECALS },
    u_decalSurface: { type: 'vec4', arrayLength: MAX_MATERIAL_DECALS },
    u_decalRange: { type: 'vec4', arrayLength: MAX_MATERIAL_DECALS }
});

function atlas(value: Texture<unknown>, name: string): Texture<unknown> {
    if (!(value instanceof Texture) || value.target !== TEXTURE_2D)
        throw new TypeError(`PBR decal ${name} must be a 2D Texture`);
    return value;
}

/** @internal Material-owned CPU recipe; the normal shared resource cache owns GPU allocations. */
export class DecalMaterialBinding {
    readonly options: Readonly<PBRDecalOptions>;
    readonly #buffer = new UniformBuffer(DECAL_BLOCK_LAYOUT);
    readonly #revisions: number[];
    readonly #ordered: DecalProjector[];
    readonly #matrix = new Float32Array(MAX_MATERIAL_DECALS * 16);
    readonly #rect = new Float32Array(MAX_MATERIAL_DECALS * 4);
    readonly #color = new Float32Array(MAX_MATERIAL_DECALS * 4);
    readonly #normal = new Float32Array(MAX_MATERIAL_DECALS * 4);
    readonly #tangent = new Float32Array(MAX_MATERIAL_DECALS * 4);
    readonly #surface = new Float32Array(MAX_MATERIAL_DECALS * 4);
    readonly #range = new Float32Array(MAX_MATERIAL_DECALS * 4);

    constructor(options: Readonly<PBRDecalOptions>) {
        const candidate: unknown = options.projectors;
        if (
            !Array.isArray(candidate) ||
            options.projectors.length < 1 ||
            options.projectors.length > MAX_MATERIAL_DECALS ||
            options.projectors.some(projector => !(projector instanceof DecalProjector)) ||
            new Set(options.projectors).size !== options.projectors.length
        )
            throw new TypeError('PBR decals require one to eight distinct DecalProjector objects');
        const encoding: unknown = options.baseColorEncoding ?? 'srgb';
        if (encoding !== 'srgb' && encoding !== 'linear')
            throw new TypeError('PBR decal baseColorEncoding must be linear or srgb');
        this.options = Object.freeze({
            projectors: Object.freeze([...options.projectors]),
            baseColorAtlas: atlas(options.baseColorAtlas, 'baseColorAtlas'),
            baseColorEncoding: encoding,
            ...(options.normalAtlas === undefined
                ? {}
                : { normalAtlas: atlas(options.normalAtlas, 'normalAtlas') }),
            ...(options.roughnessAtlas === undefined
                ? {}
                : { roughnessAtlas: atlas(options.roughnessAtlas, 'roughnessAtlas') }),
            receiverMask: decalLayerMask(options.receiverMask ?? 0xffffffff)
        });
        this.#ordered = [...this.options.projectors];
        this.#revisions = this.options.projectors.map(() => -1);
    }

    get buffer(): UniformBuffer {
        let changed = false;
        for (let index = 0; index < this.options.projectors.length; index++) {
            const projector = this.options.projectors[index];
            if (projector === undefined) throw new Error('Missing decal projector');
            if (this.#revisions[index] !== projector.revision) {
                changed = true;
                this.#revisions[index] = projector.revision;
            }
        }
        if (!changed) return this.#buffer;
        // Sort authored membership afresh: equal orders must not inherit a previous sort's order.
        for (let index = 0; index < this.options.projectors.length; index++) {
            const projector = this.options.projectors[index];
            if (projector !== undefined) this.#ordered[index] = projector;
        }
        this.#ordered.sort((a, b) => decalProjectorState(a).order - decalProjectorState(b).order);
        for (let index = 0; index < this.#ordered.length; index++) {
            const projector = this.#ordered[index];
            if (projector === undefined) throw new Error('Missing decal state');
            const state = decalProjectorState(projector);
            const offset = index * 4;
            this.#matrix.set(state.inverse, index * 16);
            this.#rect.set(state.atlasRect, offset);
            this.#color.set(state.color, offset);
            this.#color[offset + 3] =
                state.color[3] *
                (state.enabled && (state.layer & (this.options.receiverMask ?? 0xffffffff)) !== 0
                    ? state.opacity
                    : 0);
            this.#normal.set(decalDirection(state.inverse, 2, 4), offset);
            this.#normal[offset + 3] = state.normalThreshold;
            this.#tangent.set(decalDirection(state.transform, 0, 1), offset);
            this.#tangent[offset + 3] = state.normalFade;
            this.#surface.set(
                [
                    state.normalScale,
                    state.roughness,
                    state.affectsRoughness || this.options.roughnessAtlas !== undefined ? 1 : 0,
                    state.edgeFade
                ],
                offset
            );
            this.#range.set(
                [state.maxDistance, state.distanceFade, decalHandedness(state), 0],
                offset
            );
        }
        this.#buffer.set('u_decalWorldToLocal', this.#matrix);
        this.#buffer.set('u_decalAtlasRect', this.#rect);
        this.#buffer.set('u_decalColor', this.#color);
        this.#buffer.set('u_decalNormal', this.#normal);
        this.#buffer.set('u_decalTangent', this.#tangent);
        this.#buffer.set('u_decalSurface', this.#surface);
        this.#buffer.set('u_decalRange', this.#range);
        return this.#buffer;
    }
}
