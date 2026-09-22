import CubeTexture from '../../texture/CubeTexture';
import DataTexture from '../../texture/DataTexture';
import { LINEAR, UNSIGNED_BYTE } from '../../constants/webgl';
import { RGBA8 } from '../../constants/webgl2';
import type Texture from '../../texture/Texture';
import type Vector3 from '../../math/Vector3';

/** Static inputs for an axis-aligned local specular reflection volume. */
export interface ReflectionProbeOptions {
    /** World-space capture position, strictly inside the projection box. Copied at construction. */
    readonly position: Readonly<Vector3>;
    /** World-space minimum corner of the projection/influence box. Copied at construction. */
    readonly boxMin: Readonly<Vector3>;
    /** World-space maximum corner of the projection/influence box. Copied at construction. */
    readonly boxMax: Readonly<Vector3>;
    /** GGX-prefiltered cubemap. Omit to create a dynamic probe for ReflectionProbePipelineFactory. */
    readonly texture?: CubeTexture;
    /** Texture encoding; static RGBD inputs divide RGB by alpha. Defaults to linear. */
    readonly encoding?: 'linear' | 'rgbd';
    /** Width of the inward boundary fade in world units; defaults to 10% of the shortest side. */
    readonly blendDistance?: number;
    /** Non-negative radiance multiplier. Defaults to one. */
    readonly intensity?: number;
    /** Optional diagnostic name. */
    readonly name?: string;
}

/** Immutable publication status for a local reflection probe. */
export interface ReflectionProbeDiagnostics {
    /** Whether a complete static or submitted dynamic reflection is available. */
    readonly ready: boolean;
    /** Number of complete dynamic captures published, excluding discarded work. */
    readonly captures: number;
    /** Monotonic requested capture revision; changes only through requestUpdate(). */
    readonly requestedRevision: number;
    /** Last complete capture's requested revision. */
    readonly capturedRevision: number;
}

interface ProbeState {
    texture: Texture<unknown>;
    ready: boolean;
    revision: number;
    captures: number;
    capturedRevision: number;
    maxLod: number;
    atlasWidth: number;
    atlasHeight: number;
    owner: object | null;
}
const states = new WeakMap<ReflectionProbe, ProbeState>();
let emptyTexture: DataTexture | null = null;

function fallbackTexture(): DataTexture {
    emptyTexture ??= new DataTexture({
        image: new Uint8Array([0, 0, 0, 255]),
        width: 1,
        height: 1,
        type: UNSIGNED_BYTE,
        internalFormat: RGBA8,
        minFilter: LINEAR,
        magFilter: LINEAR
    });
    return emptyTexture;
}

function tuple(value: Readonly<Vector3>, label: string): readonly [number, number, number] {
    if (![value.x, value.y, value.z].every(Number.isFinite)) {
        throw new RangeError(`Reflection probe ${label} must be finite`);
    }
    return Object.freeze([value.x, value.y, value.z]);
}

/**
 * Bounded world-space specular probe. Materials explicitly bind at most two probes and blend them
 * per pixel. A dynamic probe belongs to one live capture runtime; authored cubemaps remain owned
 * by the application. Probe transport is independent of diffuse DDGI.
 */
export class ReflectionProbe {
    /** Diagnostic label used for capture resources. */
    readonly name: string;
    /** Copied world-space capture position, ordered X/Y/Z. */
    readonly position: readonly [number, number, number];
    /** Copied world-space minimum corner, ordered X/Y/Z. */
    readonly boxMin: readonly [number, number, number];
    /** Copied world-space maximum corner, ordered X/Y/Z. */
    readonly boxMax: readonly [number, number, number];
    /** Inward smooth boundary-fade width in world units. */
    readonly blendDistance: number;
    /** Authored radiance encoding; dynamic capture always uses linear HDR. */
    readonly encoding: 'linear' | 'rgbd';
    /** Whether this probe needs a capture runtime instead of an authored cubemap. */
    readonly dynamic: boolean;
    #intensity: number;
    #requestedRevision = 1;

