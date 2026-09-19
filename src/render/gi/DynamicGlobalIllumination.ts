import Color from '../../math/Color';
import Vector3 from '../../math/Vector3';
import DirectionalLight from '../../light/DirectionalLight';
import SpotLight from '../../light/SpotLight';
import type PointLight from '../../light/PointLight';
import AreaLight from '../../light/AreaLight';
import ComputeKernel from '../compute/ComputeKernel';
import type { StorageBuffer } from '../StorageBuffer';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../pipeline/RenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import {
    ComputeRenderPass,
    type ComputeRenderPassParameters
} from '../pipeline/passes/ComputeRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureHandle,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from '../pipeline/ScriptableRenderGraph';
import type { RayTracingSceneSnapshot, RayTracingSceneDirtyRange } from './RayTracingScene';
import {
    createDynamicGlobalIlluminationShader,
    DDGI_HEADER_VEC4S,
    DDGI_PROBE_BYTES,
    DDGI_GLSL_SAMPLING_SOURCE
} from './DynamicGIShaders';

export { DDGI_GLSL_SAMPLING_SOURCE, createDynamicGlobalIlluminationShader };

/** WebGPU dynamic diffuse global illumination using a bounded world-space probe volume. */
export interface DynamicGlobalIlluminationOptions {
    /** Position of the first probe. Defaults to (-4, 0, -4). */
    readonly origin?: Readonly<Vector3>;
    /** Positive world-space separation on each axis. Defaults to (1, 1, 1). */
    readonly spacing?: Readonly<Vector3>;
    /** Probe counts on X/Y/Z, each at least two; total limited to 4096. Defaults to [9, 5, 9]. */
    readonly probeCounts?: readonly [number, number, number];
    /** Uniform spherical rays per updated probe, one of 64, 128, 256. Defaults to 128. */
    readonly raysPerProbe?: 64 | 128 | 256;
    /** Strict maximum number of probes traced per frame. Defaults to 32. */
    readonly maxProbesPerFrame?: number;
    /** Maximum old-irradiance contribution in [0, 0.98]. Scene and light edits restart accumulation. */
    readonly hysteresis?: number;
    /** Diffuse indirect illumination multiplier in [0, 8]. Defaults to one. */
    readonly intensity?: number;
    /** World-space surface-normal visibility bias. Defaults to 0.08. */
    readonly normalBias?: number;
    /** World-space receiver-to-camera visibility bias. Defaults to 0.04. */
    readonly viewBias?: number;
    /** Maximum primary and directional-shadow ray distance. Defaults to 32 world units. */
    readonly maxRayDistance?: number;
    /** Linear RGB radiance for rays that miss the complete offscreen scene. */
    readonly environment?: Readonly<Color>;
    /** Fraction of the previously submitted diffuse bounce reused at hits, in [0, 0.95]. Defaults to 0.7. */
    readonly bounceStrength?: number;
    /** Clamp per-ray radiance before temporal integration to control fireflies. Defaults to 32. */
    readonly maxRayRadiance?: number;
    /** Relocate probes away from surfaces and out of solids within 45% of cell spacing. Defaults to true. */
    readonly relocation?: boolean;
    /** Maximum triangles in the CPU BVH and GPU ray scene. Defaults to 65536. */
    readonly maxTriangles?: number;
    /** Maximum world-space point, spot and directional lights; overflow fails clearly. Defaults to 32. */
    readonly maxLights?: number;
    /** Unsupported geometry/material handling. Defaults to error. */
    readonly unsupported?: 'error' | 'exclude';
    /** Texture handling for ray-hit diffuse/emissive factors. Defaults to error. */
    readonly texturePolicy?: 'error' | 'exclude' | 'material-factor';
}

