import Matrix4 from '../../math/Matrix4';
import Color from '../../math/Color';
import { requireNumber } from '../../math/numberArray';

/** Parameters of a bounded world-space decal, projected along its local negative Z axis. */
export interface DecalProjectorOptions {
    /** Maps the local [-0.5, 0.5] projection cube into world space. Copied; defaults to identity. */
    readonly transform?: Readonly<Matrix4>;
    /** Top-left atlas rectangle [x, y, width, height] in normalized coordinates. Defaults to full atlas. */
    readonly atlasRect?: readonly [number, number, number, number];
    /** Linear base-color multiplier; alpha also modulates opacity. Copied; defaults to white. */
    readonly color?: Readonly<Color>;
    /** Coverage multiplier in [0, 1]. Defaults to one. */
    readonly opacity?: number;
    /** Tangent-space normal strength in [0, 4]. Defaults to one. */
    readonly normalScale?: number;
    /** Roughness multiplier/constant in [0, 1]. Defaults to one. */
    readonly roughness?: number;
    /** Whether roughness is changed, even without a roughness atlas. Defaults to false. */
    readonly affectsRoughness?: boolean;
    /** Receiver material mask; a zero intersection excludes this projector. Defaults to all bits. */
    readonly layer?: number;
    /** Increasing overlap order; equal orders preserve authored membership order. Defaults to zero. */
    readonly order?: number;
    /** Minimum dot product of receiver normal and projector outward normal, in [0, 1]. Defaults to 0. */
    readonly normalThreshold?: number;
    /** Smooth angular transition above normalThreshold, in [0, 1]. Defaults to 0.1. */
    readonly normalFade?: number;
    /** Inward XY boundary fade as a fraction of projector width/height, in [0, 0.5]. Defaults to 0.01. */
    readonly edgeFade?: number;
    /** Maximum receiver distance from the camera in world units. Defaults to 10000. */
    readonly maxDistance?: number;
    /** Inward distance fade in world units. Defaults to one, clamped to maxDistance. */
    readonly distanceFade?: number;
    /** Whether the projector contributes. Defaults to true. */
    readonly enabled?: boolean;
}

/** @internal Immutable CPU snapshot; changes are published only after complete validation. */
export interface DecalProjectorState {
    readonly revision: number;
    readonly transform: readonly number[];
    readonly inverse: readonly number[];
    readonly atlasRect: readonly [number, number, number, number];
    readonly color: readonly [number, number, number, number];
    readonly opacity: number;
    readonly normalScale: number;
    readonly roughness: number;
    readonly affectsRoughness: boolean;
    readonly layer: number;
    readonly order: number;
    readonly normalThreshold: number;
    readonly normalFade: number;
    readonly edgeFade: number;
    readonly maxDistance: number;
    readonly distanceFade: number;
    readonly enabled: boolean;
}

function range(value: number, min: number, max: number, name: string): number {
    if (!Number.isFinite(value) || value < min || value > max)
        throw new RangeError(
            `Decal ${name} must be finite and in [${String(min)}, ${String(max)}]`
        );
    return value;
}

/** @internal Shared mask validation for projector and material receiver selection. */
export function decalLayerMask(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
        throw new RangeError('Decal layer mask must be an unsigned 32-bit integer');
    return value;
}

function flag(value: boolean, name: string): boolean {
    if (typeof value !== 'boolean') throw new TypeError(`Decal ${name} must be a boolean`);
    return value;
}

