import {
    CLAMP_TO_EDGE,
    MIRRORED_REPEAT,
    LINEAR,
    NEAREST,
    REPEAT,
    TEXTURE_2D
} from '../../../constants/webgl';
import type Geometry from '../../../geometry/Geometry';
import type PBRMaterial from '../../../material/PBRMaterial';
import {
    type default as Texture,
    type TextureUploadSource,
    getTextureRecoveryBacking,
    prepareTextureUpload
} from '../../../texture/Texture';
import { decalDirection, decalHandedness, decalProjectorState } from '../../decals/DecalProjector';
import { MAX_MATERIAL_DECALS } from '../../decals/DecalMaterialBinding';
import { numbersEqual } from './SceneGeometry';

/** Eight transport texture slots; specular-only maps never contribute diffuse ray radiance. */
export const RAY_TEXTURE_SLOTS = [
    'baseColor',
    'emission',
    'metallic',
    'metallicRoughness',
    'specularGlossiness',
    'opacity',
    'normal',
    'light'
] as const;
export const RAY_DECAL_OFFSET = 16 + (RAY_TEXTURE_SLOTS.length + 2) * 20;
export const RAY_MATERIAL_FLOATS = RAY_DECAL_OFFSET + MAX_MATERIAL_DECALS * 40;
export const RAY_MATERIAL_BYTES = RAY_MATERIAL_FLOATS * 4;

export interface RaySceneTexture {
    readonly texture: Texture<unknown>;
    readonly revision: number;
    readonly offset: number;
    readonly width: number;
    readonly height: number;
    /** Allocation/upload properties also invalidate atlas contents when edited directly. */
    readonly stamp: readonly number[];
    /** Actual upload-source identities, including release-safe recovery backing. */
    readonly uploadSource: Readonly<TextureUploadSource>;
}

export function sameRayTexture(a: RaySceneTexture, b: RaySceneTexture): boolean {
    return (
        a.texture === b.texture &&
        a.revision === b.revision &&
        a.offset === b.offset &&
        a.width === b.width &&
        a.height === b.height &&
        numbersEqual(a.stamp, b.stamp) &&
        a.uploadSource.image === b.uploadSource.image &&
        a.uploadSource.mipmaps === b.uploadSource.mipmaps
    );
}

function wrap(value: number): number {
    if (value === CLAMP_TO_EDGE) return 0;
    if (value === REPEAT) return 1;
    if (value === MIRRORED_REPEAT) return 2;
    throw new TypeError('DDGI transport texture has unsupported addressing');
}

const CHANNELS = ['r', 'g', 'b', 'a', 'zero', 'one'];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Candidate atlas packing is private until the complete scene validates. */
export class SceneMaterialBuilder {
    readonly textures: RaySceneTexture[] = [];
    private readonly scratch = new Float32Array(RAY_MATERIAL_FLOATS);
    private readonly offsets = new Map<Texture<unknown>, RaySceneTexture>();
    texelCount = 0;
    private readonly previous = new Map<Texture<unknown>, RaySceneTexture>();
    constructor(
        private readonly maxTexels: number,
        previous: readonly RaySceneTexture[] = []
    ) {
        for (const texture of previous) this.previous.set(texture.texture, texture);
    }