    constructor(options: Readonly<ReflectionProbeOptions>) {
        this.name = options.name ?? 'ReflectionProbe';
        this.position = tuple(options.position, 'position');
        this.boxMin = tuple(options.boxMin, 'boxMin');
        this.boxMax = tuple(options.boxMax, 'boxMax');
        let shortestSide = Infinity;
        for (const axis of [0, 1, 2] as const) {
            const min = this.boxMin[axis];
            const max = this.boxMax[axis];
            if (min >= max || this.position[axis] <= min || this.position[axis] >= max) {
                throw new RangeError('Reflection probe position must be strictly inside its box');
            }
            shortestSide = Math.min(shortestSide, max - min);
        }
        this.blendDistance = options.blendDistance ?? shortestSide * 0.1;
        if (
            !Number.isFinite(this.blendDistance) ||
            this.blendDistance <= 0 ||
            this.blendDistance > shortestSide * 0.5
        ) {
            throw new RangeError(
                'Reflection probe blendDistance must be positive and at most half the shortest box side'
            );
        }
        const encoding: unknown = options.encoding ?? 'linear';
        if (encoding !== 'linear' && encoding !== 'rgbd') {
            throw new TypeError('Reflection probe encoding must be linear or rgbd');
        }
        this.encoding = encoding;
        if (options.texture !== undefined && !(options.texture instanceof CubeTexture)) {
            throw new TypeError('Static reflection probes require a CubeTexture');
        }
        this.dynamic = options.texture === undefined;
        if (this.dynamic && this.encoding !== 'linear') {
            throw new TypeError('Dynamic reflection captures use linear HDR');
        }
        this.#intensity = checkedIntensity(options.intensity ?? 1);
        states.set(this, {
            texture: options.texture ?? fallbackTexture(),
            ready: !this.dynamic,
            revision: 0,
            captures: 0,
            capturedRevision: 0,
            maxLod: Math.max(0, (options.texture?.mipmapCount ?? 1) - 1),
            atlasWidth: 1,
            atlasHeight: 1,
            owner: null
        });
    }

    /** Radiance multiplier; zero disables this probe's contribution. */
    get intensity(): number {
        return this.#intensity;
    }
    set intensity(value: number) {
        value = checkedIntensity(value);
        if (value === this.#intensity) return;
        this.#intensity = value;
        reflectionProbeState(this).revision++;
    }

    /** Request a complete new dynamic capture. In-progress captures finish before newer work. */
    requestUpdate(): void {
        if (!this.dynamic) throw new Error('Only dynamic reflection probes can request captures');
        this.#requestedRevision++;
    }

    /** Return immutable publication counters; partial captures never become ready results. */
    getDiagnostics(): Readonly<ReflectionProbeDiagnostics> {
        const state = reflectionProbeState(this);
        return Object.freeze({
            ready: state.ready,
            captures: state.captures,
            requestedRevision: this.#requestedRevision,
            capturedRevision: state.capturedRevision
        });
    }
}

function checkedIntensity(value: number): number {
    if (!Number.isFinite(value) || value < 0)
        throw new RangeError('Reflection probe intensity must be finite and non-negative');
    return value;
}

/** @internal Renderer-owned publication state; never exposed from the public barrel. */
export function reflectionProbeState(probe: ReflectionProbe): ProbeState {
    const state = states.get(probe);
    if (state === undefined) throw new TypeError('Expected a ReflectionProbe');
    return state;
}

/** @internal Invalidate GPU-only contents and restore a safe sampled binding. */
export function invalidateReflectionProbe(probe: ReflectionProbe): void {
    const state = reflectionProbeState(probe);
    state.texture = fallbackTexture();
    state.ready = false;
    state.capturedRevision = 0;
    state.revision++;
}