function snapshot(options: Readonly<DecalProjectorOptions>, revision: number): DecalProjectorState {
    const matrix = options.transform ?? new Matrix4();
    if (!(matrix instanceof Matrix4)) throw new TypeError('Decal transform must be a Matrix4');
    const transform = Array.from(matrix.elements);
    if (
        !transform.every(Number.isFinite) ||
        transform[3] !== 0 ||
        transform[7] !== 0 ||
        transform[11] !== 0 ||
        transform[15] !== 1 ||
        Math.abs(matrix.determinant()) < 1e-12
    )
        throw new RangeError('Decal transform must be finite, affine and invertible');
    const inverse = Array.from(new Matrix4().fromArray(transform).invert().elements);
    if (!inverse.every(Number.isFinite))
        throw new RangeError('Decal inverse transform must be finite');
    const rectangle = options.atlasRect ?? [0, 0, 1, 1];
    const rectangleLength: ArrayLike<number> = rectangle;
    if (rectangleLength.length !== 4)
        throw new TypeError('Decal atlasRect must contain four values');
    const atlasRect: readonly [number, number, number, number] = Object.freeze([
        range(rectangle[0], 0, 1, 'atlasRect.x'),
        range(rectangle[1], 0, 1, 'atlasRect.y'),
        range(rectangle[2], Number.EPSILON, 1, 'atlasRect.width'),
        range(rectangle[3], Number.EPSILON, 1, 'atlasRect.height')
    ]);
    if (atlasRect[0] + atlasRect[2] > 1 || atlasRect[1] + atlasRect[3] > 1)
        throw new RangeError('Decal atlasRect must fit inside the atlas');
    const tint = options.color ?? new Color(1, 1, 1, 1);
    const color: readonly [number, number, number, number] = Object.freeze([
        range(tint.r, 0, 1, 'color.r'),
        range(tint.g, 0, 1, 'color.g'),
        range(tint.b, 0, 1, 'color.b'),
        range(tint.a, 0, 1, 'color.a')
    ]);
    const order = options.order ?? 0;
    if (!Number.isSafeInteger(order)) throw new RangeError('Decal order must be a safe integer');
    const maxDistance = range(options.maxDistance ?? 10000, Number.EPSILON, 1e12, 'maxDistance');
    return Object.freeze({
        revision,
        transform: Object.freeze(transform),
        inverse: Object.freeze(inverse),
        atlasRect,
        color,
        opacity: range(options.opacity ?? 1, 0, 1, 'opacity'),
        normalScale: range(options.normalScale ?? 1, 0, 4, 'normalScale'),
        roughness: range(options.roughness ?? 1, 0, 1, 'roughness'),
        affectsRoughness: flag(options.affectsRoughness ?? false, 'affectsRoughness'),
        layer: decalLayerMask(options.layer ?? 0xffffffff),
        order,
        normalThreshold: range(options.normalThreshold ?? 0, 0, 1, 'normalThreshold'),
        normalFade: range(options.normalFade ?? 0.1, 0, 1, 'normalFade'),
        edgeFade: range(options.edgeFade ?? 0.01, 0, 0.5, 'edgeFade'),
        maxDistance,
        distanceFade: range(
            options.distanceFade ?? Math.min(1, maxDistance),
            0,
            maxDistance,
            'distanceFade'
        ),
        enabled: flag(options.enabled ?? true, 'enabled')
    });
}

/**
 * World-space PBR surface projector. Bind it through PBRMaterial.decals; it adds no scene mesh or
 * transparent draw. Updates are atomic and preserve identity across renderers and device recovery.
 */
export class DecalProjector {
    constructor(options: Readonly<DecalProjectorOptions> = {}) {
        states.set(this, snapshot(options, 0));
    }

    /** Monotonic revision of the validated projector data. */
    get revision(): number {
        return decalProjectorState(this).revision;
    }

    /** Replace selected fields, copying matrices/colors/rectangles and retaining other settings. */
    update(options: Readonly<DecalProjectorOptions>): void {
        const state = decalProjectorState(this);
        if (state.revision >= Number.MAX_SAFE_INTEGER)
            throw new RangeError('Decal revision exhausted');
        states.set(
            this,
            snapshot(
                {
                    ...state,
                    transform: new Matrix4().fromArray(state.transform),
                    color: new Color(...state.color),
                    ...options
                },
                state.revision + 1
            )
        );
    }

    /** Copy the projector's world transform into an application-owned matrix. */
    getTransform(target: Matrix4): Matrix4 {
        return target.fromArray(decalProjectorState(this).transform);
    }
}

const states = new WeakMap<DecalProjector, DecalProjectorState>();

/** @internal Stable CPU snapshot; not part of the public projector API. */
export function decalProjectorState(projector: DecalProjector): Readonly<DecalProjectorState> {
    const state = states.get(projector);
    if (state === undefined) throw new TypeError('Expected a DecalProjector');
    return state;
}

/** @internal Extract a stable direction from column-major transform data. */
export function decalDirection(
    values: readonly number[],
    start: number,
    step: number
): readonly number[] {
    const x = requireNumber(values, start);
    const y = requireNumber(values, start + step);
    const z = requireNumber(values, start + step * 2);
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
}

/** @internal Orientation of the projector XY frame relative to its outward projection normal. */
export function decalHandedness(state: Readonly<DecalProjectorState>): number {
    const m = state.transform;
    const n = state.inverse;
    const x = requireNumber(m, 1) * requireNumber(m, 6) - requireNumber(m, 2) * requireNumber(m, 5);
    const y = requireNumber(m, 2) * requireNumber(m, 4) - requireNumber(m, 0) * requireNumber(m, 6);
    const z = requireNumber(m, 0) * requireNumber(m, 5) - requireNumber(m, 1) * requireNumber(m, 4);
    return x * requireNumber(n, 2) + y * requireNumber(n, 6) + z * requireNumber(n, 10) < 0
        ? -1
        : 1;
}