    private texture(texture: Texture<unknown>): RaySceneTexture {
        const existing = this.offsets.get(texture);
        if (existing) return existing;
        if (
            texture.target !== TEXTURE_2D ||
            texture.depth !== 1 ||
            texture.needDestroy ||
            texture.autoUpdate
        )
            throw new TypeError(
                'DDGI transport requires live revisioned 2D textures; automatic video updates require explicit texture revisions'
            );
        if (texture.magFilter !== NEAREST && texture.magFilter !== LINEAR)
            throw new TypeError(
                'DDGI transport texture magnification filter must be nearest or linear'
            );
        // Match TextureResourceCache.currentUploadIdentity: released public images must not be
        // read, and the retained source, rather than the cleared public mipmap field, is authoritative.
        const identity = getTextureRecoveryBacking(texture) ?? {
            image: texture.image,
            mipmaps: texture.mipmaps
        };
        const stamp = [
            texture.format,
            texture.internalFormat,
            texture.type,
            texture.flipY ? 1 : 0,
            texture.premultiplyAlpha ? 1 : 0,
            texture.compressed ? 1 : 0,
            texture.minFilter,
            texture.magFilter,
            texture.wrapS,
            texture.wrapT,
            texture.wrapR,
            texture.anisotropic
        ];
        const previous = this.previous.get(texture);
        const unchanged =
            previous?.revision === texture.updateRevision &&
            previous.width === texture.width &&
            previous.height === texture.height &&
            previous.uploadSource.image === identity.image &&
            previous.uploadSource.mipmaps === identity.mipmaps &&
            numbersEqual(previous.stamp, stamp);
        // A changed recipe can synchronize external-image intrinsic dimensions. Pack dimensions
        // only after that preparation; stable sources do no pixel work or per-mip validation.
        const uploadSource = unchanged ? previous.uploadSource : prepareTextureUpload(texture);
        const { width, height } = texture;
        if (
            !Number.isSafeInteger(width) ||
            !Number.isSafeInteger(height) ||
            width < 1 ||
            height < 1
        )
            throw new RangeError('DDGI texture dimensions must be positive integers');
        const count = width * height;
        if (!Number.isSafeInteger(count) || this.texelCount + count > this.maxTexels)
            throw new RangeError('DDGI texture texel budget exceeded; increase maxTextureTexels');
        const record = Object.freeze({
            texture,
            revision: texture.updateRevision,
            offset: this.texelCount,
            width,
            height,
            stamp: Object.freeze(stamp),
            uploadSource
        });
        this.texelCount += count;
        this.offsets.set(texture, record);
        this.textures.push(record);
        return record;
    }

    material(material: PBRMaterial, geometry: Geometry, sample: boolean): Float32Array {
        const data = this.scratch;
        data.fill(0);
        data.set([
            material.baseColor.r,
            material.baseColor.g,
            material.baseColor.b,
            material.baseColor.a,
            material.emissionFactor.r,
            material.emissionFactor.g,
            material.emissionFactor.b,
            material.opacity,
            material.metallic,
            material.specular.r,
            material.specular.g,
            material.specular.b,
            material.coverage.mode === 'mask' ? material.coverage.cutoff : -1,
            material.isSpecularGlossiness ? 1 : 0,
            material.normalScale,
            0
        ]);
        if (data.some(value => !Number.isFinite(value)))
            throw new RangeError('DDGI material data must be finite');
        if (!sample) return data;
        RAY_TEXTURE_SLOTS.forEach((name, index) => {
            const binding = material.getTextureSlot(name);
            if (!binding) return;
            const uvStream = binding.uvSet === 0 ? geometry.uvs : geometry.uvs1;
            if (!uvStream)
                throw new TypeError(`DDGI ${name} texture requires UV${String(binding.uvSet)}`);
            const texture = this.texture(binding.texture);
            const transform = binding.transform?.elements ?? IDENTITY;
            if (Array.from(transform).some(value => !Number.isFinite(value)))
                throw new RangeError('DDGI UV transform must be finite');
            const channels = binding.channels.map(channel => CHANNELS.indexOf(channel));
            if (channels.some(channel => channel < 0))
                throw new TypeError('DDGI texture channels must be r, g, b, a, zero or one');
            const base = 16 + index * 20;
            data.set(
                [
                    texture.offset,
                    texture.width,
                    texture.height,
                    1,
                    transform[0],
                    transform[3],
                    transform[6],
                    binding.uvSet,
                    transform[1],
                    transform[4],
                    transform[7],
                    binding.encoding === 'srgb' ? 1 : 0,
                    ...channels,
                    wrap(binding.texture.wrapS),
                    wrap(binding.texture.wrapT),
                    binding.texture.magFilter === NEAREST ? 0 : 1,
                    0
                ],
                base
            );
        });
        const decals = material.decals;
        if (decals !== null) {
            data[15] = decals.projectors.length;
            const colorAtlas = this.texture(decals.baseColorAtlas);
            const normalAtlas = decals.normalAtlas ? this.texture(decals.normalAtlas) : null;
            for (const [index, atlas] of [colorAtlas, normalAtlas].entries()) {
                if (!atlas) continue;
                data.set(
                    [
                        atlas.offset,
                        atlas.width,
                        atlas.height,
                        1,
                        1,
                        0,
                        0,
                        0,
                        0,
                        1,
                        0,
                        index === 0 && decals.baseColorEncoding === 'srgb' ? 1 : 0,
                        0,
                        1,
                        2,
                        3,
                        0,
                        0,
                        atlas.texture.magFilter === NEAREST ? 0 : 1,
                        0
                    ],
                    16 + (8 + index) * 20
                );
            }
            const projectors = [...decals.projectors].sort(
                (a, b) => decalProjectorState(a).order - decalProjectorState(b).order
            );
            for (const [index, projector] of projectors.entries()) {
                const state = decalProjectorState(projector);
                const base = RAY_DECAL_OFFSET + index * 40;
                data.set(state.inverse, base);
                data.set(state.atlasRect, base + 16);
                data.set(state.color, base + 20);
                data[base + 23] =
                    state.enabled && (state.layer & (decals.receiverMask ?? 0xffffffff)) !== 0
                        ? state.color[3] * state.opacity
                        : 0;
                data.set(
                    [...decalDirection(state.inverse, 2, 4), state.normalThreshold],
                    base + 24
                );
                data.set([...decalDirection(state.transform, 0, 1), state.normalFade], base + 28);
                data.set([state.normalScale, state.edgeFade, decalHandedness(state), 0], base + 32);
            }
        }
        if (data.some(value => !Number.isFinite(value)))
            throw new RangeError('DDGI material and UV/projector data exceed finite float32 range');
        return data;
    }
}