/** @internal Validated immutable DDGI settings, including exact allocation requirements. */
export interface DynamicGlobalIlluminationSettings {
    readonly origin: Readonly<{ x: number; y: number; z: number }>;
    readonly spacing: Readonly<{ x: number; y: number; z: number }>;
    readonly probeCounts: readonly [number, number, number];
    readonly probeCount: number;
    readonly probeBufferBytes: number;
    readonly raysPerProbe: 64 | 128 | 256;
    readonly maxProbesPerFrame: number;
    readonly hysteresis: number;
    readonly intensity: number;
    readonly normalBias: number;
    readonly viewBias: number;
    readonly maxRayDistance: number;
    readonly environment: Readonly<{ r: number; g: number; b: number }>;
    readonly bounceStrength: number;
    readonly maxRayRadiance: number;
    readonly relocation: boolean;
    readonly maxTriangles: number;
    readonly maxLights: number;
    readonly unsupported: 'error' | 'exclude';
    readonly texturePolicy: 'error' | 'exclude' | 'material-factor';
}

/** CPU-known counts for the last submitted DDGI frame; no implicit GPU readback. */
export interface DynamicGlobalIlluminationDiagnostics {
    /** Total number of probes in the volume. */
    readonly probeCount: number;
    /** Scheduled probes whose ray updates were submitted. */
    readonly updatedProbeCount: number;
    /** Submitted primary rays; secondary light-visibility rays are not included. */
    readonly tracedRayCount: number;
    /** Current complete offscreen ray-scene triangle count. */
    readonly sceneTriangleCount: number;
    /** Current complete offscreen BVH node count. */
    readonly sceneNodeCount: number;
    /** Unsupported scene meshes deliberately omitted under the selected policy. */
    readonly excludedMeshCount: number;
    /** Textured meshes encountered during extraction; texturePolicy and excludedMeshCount describe their treatment. */
    readonly texturedMeshCount: number;
    /** Meshes changed during the last extraction. */
    readonly changedMeshCount: number;
    /** Last CPU scene update operation. */
    readonly sceneUpdate: 'rebuild' | 'refit' | 'material';
    /** Allocated persistent buffer bytes, including both probe-history slots. */
    readonly residentBytes: number;
    /** CPU bytes uploaded by the last successful frame, including parameters and lights. */
    readonly uploadedBytes: number;
    /** Subset of uploadedBytes used for changed triangles and BVH nodes. */
    readonly sceneUploadedBytes: number;
    /** Number of successful probe-update submissions. */
    readonly submittedFrameCount: number;
    /** Number of scheduled frames needed to visit every probe. */
    readonly updateCycleFrames: number;
    /** Exact light count included in ray-hit direct illumination. */
    readonly lightCount: number;
    /** Unsupported lights omitted only under the explicit exclude policy. */
    readonly excludedLightCount: number;
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `DDGI ${label} must be finite and between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

function integer(value: number, minimum: number, maximum: number, label: string): number {
    finiteRange(value, minimum, maximum, label);
    if (!Number.isSafeInteger(value)) throw new RangeError(`DDGI ${label} must be an integer`);
    return value;
}

function vector(
    value: Readonly<Vector3>,
    label: string,
    minimum: number
): Readonly<{ x: number; y: number; z: number }> {
    if (!(value instanceof Vector3)) throw new TypeError(`DDGI ${label} must be a Vector3`);
    return Object.freeze({
        x: finiteRange(value.x, minimum, 1_000_000, `${label}.x`),
        y: finiteRange(value.y, minimum, 1_000_000, `${label}.y`),
        z: finiteRange(value.z, minimum, 1_000_000, `${label}.z`)
    });
}

/** @internal Validate public configuration before creating a renderer or GPU resources. */
export function snapshotDynamicGlobalIlluminationOptions(
    value: unknown
): Readonly<DynamicGlobalIlluminationSettings> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new TypeError('DDGI options must be an object');
    const input = value as Readonly<DynamicGlobalIlluminationOptions>;
    const counts: readonly number[] = input.probeCounts ?? [9, 5, 9];
    if (!Array.isArray(counts) || counts.length !== 3)
        throw new TypeError('DDGI probeCounts must contain X, Y and Z');
    const grid = counts as readonly number[];
    const probeCounts = Object.freeze([
        integer(grid[0] ?? Number.NaN, 2, 128, 'probeCounts.x'),
        integer(grid[1] ?? Number.NaN, 2, 128, 'probeCounts.y'),
        integer(grid[2] ?? Number.NaN, 2, 128, 'probeCounts.z')
    ] as const);
    const probeCount = integer(
        probeCounts[0] * probeCounts[1] * probeCounts[2],
        8,
        4096,
        'probeCount'
    );
    const raysPerProbe: number = input.raysPerProbe ?? 128;
    if (raysPerProbe !== 64 && raysPerProbe !== 128 && raysPerProbe !== 256)
        throw new RangeError('DDGI raysPerProbe must be 64, 128 or 256');
    const environment = input.environment ?? new Color(0.025, 0.035, 0.05);
    if (!(environment instanceof Color)) throw new TypeError('DDGI environment must be a Color');
    const relocation = input.relocation ?? true;
    if (typeof relocation !== 'boolean') throw new TypeError('DDGI relocation must be boolean');
    const unsupported: string = input.unsupported ?? 'error';
    if (unsupported !== 'error' && unsupported !== 'exclude')
        throw new TypeError('DDGI unsupported must be error or exclude');
    const texturePolicy: string = input.texturePolicy ?? 'error';
    if (
        texturePolicy !== 'error' &&
        texturePolicy !== 'exclude' &&
        texturePolicy !== 'material-factor'
    )
        throw new TypeError('DDGI texturePolicy must be error, exclude or material-factor');
    const spacing = vector(input.spacing ?? new Vector3(1, 1, 1), 'spacing', 0.001);
    return Object.freeze({
        origin: vector(input.origin ?? new Vector3(-4, 0, -4), 'origin', -1_000_000),
        spacing,
        probeCounts,
        probeCount,
        probeBufferBytes: DDGI_HEADER_VEC4S * 16 + probeCount * DDGI_PROBE_BYTES,
        raysPerProbe,
        maxProbesPerFrame: integer(
            input.maxProbesPerFrame ?? Math.min(32, probeCount),
            1,
            probeCount,
            'maxProbesPerFrame'
        ),
        hysteresis: finiteRange(input.hysteresis ?? 0.9, 0, 0.98, 'hysteresis'),
        intensity: finiteRange(input.intensity ?? 1, 0, 8, 'intensity'),
        normalBias: finiteRange(
            input.normalBias ?? 0.08,
            0,
            Math.min(spacing.x, spacing.y, spacing.z) * 0.5,
            'normalBias'
        ),
        viewBias: finiteRange(
            input.viewBias ?? 0.04,
            0,
            Math.min(spacing.x, spacing.y, spacing.z) * 0.5,
            'viewBias'
        ),
        maxRayDistance: finiteRange(input.maxRayDistance ?? 32, 0.01, 100_000, 'maxRayDistance'),
        environment: Object.freeze({
            r: finiteRange(environment.r, 0, 10_000, 'environment.r'),
            g: finiteRange(environment.g, 0, 10_000, 'environment.g'),
            b: finiteRange(environment.b, 0, 10_000, 'environment.b')
        }),
        bounceStrength: finiteRange(input.bounceStrength ?? 0.7, 0, 0.95, 'bounceStrength'),
        maxRayRadiance: finiteRange(input.maxRayRadiance ?? 32, 0.001, 100_000, 'maxRayRadiance'),
        relocation,
        maxTriangles: integer(input.maxTriangles ?? 65_536, 1, 262_144, 'maxTriangles'),
        maxLights: integer(input.maxLights ?? 32, 1, 128, 'maxLights'),
        unsupported,
        texturePolicy
    });
}

interface MutableBufferBinding {
    buffer: RenderGraphBufferHandle;
}
class ProbePassParameters implements ComputeRenderPassParameters {
    readonly buffers: MutableBufferBinding[] = Array.from({ length: 6 }, () => ({
        buffer: 0 as RenderGraphBufferHandle
    }));
    readonly textures = [{ texture: 0 as RenderGraphTextureHandle }];
    readonly dispatch = { x: 1 };
}

interface ProbeHistoryInitializationParameters {
    buffer: RenderGraphBufferHandle;
}

class ProbeHistoryInitializationPass implements ScriptableRenderPass<ProbeHistoryInitializationParameters> {
    readonly name = 'DDGI initialize unavailable probe history';

    setup(
        builder: ScriptableRenderPassBuilder,
        parameters: ProbeHistoryInitializationParameters
    ): void {
        builder.clearBuffer(parameters.buffer);
    }

    execute(
        context: ScriptableRenderPassContext,
        parameters: ProbeHistoryInitializationParameters
    ): void {
        context.commands.clearBuffer(parameters.buffer);
    }
}

/** @internal Complete offscreen inputs for one transactional probe update. */
export interface DynamicGlobalIlluminationRecordInputs {
    readonly scene: Readonly<RayTracingSceneSnapshot>;
    readonly lights: readonly (PointLight | SpotLight | DirectionalLight | AreaLight)[];
    readonly historyValid?: boolean;
}

/** @internal Graph-visible DDGI output consumed by the same frame's PBR raster pass. */
export interface DynamicGlobalIlluminationFrameResources {
    readonly probeData: RenderGraphBufferHandle;
}

/** @internal Renderer-local transactional owner of DDGI ray-scene and probe storage. */
export class DynamicGlobalIlluminationController {
    readonly settings: Readonly<DynamicGlobalIlluminationSettings>;
    readonly #params: StorageBuffer;
    readonly #triangles: StorageBuffer;
    readonly #nodes: StorageBuffer;
    readonly #lights: StorageBuffer;
    readonly #probes: readonly [StorageBuffer, StorageBuffer];
    readonly #pass: ComputeRenderPass;
    readonly #pool = new RenderPassParameterPool(() => new ProbePassParameters());
    readonly #historyInitializationPass = new ProbeHistoryInitializationPass();
    readonly #historyInitializationPool =
        new RenderPassParameterPool<ProbeHistoryInitializationParameters>(() => ({
            buffer: 0 as RenderGraphBufferHandle
        }));
    readonly #historyKey = {};
    readonly #parameterData = new Float32Array(32);
    readonly #lightData: Float32Array;
    readonly #lightUInts: Uint32Array;
    readonly #committedLightUInts: Uint32Array;
    #committedLightCount = 0;
    #lightRevision = 0;
    #pendingLightRevision = 0;
    readonly #position = new Vector3();
    readonly #residentBytes: number;
    #intensity: number;
    #environment: Readonly<{ r: number; g: number; b: number }>;
    #probeIndex = 0;
    #cursor = 0;
    #submittedFrames = 0;
    #sceneRevision = -1;
    #valid = false;
    #invalidated = false;
    #invalidationRevision = 0;
    #pendingInvalidationRevision = -1;
    #pendingFrame = -1;
    #pendingSceneRevision = -1;
    #pendingLightCount = 0;
    #pendingExcludedLightCount = 0;
    #pendingTriangleCount = 0;
    #pendingNodeCount = 0;
    #pendingSceneUploadedBytes = 0;
    #pendingUploadedBytes = 0;
    #pendingExcludedMeshCount = 0;
    #pendingTexturedMeshCount = 0;
    #pendingChangedMeshCount = 0;
    #pendingSceneUpdate: 'rebuild' | 'refit' | 'material' = 'rebuild';
    #pendingCursor = 0;
    #pendingOutput: Readonly<DynamicGlobalIlluminationFrameResources> | null = null;
    #diagnostics: Readonly<DynamicGlobalIlluminationDiagnostics>;
    #destroyed = false;

    constructor(
        settings: Readonly<DynamicGlobalIlluminationSettings>,
        context: RenderPipelineCreateContext
    ) {
        this.settings = settings;
        this.#intensity = settings.intensity;
        this.#environment = settings.environment;
        const allocated: StorageBuffer[] = [];
        const create = (label: string, bytes: number, gpuWritten = false): StorageBuffer => {
            const buffer = context.createStorageBuffer({
                label,
                byteLength: bytes,
                usage: ['storage', 'copy-destination'],
                recovery: gpuWritten ? 'reinitialize' : 'cpu-shadow'
            });
            allocated.push(buffer);
            return buffer;
        };
        try {
            this.#params = create('DDGI volume and update parameters', 128);
            this.#triangles = create('DDGI offscreen world triangles', settings.maxTriangles * 128);
            this.#nodes = create('DDGI offscreen world BVH', settings.maxTriangles * 2 * 32);
            this.#lights = create('DDGI world-space ray-hit lights', settings.maxLights * 80);
            this.#probes = Object.freeze([
                create(
                    'DDGI directional irradiance and moments A',
                    settings.probeBufferBytes,
                    true
                ),
                create('DDGI directional irradiance and moments B', settings.probeBufferBytes, true)
            ]);
            this.#pass = new ComputeRenderPass(
                new ComputeKernel({ shader: createDynamicGlobalIlluminationShader(settings) })
            );
        } catch (error) {
            const cleanupFailures: unknown[] = [];
            for (const buffer of allocated) {
                try {
                    buffer.destroy();
                } catch (cleanupError) {
                    cleanupFailures.push(cleanupError);
                }
            }
            if (cleanupFailures.length > 0)
                throw new AggregateError(
                    [error, ...cleanupFailures],
                    'DDGI allocation and cleanup failed',
                    { cause: error }
                );
            throw error;
        }
        this.#residentBytes = allocated.reduce((total, buffer) => total + buffer.byteLength, 0);
        this.#lightData = new Float32Array(settings.maxLights * 20);
        this.#lightUInts = new Uint32Array(this.#lightData.buffer);
        this.#committedLightUInts = new Uint32Array(settings.maxLights * 20);
        this.#diagnostics = Object.freeze({
            probeCount: settings.probeCount,
            updatedProbeCount: 0,
            tracedRayCount: 0,
            sceneTriangleCount: 0,
            sceneNodeCount: 0,
            excludedMeshCount: 0,
            texturedMeshCount: 0,
            changedMeshCount: 0,
            sceneUpdate: 'rebuild',
            residentBytes: this.#residentBytes,
            uploadedBytes: 0,
            sceneUploadedBytes: 0,
            submittedFrameCount: 0,
            updateCycleFrames: Math.ceil(settings.probeCount / settings.maxProbesPerFrame),
            lightCount: 0,
            excludedLightCount: 0
        });
    }

    record(
        context: RenderPipelineContext,
        inputs: Readonly<DynamicGlobalIlluminationRecordInputs>
    ): Readonly<DynamicGlobalIlluminationFrameResources> {
        this.assertAlive();
        if (this.#pendingFrame === context.frameIndex && this.#pendingOutput !== null) {
            if (this.#pendingSceneRevision !== inputs.scene.revision)
                throw new Error(
                    'DDGI ray scene cannot change between cameras in the same application frame'
                );
            return this.#pendingOutput;
        }
        const settings = this.settings;
        const scene = inputs.scene;
        if (
            scene.triangleCount > settings.maxTriangles ||
            scene.nodeCount > settings.maxTriangles * 2
        )
            throw new RangeError('DDGI ray scene exceeds its configured triangle/BVH budget');
        let lightCount = 0;
        let excludedLightCount = 0;
        for (const light of inputs.lights) {
            if (!light.enabled) continue;
            const unsupported =
                light instanceof AreaLight ||
                (light instanceof SpotLight &&
                    (light.cookie !== null || light.iesProfile !== null));
            if (unsupported) {
                if (settings.unsupported === 'error')
                    throw new Error(
                        'DDGI ray-hit lighting does not support area lights, spot cookies or IES profiles'
                    );
                excludedLightCount++;
                continue;
            }
            if (lightCount >= settings.maxLights)
                throw new RangeError(
                    'DDGI lights exceed maxLights; increase the explicit ray-light budget'
                );
            const base = lightCount * 20;
            light.worldMatrix.getTranslation(this.#position);
            this.#lightData.set(
                [
                    this.#position.x,
                    this.#position.y,
                    this.#position.z,
                    light.range,
                    light.color.r * light.amount,
                    light.color.g * light.amount,
                    light.color.b * light.amount,
                    light instanceof DirectionalLight ? 2 : light instanceof SpotLight ? 1 : 0
                ],
                base
            );
            if (light instanceof DirectionalLight || light instanceof SpotLight) {
                const direction = light.getWorldDirection();
                this.#lightData.set(
                    [
                        direction.x,
                        direction.y,
                        direction.z,
                        light instanceof SpotLight ? light.outerCutoffCos : 0
                    ],
                    base + 8
                );
            } else this.#lightData.fill(0, base + 8, base + 12);
            this.#lightData.set(
                [
                    light.constantAttenuation,
                    light.linearAttenuation,
                    light.quadraticAttenuation,
                    light instanceof SpotLight ? light.cutoffCos : 0
                ],
                base + 12
            );
            for (let i = base; i < base + 16; i++) {
                if (!Number.isFinite(this.#lightData[i]))
                    throw new RangeError('DDGI light data must contain finite world-space values');
                // Preserve exact uint metadata separately while normalizing equivalent signed zeros.
                if (this.#lightData[i] === 0) this.#lightData[i] = 0;
            }
            this.#lightUInts[base + 16] = light.lightLayerMask;
            lightCount++;
        }
        // Compare the actual transport inputs, not stochastic radiance estimates. Commit this
        // snapshot only with the frame so retries retain the same lighting revision.
        let lightChanged = lightCount !== this.#committedLightCount;
        for (let i = 0; !lightChanged && i < lightCount * 20; i++) {
            lightChanged = this.#lightUInts[i] !== this.#committedLightUInts[i];
        }
        const lightRevisionWrapped = lightChanged && this.#lightRevision === 0xffffff;
        const lightRevision = lightChanged
            ? lightRevisionWrapped
                ? 0
                : this.#lightRevision + 1
            : this.#lightRevision;
        const marker = context.graph.acquireHistoryTexture(this.#historyKey, {
            label: 'DDGI submission and device-generation history marker',
            format: 'r32float',
            extent: { width: 1, height: 1 },
            usage: ['storage', 'sampled'],
            bufferCount: 2
        });
        const invalidationRevision = this.#invalidationRevision;
        const valid =
            this.#valid &&
            marker.valid &&
            !this.#invalidated &&
            !lightRevisionWrapped &&
            inputs.historyValid !== false;
        const cursor = valid ? this.#cursor : 0;
        this.#parameterData.set([
            settings.origin.x,
            settings.origin.y,
            settings.origin.z,
            this.#intensity,
            settings.spacing.x,
            settings.spacing.y,
            settings.spacing.z,
            settings.normalBias,
            ...settings.probeCounts,
            settings.viewBias,
            settings.normalBias * 0.25,
            settings.relocation ? 1 : 0,
            lightRevision,
            0,
            settings.hysteresis,
            0,
            settings.maxRayDistance,
            settings.maxRayRadiance,
            cursor,
            settings.maxProbesPerFrame,
            this.#submittedFrames,
            valid ? 1 : 0,
            scene.nodeCount,
            scene.triangleCount,
            lightCount,
            scene.revision % 16_777_216,
            this.#environment.r,
            this.#environment.g,
            this.#environment.b,
            settings.bounceStrength
        ]);
        context.writeStorageBuffer(this.#params, 0, this.#parameterData);
        context.writeStorageBuffer(
            this.#lights,
            0,
            this.#lightData.subarray(0, Math.max(1, lightCount) * 20)
        );
        let sceneUploadedBytes = 0;
        if (scene.revision !== this.#sceneRevision) {
            const partial = this.#sceneRevision === scene.baseRevision;
            sceneUploadedBytes += this.uploadSceneBuffer(
                context,
                this.#triangles,
                scene.triangles,
                partial ? scene.triangleDirtyRanges : null
            );
            sceneUploadedBytes += this.uploadSceneBuffer(
                context,
                this.#nodes,
                scene.nodes,
                partial ? scene.nodeDirtyRanges : null
            );
        }
        const parameters = context.acquirePassParameters(this.#pool);
        const outputIndex = 1 - this.#probeIndex;
        const buffers = [
            this.#params,
            this.#triangles,
            this.#nodes,
            this.#lights,
            this.#probes[this.#probeIndex === 0 ? 0 : 1],
            this.#probes[outputIndex === 0 ? 0 : 1]
        ];
        for (let i = 0; i < buffers.length; i++) {
            const binding = parameters.buffers[i];
            const buffer = buffers[i];
            if (binding === undefined || buffer === undefined)
                throw new Error('DDGI compute binding is missing');
            binding.buffer = context.graph.importStorageBuffer(buffer);
        }
        const texture = parameters.textures[0];
        const output = parameters.buffers[5];
        if (texture === undefined || output === undefined)
            throw new Error('DDGI output binding is missing');
        texture.texture = marker.current;
        parameters.dispatch.x = settings.probeCount;
        // GPU-written recovery resources have no initialized contents in a new device generation.
        // Declare a real graph clear before binding the previous slot, even though invalid-history
        // shader branches ignore those values. Initialization remains an explicit graph invariant.
        if (!marker.valid) {
            const previous = parameters.buffers[4];
            if (previous === undefined) throw new Error('DDGI previous history binding is missing');
            const initialization = context.acquirePassParameters(this.#historyInitializationPool);
            initialization.buffer = previous.buffer;
            context.graph.addPass(this.#historyInitializationPass, initialization);
        }
        context.graph.addPass(this.#pass, parameters);
        this.#pendingFrame = context.frameIndex;
        this.#pendingInvalidationRevision = invalidationRevision;
        this.#pendingSceneRevision = scene.revision;
        this.#pendingLightCount = lightCount;
        this.#pendingLightRevision = lightRevision;
        this.#pendingExcludedLightCount = excludedLightCount;
        this.#pendingTriangleCount = scene.triangleCount;
        this.#pendingNodeCount = scene.nodeCount;
        this.#pendingSceneUploadedBytes = sceneUploadedBytes;
        this.#pendingUploadedBytes = 128 + Math.max(1, lightCount) * 80 + sceneUploadedBytes;
        this.#pendingExcludedMeshCount = scene.diagnostics.excludedMeshCount;
        this.#pendingTexturedMeshCount = scene.diagnostics.texturedMeshCount;
        this.#pendingChangedMeshCount =
            scene.revision !== this.#sceneRevision ? scene.diagnostics.changedMeshCount : 0;
        this.#pendingSceneUpdate = scene.diagnostics.update;
        this.#pendingCursor = (cursor + settings.maxProbesPerFrame) % settings.probeCount;
        this.#pendingOutput = Object.freeze({ probeData: output.buffer });
        return this.#pendingOutput;
    }

    frameSubmitted(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#probeIndex = 1 - this.#probeIndex;
        this.#cursor = this.#pendingCursor;
        this.#sceneRevision = this.#pendingSceneRevision;
        this.#lightRevision = this.#pendingLightRevision;
        this.#committedLightCount = this.#pendingLightCount;
        this.#committedLightUInts.set(this.#lightUInts.subarray(0, this.#pendingLightCount * 20));
        this.#valid = true;
        this.#invalidated = this.#pendingInvalidationRevision !== this.#invalidationRevision;
        this.#submittedFrames++;
        this.#diagnostics = Object.freeze({
            probeCount: this.settings.probeCount,
            updatedProbeCount: this.settings.maxProbesPerFrame,
            tracedRayCount: this.settings.maxProbesPerFrame * this.settings.raysPerProbe,
            sceneTriangleCount: this.#pendingTriangleCount,
            sceneNodeCount: this.#pendingNodeCount,
            excludedMeshCount: this.#pendingExcludedMeshCount,
            texturedMeshCount: this.#pendingTexturedMeshCount,
            changedMeshCount: this.#pendingChangedMeshCount,
            sceneUpdate: this.#pendingSceneUpdate,
            residentBytes: this.#residentBytes,
            uploadedBytes: this.#pendingUploadedBytes,
            sceneUploadedBytes: this.#pendingSceneUploadedBytes,
            submittedFrameCount: this.#submittedFrames,
            updateCycleFrames: Math.ceil(
                this.settings.probeCount / this.settings.maxProbesPerFrame
            ),
            lightCount: this.#pendingLightCount,
            excludedLightCount: this.#pendingExcludedLightCount
        });
        this.#pendingFrame = -1;
        this.#pendingOutput = null;
    }

    frameDiscarded(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#pendingFrame = -1;
        this.#pendingOutput = null;
    }

    setIntensity(intensity: number): void {
        this.assertAlive();
        this.#intensity = finiteRange(intensity, 0, 8, 'intensity');
    }

    setEnvironment(color: Readonly<Color>): void {
        this.assertAlive();
        if (!(color instanceof Color)) throw new TypeError('DDGI environment must be a Color');
        const r = finiteRange(color.r, 0, 10_000, 'environment.r');
        const g = finiteRange(color.g, 0, 10_000, 'environment.g');
        const b = finiteRange(color.b, 0, 10_000, 'environment.b');
        if (this.#environment.r === r && this.#environment.g === g && this.#environment.b === b)
            return;
        this.#environment = Object.freeze({ r, g, b });
        this.invalidateAll();
    }

    invalidateAll(): void {
        this.assertAlive();
        this.#invalidated = true;
        this.#invalidationRevision++;
    }

    getDiagnostics(): Readonly<DynamicGlobalIlluminationDiagnostics> {
        this.assertAlive();
        return this.#diagnostics;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const failures: unknown[] = [];
        for (const buffer of [
            this.#params,
            this.#triangles,
            this.#nodes,
            this.#lights,
            ...this.#probes
        ]) {
            try {
                buffer.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length > 0)
            throw new AggregateError(failures, 'DDGI resource destruction failed');
    }

    private uploadSceneBuffer(
        context: RenderPipelineContext,
        buffer: StorageBuffer,
        source: Float32Array,
        ranges: readonly RayTracingSceneDirtyRange[] | null
    ): number {
        if (ranges === null) {
            context.writeStorageBuffer(buffer, 0, source);
            return source.byteLength;
        }
        let uploaded = 0;
        for (const range of ranges) {
            context.writeStorageBuffer(
                buffer,
                range.byteOffset,
                new Uint8Array(
                    source.buffer,
                    source.byteOffset + range.byteOffset,
                    range.byteLength
                )
            );
            uploaded += range.byteLength;
        }
        return uploaded;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('DDGI controller is destroyed');
    }
}
