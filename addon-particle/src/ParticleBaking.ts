import type { RenderTargetColorAttachmentReadback, RenderTargetColorFormat } from 'hilo3d';
import type { ParticleCompiledEmitterPlan } from './ParticleCompiledPlan.js';
import type ParticleSystem from './ParticleSystem.js';
import type { ParticleSimulationSpace } from './ParticleTypes.js';
import type { ParticleCPUState } from './cpu/ParticleCPUState.js';

/** Current deterministic particle baking artifact format. */
export const PARTICLE_BAKE_VERSION = 1 as const;

/** Shared fixed-rate, half-open timeline used by particle baking. */
export interface ParticleBakeTimelineOptions {
    /** Sampled duration in seconds. */
    readonly duration: number;
    /** Samples per second. */
    readonly frameRate: number;
    /** Seconds simulated before the first captured frame. Defaults to zero. */
    readonly startTime?: number;
    /** Add one exact sample at `startTime + duration`. Defaults to false. */
    readonly includeEnd?: boolean;
    /** Safety limit for generated frames. Defaults to 4096. */
    readonly maxFrames?: number;
}

/** Options for deterministic CPU particle instance-stream baking. */
export interface ParticleMeshCacheOptions extends ParticleBakeTimelineOptions {
    /** Optional named emitter. Omit to bake every emitter containing a mesh renderer. */
    readonly emitter?: string;
    /** Safety limit across all materialized emitter/frame particle records. Defaults to 1048576. */
    readonly maxSampledParticles?: number;
}

/** One emitter's frame-major particle instance streams. */
export interface ParticleBakedMeshEmitter {
    readonly name: string;
    readonly emitterId: number;
    readonly capacity: number;
    readonly simulationSpace: ParticleSimulationSpace;
    /** Per-frame record boundaries; frame N occupies `[offsets[N], offsets[N + 1])`. */
    readonly frameOffsets: Uint32Array;
    readonly stableIds: Uint32Array;
    readonly generations: Uint32Array;
    readonly positions: Float32Array;
    readonly previousPositions: Float32Array;
    readonly velocities: Float32Array;
    readonly sizes: Float32Array;
    readonly rotations: Float32Array;
    readonly colors: Float32Array;
    readonly meshIndices: Uint32Array;
    /** Per-frame `[xMin, yMin, zMin, xMax, yMax, zMax]`, or zeros for an empty frame. */
    readonly frameBounds: Float32Array;
    readonly storageByteLength: number;
}

/** Portable frame-major instance data baked from CPU or CPU-materialized stateless simulation. */
export interface ParticleMeshCache {
    readonly version: typeof PARTICLE_BAKE_VERSION;
    readonly definitionHash: string;
    readonly seed: number;
    readonly duration: number;
    readonly frameRate: number;
    readonly startTime: number;
    readonly includeEnd: boolean;
    readonly frameCount: number;
    readonly frameTimes: Float32Array;
    readonly emitters: readonly Readonly<ParticleBakedMeshEmitter>[];
    readonly storageByteLength: number;
}

/** Context supplied to an offline flipbook renderer/readback callback. */
export interface ParticleFlipbookFrameContext {
    readonly system: ParticleSystem;
    readonly frameIndex: number;
    readonly timeSeconds: number;
}

/** Options for packing real render-target captures into one flipbook atlas. */
export interface ParticleFlipbookOptions extends ParticleBakeTimelineOptions {
    /** Render and asynchronously read one tightly packed color attachment. */
    readonly captureFrame: (
        context: Readonly<ParticleFlipbookFrameContext>
    ) => RenderTargetColorAttachmentReadback | PromiseLike<RenderTargetColorAttachmentReadback>;
    /** Atlas column count. Defaults to a near-square layout. */
    readonly columns?: number;
    /** Safety limit for either atlas dimension. Defaults to 16384. */
    readonly maxTextureSize?: number;
    /** Safety limit for the packed atlas payload. Defaults to 256 MiB. */
    readonly maxAtlasByteLength?: number;
}

/** One tightly packed native-format flipbook atlas produced from real rendered frames. */
export interface ParticleFlipbook {
    readonly version: typeof PARTICLE_BAKE_VERSION;
    readonly definitionHash: string;
    readonly seed: number;
    readonly duration: number;
    readonly frameRate: number;
    readonly startTime: number;
    readonly includeEnd: boolean;
    readonly frameCount: number;
    readonly frameTimes: Float32Array;
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly columns: number;
    readonly rows: number;
    readonly width: number;
    readonly height: number;
    readonly format: RenderTargetColorFormat;
    readonly bytesPerPixel: number;
    readonly data: Uint8Array;
    /** Top-left atlas-space `[uMin, vMin, uMax, vMax]` for each frame. */
    readonly frameUVs: Float32Array;
    readonly storageByteLength: number;
}