/** CPU oracle samples the exact GPU atlas readback, never a separately decoded image source. */
export function sampleRayMaterial(
    materials: Float32Array,
    material: number,
    slot: number,
    uv: readonly [number, number, number, number],
    texels?: Float32Array
): readonly [number, number, number, number] {
    const start = material * RAY_MATERIAL_FLOATS + 16 + slot * 20;
    const read = (index: number): number => {
        const value = materials[start + index];
        if (value === undefined) throw new RangeError('DDGI material oracle record is incomplete');
        return value;
    };
    if (read(3) < 0.5) return [1, 1, 1, 1];
    if (!texels)
        throw new Error('DDGI textured CPU oracle requires the uploaded texture atlas readback');
    const offset = read(0),
        width = read(1),
        height = read(2);
    const u = uv[read(7) === 0 ? 0 : 2],
        v = uv[read(7) === 0 ? 1 : 3];
    const x = (u * read(4) + v * read(5) + read(6)) * width;
    const y = (u * read(8) + v * read(9) + read(10)) * height;
    const address = (value: number, size: number, mode: number): number => {
        if (mode === 0) return Math.max(0, Math.min(size - 1, value));
        const period = mode === 1 ? size : size * 2;
        const wrapped = ((value % period) + period) % period;
        return mode === 2 && wrapped >= size ? period - 1 - wrapped : wrapped;
    };
    const texel = (px: number, py: number, channel: number): number => {
        const index =
            (offset + address(py, height, read(17)) * width + address(px, width, read(16))) * 4 +
            channel;
        const value = texels[index];
        if (value === undefined)
            throw new RangeError('DDGI atlas oracle is outside the uploaded texel range');
        return value;
    };
    const result = [0, 0, 0, 0];
    for (let channel = 0; channel < 4; channel++) {
        let value: number;
        if (read(18) === 0) value = texel(Math.floor(x), Math.floor(y), channel);
        else {
            const px = Math.floor(x - 0.5),
                py = Math.floor(y - 0.5);
            const fx = x - 0.5 - px,
                fy = y - 0.5 - py;
            value =
                (texel(px, py, channel) * (1 - fx) + texel(px + 1, py, channel) * fx) * (1 - fy) +
                (texel(px, py + 1, channel) * (1 - fx) + texel(px + 1, py + 1, channel) * fx) * fy;
        }
        result[channel] =
            channel < 3 && read(11) === 1
                ? value <= 0.04045
                    ? value / 12.92
                    : ((Math.max(value, 0) + 0.055) / 1.055) ** 2.4
                : value;
    }
    const mapped = [0, 1, 2, 3].map(channel => {
        const index = read(12 + channel);
        return index < 4 ? (result[index] ?? 0) : index === 5 ? 1 : 0;
    });
    return [mapped[0] ?? 0, mapped[1] ?? 0, mapped[2] ?? 0, mapped[3] ?? 0];
}