/** @internal */
export interface ParticleBakeTimeline {
    readonly duration: number;
    readonly frameRate: number;
    readonly startTime: number;
    readonly includeEnd: boolean;
    readonly times: readonly number[];
    readonly frameTimes: Float32Array;
}

function requireFiniteNonNegative(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be finite and non-negative`);
    }
    return value;
}

function requirePositive(value: number, label: string): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be finite and positive`);
    }
    return value;
}

function requirePositiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
    return value;
}

/** @internal */
export function createParticleBakeTimeline(
    options: Readonly<ParticleBakeTimelineOptions>
): Readonly<ParticleBakeTimeline> {
    const duration = requirePositive(options.duration, 'Particle bake duration');
    const frameRate = requirePositive(options.frameRate, 'Particle bake frame rate');
    const startTime = requireFiniteNonNegative(options.startTime ?? 0, 'Particle bake start time');
    const maxFrames = requirePositiveSafeInteger(
        options.maxFrames ?? 4096,
        'Particle bake maximum frame count'
    );
    if (!Number.isFinite(startTime + duration)) {
        throw new RangeError('Particle bake timeline end must be finite');
    }
    const regularFrameCount = Math.max(1, Math.ceil(duration * frameRate - 1e-9));
    const frameCount = regularFrameCount + (options.includeEnd === true ? 1 : 0);
    if (!Number.isSafeInteger(frameCount) || frameCount > maxFrames) {
        throw new RangeError(
            `Particle bake frame count ${String(frameCount)} exceeds limit ${String(maxFrames)}`
        );
    }
    const times: number[] = [];
    for (let index = 0; index < regularFrameCount; index += 1) {
        times.push(startTime + index / frameRate);
    }
    if (options.includeEnd === true) times.push(startTime + duration);
    return Object.freeze({
        duration,
        frameRate,
        startTime,
        includeEnd: options.includeEnd === true,
        times: Object.freeze(times),
        frameTimes: Float32Array.from(times, value => Math.fround(value))
    });
}

function appendVector(
    values: number[],
    source: Float32Array,
    offset: number,
    components: number
): void {
    for (let component = 0; component < components; component += 1) {
        values.push(source[offset + component] ?? 0);
    }
}

/** Accumulates one stable-ID-sorted frame-major mesh emitter stream. @internal */
export class ParticleMeshCacheBuilder {
    readonly #plan: Readonly<ParticleCompiledEmitterPlan>;
    readonly #frameOffsets: number[] = [0];
    readonly #stableIds: number[] = [];
    readonly #generations: number[] = [];
    readonly #positions: number[] = [];
    readonly #previousPositions: number[] = [];
    readonly #velocities: number[] = [];
    readonly #sizes: number[] = [];
    readonly #rotations: number[] = [];
    readonly #colors: number[] = [];
    readonly #meshIndices: number[] = [];
    readonly #frameBounds: number[] = [];

    constructor(plan: Readonly<ParticleCompiledEmitterPlan>) {
        if (!plan.definition.renderers.some(renderer => renderer.type === 'mesh')) {
            throw new TypeError(
                `Particle emitter ${plan.definition.name} has no mesh renderer to bake`
            );
        }
        this.#plan = plan;
    }

    append(state: ParticleCPUState): number {
        const required = [
            'stable-id',
            'generation',
            'position',
            'previous-position',
            'velocity',
            'size',
            'rotation',
            'color',
            'mesh-index'
        ] as const;
        for (const name of required) {
            if (!state.has(name)) {
                throw new TypeError(
                    `Particle mesh cache attribute ${name} is unavailable for ${this.#plan.definition.name}`
                );
            }
        }
        const stableIds = state.u32('stable-id');
        const generations = state.u32('generation');
        const positions = state.f32('position');
        const previousPositions = state.f32('previous-position');
        const velocities = state.f32('velocity');
        const sizes = state.f32('size');
        const rotations = state.f32('rotation');
        const colors = state.f32('color');
        const meshIndices = state.u32('mesh-index');
        const indices = Array.from({ length: state.aliveCount }, (_value, index) => index);
        indices.sort((left, right) => {
            const generationDifference = (generations[left] ?? 0) - (generations[right] ?? 0);
            return generationDifference !== 0
                ? generationDifference
                : (stableIds[left] ?? 0) - (stableIds[right] ?? 0);
        });
        let xMin = Number.POSITIVE_INFINITY;
        let yMin = Number.POSITIVE_INFINITY;
        let zMin = Number.POSITIVE_INFINITY;
        let xMax = Number.NEGATIVE_INFINITY;
        let yMax = Number.NEGATIVE_INFINITY;
        let zMax = Number.NEGATIVE_INFINITY;
        for (const index of indices) {
            const offset3 = index * 3;
            const offset4 = index * 4;
            const size = sizes[index] ?? 1;
            const radius = size * 0.5;
            const x = positions[offset3] ?? 0;
            const y = positions[offset3 + 1] ?? 0;
            const z = positions[offset3 + 2] ?? 0;
            this.#stableIds.push(stableIds[index] ?? 0);
            this.#generations.push(generations[index] ?? 0);
            appendVector(this.#positions, positions, offset3, 3);
            appendVector(this.#previousPositions, previousPositions, offset3, 3);
            appendVector(this.#velocities, velocities, offset3, 3);
            this.#sizes.push(size);
            this.#rotations.push(rotations[index] ?? 0);
            appendVector(this.#colors, colors, offset4, 4);
            this.#meshIndices.push(meshIndices[index] ?? 0);
            xMin = Math.min(xMin, x - radius);
            yMin = Math.min(yMin, y - radius);
            zMin = Math.min(zMin, z - radius);
            xMax = Math.max(xMax, x + radius);
            yMax = Math.max(yMax, y + radius);
            zMax = Math.max(zMax, z + radius);
        }
        if (indices.length === 0) {
            this.#frameBounds.push(0, 0, 0, 0, 0, 0);
        } else {
            this.#frameBounds.push(xMin, yMin, zMin, xMax, yMax, zMax);
        }
        this.#frameOffsets.push(this.#stableIds.length);
        return indices.length;
    }

    finish(): Readonly<ParticleBakedMeshEmitter> {
        const frameOffsets = Uint32Array.from(this.#frameOffsets);
        const stableIds = Uint32Array.from(this.#stableIds);
        const generations = Uint32Array.from(this.#generations);
        const positions = Float32Array.from(this.#positions, value => Math.fround(value));
        const previousPositions = Float32Array.from(this.#previousPositions, value =>
            Math.fround(value)
        );
        const velocities = Float32Array.from(this.#velocities, value => Math.fround(value));
        const sizes = Float32Array.from(this.#sizes, value => Math.fround(value));
        const rotations = Float32Array.from(this.#rotations, value => Math.fround(value));
        const colors = Float32Array.from(this.#colors, value => Math.fround(value));
        const meshIndices = Uint32Array.from(this.#meshIndices);
        const frameBounds = Float32Array.from(this.#frameBounds, value => Math.fround(value));
        const storageByteLength =
            frameOffsets.byteLength +
            stableIds.byteLength +
            generations.byteLength +
            positions.byteLength +
            previousPositions.byteLength +
            velocities.byteLength +
            sizes.byteLength +
            rotations.byteLength +
            colors.byteLength +
            meshIndices.byteLength +
            frameBounds.byteLength;
        return Object.freeze({
            name: this.#plan.definition.name,
            emitterId: this.#plan.emitterId,
            capacity: this.#plan.definition.capacity,
            simulationSpace: this.#plan.definition.simulationSpace,
            frameOffsets,
            stableIds,
            generations,
            positions,
            previousPositions,
            velocities,
            sizes,
            rotations,
            colors,
            meshIndices,
            frameBounds,
            storageByteLength
        });
    }
}

/** @internal */
export function createParticleMeshCache(
    definitionHash: string,
    seed: number,
    timeline: Readonly<ParticleBakeTimeline>,
    emitters: readonly Readonly<ParticleBakedMeshEmitter>[]
): Readonly<ParticleMeshCache> {
    const storageByteLength =
        timeline.frameTimes.byteLength +
        emitters.reduce((total, emitter) => total + emitter.storageByteLength, 0);
    return Object.freeze({
        version: PARTICLE_BAKE_VERSION,
        definitionHash,
        seed,
        duration: timeline.duration,
        frameRate: timeline.frameRate,
        startTime: timeline.startTime,
        includeEnd: timeline.includeEnd,
        frameCount: timeline.times.length,
        frameTimes: timeline.frameTimes,
        emitters: Object.freeze([...emitters]),
        storageByteLength
    });
}

function validateFlipbookFrame(
    frame: Readonly<RenderTargetColorAttachmentReadback>,
    first?: Readonly<RenderTargetColorAttachmentReadback>
): void {
    if (
        !Number.isSafeInteger(frame.width) ||
        frame.width <= 0 ||
        !Number.isSafeInteger(frame.height) ||
        frame.height <= 0 ||
        !Number.isSafeInteger(frame.bytesPerPixel) ||
        frame.bytesPerPixel <= 0 ||
        frame.bytesPerRow !== frame.width * frame.bytesPerPixel ||
        frame.data.length !== frame.bytesPerRow * frame.height
    ) {
        throw new TypeError('Particle flipbook capture must be a tightly packed color readback');
    }
    if (
        first !== undefined &&
        (frame.width !== first.width ||
            frame.height !== first.height ||
            frame.format !== first.format ||
            frame.bytesPerPixel !== first.bytesPerPixel)
    ) {
        throw new TypeError('Particle flipbook frames must use one extent and color format');
    }
}

/** Pack validated real render-target readbacks into a row-major atlas. @internal */
export function createParticleFlipbook(
    definitionHash: string,
    seed: number,
    timeline: Readonly<ParticleBakeTimeline>,
    frames: readonly Readonly<RenderTargetColorAttachmentReadback>[],
    options: Readonly<
        Pick<ParticleFlipbookOptions, 'columns' | 'maxTextureSize' | 'maxAtlasByteLength'>
    >
): Readonly<ParticleFlipbook> {
    if (frames.length !== timeline.times.length || frames.length === 0) {
        throw new RangeError('Particle flipbook capture count does not match its timeline');
    }
    const first = frames[0];
    if (first === undefined) throw new Error('Particle flipbook first frame is unavailable');
    validateFlipbookFrame(first);
    for (const frame of frames) validateFlipbookFrame(frame, first);
    const columns = requirePositiveSafeInteger(
        options.columns ?? Math.ceil(Math.sqrt(frames.length)),
        'Particle flipbook column count'
    );
    if (columns > frames.length) {
        throw new RangeError('Particle flipbook column count cannot exceed its frame count');
    }
    const rows = Math.ceil(frames.length / columns);
    const width = first.width * columns;
    const height = first.height * rows;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
        throw new RangeError('Particle flipbook atlas extent exceeds the safe integer range');
    }
    const maxTextureSize = requirePositiveSafeInteger(
        options.maxTextureSize ?? 16_384,
        'Particle flipbook maximum texture size'
    );
    if (width > maxTextureSize || height > maxTextureSize) {
        throw new RangeError(
            `Particle flipbook atlas ${String(width)}x${String(height)} exceeds ${String(maxTextureSize)}`
        );
    }
    const byteLength = width * height * first.bytesPerPixel;
    if (!Number.isSafeInteger(byteLength)) {
        throw new RangeError('Particle flipbook atlas byte length exceeds the safe integer range');
    }
    const maxAtlasByteLength = requirePositiveSafeInteger(
        options.maxAtlasByteLength ?? 268_435_456,
        'Particle flipbook maximum atlas byte length'
    );
    if (byteLength > maxAtlasByteLength) {
        throw new RangeError(
            `Particle flipbook atlas byte length ${String(byteLength)} exceeds ${String(maxAtlasByteLength)}`
        );
    }
    const data = new Uint8Array(byteLength);
    const frameUVs = new Float32Array(frames.length * 4);
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        const frame = frames[frameIndex];
        if (frame === undefined) throw new Error('Particle flipbook frame is unavailable');
        const column = frameIndex % columns;
        const row = Math.floor(frameIndex / columns);
        for (let y = 0; y < first.height; y += 1) {
            const sourceOffset = y * frame.bytesPerRow;
            const destinationOffset =
                ((row * first.height + y) * width + column * first.width) * first.bytesPerPixel;
            data.set(
                frame.data.subarray(sourceOffset, sourceOffset + frame.bytesPerRow),
                destinationOffset
            );
        }
        const uvOffset = frameIndex * 4;
        frameUVs[uvOffset] = column / columns;
        frameUVs[uvOffset + 1] = row / rows;
        frameUVs[uvOffset + 2] = (column + 1) / columns;
        frameUVs[uvOffset + 3] = (row + 1) / rows;
    }
    return Object.freeze({
        version: PARTICLE_BAKE_VERSION,
        definitionHash,
        seed,
        duration: timeline.duration,
        frameRate: timeline.frameRate,
        startTime: timeline.startTime,
        includeEnd: timeline.includeEnd,
        frameCount: timeline.times.length,
        frameTimes: timeline.frameTimes,
        frameWidth: first.width,
        frameHeight: first.height,
        columns,
        rows,
        width,
        height,
        format: first.format,
        bytesPerPixel: first.bytesPerPixel,
        data,
        frameUVs,
        storageByteLength: timeline.frameTimes.byteLength + data.byteLength + frameUVs.byteLength
    });
}
