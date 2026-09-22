import Mesh from '../../core/Mesh';
import PerspectiveCamera from '../../camera/PerspectiveCamera';
import Vector3 from '../../math/Vector3';
import PBRMaterial from '../../material/PBRMaterial';
import {
    ReflectionProbe,
    invalidateReflectionProbe,
    reflectionProbeState
} from './ReflectionProbe';
import { createReflectionFilterPass, REFLECTION_MARKER_PASS } from './ReflectionProbeFilter';
import { ForwardRenderPipelineFactory } from '../pipeline/ForwardRenderPipeline';
import {
    snapshotRenderPipelineFactory,
    snapshotRenderPipelineRequirements
} from '../pipeline/RenderPipelineFactory';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext,
    RenderPipelineFactory,
    RenderPipelineInvocationPolicy,
    RenderPipelineRequirements
} from '../pipeline/RenderPipeline';
import type { RenderTarget } from '../RenderTarget';
import type { RenderGraphTimelineSnapshot } from '../graph/RenderGraphTimeline';
import {
    SceneRenderPass,
    type SceneRenderPassParameters
} from '../pipeline/passes/SceneRenderPass';
import type {
    FullscreenRenderPass,
    FullscreenRenderPassParameters
} from '../pipeline/passes/FullscreenRenderPass';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import type {
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment
} from '../pipeline/ScriptableRenderGraph';
import type { RendererListHandle } from '../pipeline/RendererList';

/** Bounded dynamic reflection capture around an existing shared rendering pipeline. */
export interface ReflectionProbePipelineOptions {
    /** Distinct dynamic probes. At most eight are resident; materials bind a spatially relevant pair. */
    readonly probes: readonly ReflectionProbe[];
    /** Main view pipeline. Defaults to portable Forward. */
    readonly pipeline?: RenderPipelineFactory;
    /** Cube face size, a power of two in [16, 256]. Defaults to 128. */
    readonly resolution?: number;
    /** Roughness bands in [2, 8], bounded by log2(resolution) + 1. Defaults to five. */
    readonly roughnessLevels?: number;
    /** GGX importance samples per filtered pixel: 32, 64 or 128. Defaults to 64. */
    readonly filterSamples?: 32 | 64 | 128;
    /** Maximum scene faces recorded in one application frame, in [1, 6]. Defaults to one. */
    readonly facesPerFrame?: number;
    /** Maximum roughness bands recorded in one application frame, in [1, 8]. Defaults to one. */
    readonly filterLevelsPerFrame?: number;
    /** Hard byte budget for capture color/depth and double-buffered filtered radiance. Defaults to 64 MiB. */
    readonly maxResidentBytes?: number;
    /** Capture near plane. Defaults to 0.05 world units. */
    readonly near?: number;
    /** Capture far plane. Defaults to 100 world units. */
    readonly far?: number;
    /** Camera layer mask. Defaults to all layers. Local-probe receivers are excluded to avoid recursion. */
    readonly visibility?: number;
}

interface Settings {
    readonly probes: readonly ReflectionProbe[];
    readonly resolution: number;
    readonly levels: number;
    readonly samples: number;
    readonly faces: number;
    readonly filters: number;
    readonly near: number;
    readonly far: number;
    readonly visibility: number;
    readonly residentBytes: number;
}

function integer(value: number, name: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || value < min || value > max)
        throw new RangeError(
            `Reflection ${name} must be an integer in [${String(min)}, ${String(max)}]`
        );
    return value;
}

function settings(options: Readonly<ReflectionProbePipelineOptions>): Readonly<Settings> {
    const candidate: unknown = options.probes;
    if (
        !Array.isArray(candidate) ||
        options.probes.length < 1 ||
        options.probes.length > 8 ||
        options.probes.some(probe => !(probe instanceof ReflectionProbe) || !probe.dynamic) ||
        new Set(options.probes).size !== options.probes.length
    ) {
        throw new TypeError('Reflection capture requires one to eight distinct dynamic probes');
    }
    const resolution = integer(options.resolution ?? 128, 'resolution', 16, 256);
    if ((resolution & (resolution - 1)) !== 0)
        throw new RangeError('Reflection resolution must be a power of two');
    const levels = integer(
        options.roughnessLevels ?? 5,
        'roughnessLevels',
        2,
        Math.min(8, Math.log2(resolution) + 1)
    );
    const samples: unknown = options.filterSamples ?? 64;
    if (samples !== 32 && samples !== 64 && samples !== 128)
        throw new RangeError('Reflection filterSamples must be 32, 64 or 128');
    const near = options.near ?? 0.05;
    const far = options.far ?? 100;
    if (!Number.isFinite(near) || !Number.isFinite(far) || near <= 0 || far <= near)
        throw new RangeError('Reflection capture requires finite 0 < near < far');
    const visibility = options.visibility ?? 0xffffffff;
    if (!Number.isInteger(visibility) || visibility < 0 || visibility > 0xffffffff)
        throw new RangeError('Reflection visibility must be an unsigned 32-bit mask');
    const residentBytes =
        options.probes.length *
        (resolution * resolution * 6 * 12 +
            (resolution * 2 + 2) * (resolution + 2) * levels * 8 * 2);
    const budget = integer(
        options.maxResidentBytes ?? 64 * 1024 * 1024,
        'maxResidentBytes',
        1,
        Number.MAX_SAFE_INTEGER
    );
    if (residentBytes > budget)
        throw new RangeError(
            `Reflection resident resources require ${String(residentBytes)} bytes, exceeding maxResidentBytes`
        );
    return Object.freeze({
        probes: Object.freeze([...options.probes]),
        resolution,
        levels,
        samples,
        faces: integer(options.facesPerFrame ?? 1, 'facesPerFrame', 1, 6),
        filters: integer(options.filterLevelsPerFrame ?? 1, 'filterLevelsPerFrame', 1, 8),
        near,
        far,
        visibility,
        residentBytes
    });
}

interface Capture {
    readonly probe: ReflectionProbe;
    readonly raw: RenderTarget;
    readonly filtered: readonly [RenderTarget, RenderTarget];
    readonly cameras: readonly PerspectiveCamera[];
    face: number;
    filter: number;
    front: 0 | 1;
    revision: number;
}

interface PendingCapture {
    capture: Capture;
    face: number;
    filter: number;
    revision: number;
    complete: boolean;
}

interface SceneParameters extends SceneRenderPassParameters {
    rendererList: RendererListHandle;
    readonly colorAttachments: RenderPipelineColorAttachment[];
    depthStencilAttachment: RenderPipelineDepthStencilAttachment;
    viewport: readonly [number, number, number, number];
    scissor: readonly [number, number, number, number];
}

interface FilterParameters extends FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureHandle[];
    readonly colorAttachments: RenderPipelineColorAttachment[];
    viewport: readonly [number, number, number, number];
    scissor: readonly [number, number, number, number];
}

const CLEAR = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
const SCENE_PASS = new SceneRenderPass('Reflection capture opaque scene');
const DIRECTIONS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
] as const;
const UPS = [
    [0, -1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, -1, 0],
    [0, -1, 0]
] as const;

class ReflectionProbePipeline implements RenderPipeline {
    readonly name = 'Local reflection probes';
    readonly #captures: Capture[] = [];
    readonly #filters: readonly FullscreenRenderPass[];
    readonly #excluded: Mesh[] = [];
    readonly #markerKey = {};
    readonly #targets: RenderTarget[] = [];
    readonly #scenePool = new RenderPassParameterPool<SceneParameters>(() => ({
        rendererList: 0 as RendererListHandle,
        colorAttachments: [],
        depthStencilAttachment: { texture: 0 as RenderGraphTextureHandle },
        viewport: [0, 0, 1, 1],
        scissor: [0, 0, 1, 1]
    }));
    readonly #filterPool = new RenderPassParameterPool<FilterParameters>(() => ({
        inputTextures: [],
        colorAttachments: [],
        viewport: [0, 0, 1, 1],
        scissor: [0, 0, 1, 1]
    }));
    #lastFrame = -1;
    #cursor = 0;
    #pending: PendingCapture | null = null;

    constructor(
        readonly inner: RenderPipeline,
        readonly options: Readonly<Settings>,
        context: RenderPipelineCreateContext
    ) {
        this.#filters = Array.from({ length: options.levels }, (_, index) =>
            createReflectionFilterPass(
                options.resolution,
                index / (options.levels - 1),
                options.samples
            )
        );
        try {
            for (const probe of options.probes) {
                const state = reflectionProbeState(probe);
                if (state.owner !== null)
                    throw new Error(
                        'Dynamic reflection probe already belongs to another live pipeline'
                    );
                state.owner = this;
                const r = options.resolution;
                const create = (width: number, height: number, depth: boolean): RenderTarget => {
                    const target = context.createRenderTarget({
                        width,
                        height,
                        label: `${probe.name} ${depth ? 'faces' : 'filtered'}`,
                        colorAttachments: [{ format: 'rgba16float' }],
                        depthStencilAttachment: depth ? { format: 'depth32float' } : false
                    });
                    this.#targets.push(target);
                    return target;
                };
                this.#captures.push({
                    probe,
                    raw: create(r * 3, r * 2, true),
                    filtered: [
                        create(r * 2 + 2, (r + 2) * options.levels, false),
                        create(r * 2 + 2, (r + 2) * options.levels, false)
                    ],
                    cameras: DIRECTIONS.map((direction, index) => {
                        const up = UPS[index];
                        if (up === undefined) throw new Error('Missing capture up vector');
                        const camera = new PerspectiveCamera({
                            fov: 90,
                            aspect: 1,
                            near: options.near,
                            far: options.far,
                            x: probe.position[0],
                            y: probe.position[1],
                            z: probe.position[2],
                            visibility: options.visibility,
                            up: new Vector3(...up)
                        });
                        camera.lookAt({
                            x: probe.position[0] + direction[0],
                            y: probe.position[1] + direction[1],
                            z: probe.position[2] + direction[2]
                        });
                        return camera;
                    }),
                    face: 0,
                    filter: 0,
                    front: 0,
                    revision: 0
                });
            }
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    get usesRenderGraphTimeline(): boolean {
        return this.inner.usesRenderGraphTimeline ?? false;
    }

    record(context: RenderPipelineContext): void {
        if (context.frameIndex !== this.#lastFrame) {
            this.#lastFrame = context.frameIndex;
            this.recordCaptures(context);
        }
        const result: unknown = this.inner.record(context);
        if (
            result !== null &&
            (typeof result === 'object' || typeof result === 'function') &&
            typeof Reflect.get(result, 'then') === 'function'
        ) {
            throw new TypeError('Wrapped reflection pipeline record() must be synchronous');
        }
    }

    private recordCaptures(context: RenderPipelineContext): void {
        const marker = context.graph.acquireHistoryTexture(this.#markerKey, {
            format: 'rgba8unorm',
            extent: { width: 1, height: 1 },
            usage: ['sampled', 'attachment']
        });
        if (!marker.valid) {
            for (const capture of this.#captures) {
                invalidateReflectionProbe(capture.probe);
                capture.face = 0;
                capture.filter = 0;
                capture.revision = 0;
            }
        }
        const markerParameters = context.acquirePassParameters(this.#filterPool);
        markerParameters.inputTextures.length = 0;
        markerParameters.colorAttachments[0] = {
            texture: marker.current,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR
        };
        markerParameters.viewport = markerParameters.scissor = [0, 0, 1, 1];
        context.graph.addPass(REFLECTION_MARKER_PASS, markerParameters);

        let selected: Capture | undefined;
        for (let count = 0; count < this.#captures.length; count++) {
            const candidate = this.#captures[(this.#cursor + count) % this.#captures.length];
            if (
                candidate !== undefined &&
                candidate.probe.getDiagnostics().requestedRevision !==
                    reflectionProbeState(candidate.probe).capturedRevision
            ) {
                selected = candidate;
                break;
            }
        }
        if (selected === undefined) return;
        const capture = selected;
        const pending: PendingCapture = (this.#pending = {
            capture,
            face: capture.face,
            filter: capture.filter,
            revision: capture.revision || capture.probe.getDiagnostics().requestedRevision,
            complete: false
        });
        const raw = context.graph.importRenderTarget(capture.raw);
        const r = this.options.resolution;
        this.#excluded.length = 0;
        // Recursive specular feedback is deliberately excluded. Other opaque material families,
        // textures, masking, skinning and rigid instances use ordinary shared scene draws.
        context.scene.traverse(node => {
            if (
                node instanceof Mesh &&
                node.material instanceof PBRMaterial &&
                node.material.reflectionProbes.length > 0
            )
                this.#excluded.push(node);
        });
        for (let work = 0; work < this.options.faces && pending.face < 6; work++, pending.face++) {
            const face = pending.face;
            const camera = capture.cameras[face];
            if (camera === undefined || raw.depthStencil === null)
                throw new Error('Incomplete reflection capture resources');
            context.recordView(camera, capture.raw, view => {
                const faceTarget = view.graph.importOutput();
                if (faceTarget.depthStencil === null) throw new Error('Missing reflection depth');
                const culling = view.cull();
                view.recordShadows(culling);
                const parameters = view.acquirePassParameters(this.#scenePool);
                parameters.rendererList = view.createRendererList({
                    cullingResults: culling,
                    queue: 'opaque',
                    sorting: 'material-front-to-back',
                    excludeMeshes: this.#excluded
                });
                parameters.colorAttachments[0] = {
                    texture: faceTarget.color(0),
                    loadOp: face === 0 ? 'clear' : 'load',
                    storeOp: 'store',
                    clearValue: CLEAR
                };
                parameters.depthStencilAttachment = {
                    texture: faceTarget.depthStencil,
                    depthLoadOp: face === 0 ? 'clear' : 'load',
                    depthStoreOp: 'store',
                    depthClearValue: camera.depthMode === 'reversed' ? 0 : 1
                };
                parameters.viewport = parameters.scissor = [
                    (face % 3) * r,
                    Math.floor(face / 3) * r,
                    r,
                    r
                ];
                view.graph.addPass(SCENE_PASS, parameters);
            });
        }
        if (pending.face === 6) {
            const back = capture.filtered[capture.front === 0 ? 1 : 0];
            const output = context.graph.importRenderTarget(back);
            for (
                let work = 0;
                work < this.options.filters && pending.filter < this.options.levels;
                work++, pending.filter++
            ) {
                const filter = this.#filters[pending.filter];
                if (filter === undefined) throw new Error('Missing reflection roughness pass');
                const parameters = context.acquirePassParameters(this.#filterPool);
                parameters.inputTextures[0] = raw.color(0);
                parameters.inputTextures.length = 1;
                parameters.colorAttachments[0] = {
                    texture: output.color(0),
                    loadOp: pending.filter === 0 ? 'clear' : 'load',
                    storeOp: 'store',
                    clearValue: CLEAR
                };
                parameters.viewport = parameters.scissor = [
                    0,
                    pending.filter * (r + 2),
                    r * 2 + 2,
                    r + 2
                ];
                context.graph.addPass(filter, parameters);
            }
            pending.complete = pending.filter === this.options.levels;
        }
        // Restore the main camera/light collection before delegating to the selected pipeline.
        context.prepareScene();
    }

    frameSubmitted(frameIndex: number): void {
        this.inner.frameSubmitted?.(frameIndex);
        const pending = this.#pending;
        this.#pending = null;
        if (pending === null) return;
        const capture = pending.capture;
        if (!pending.complete) {
            capture.face = pending.face;
            capture.filter = pending.filter;
            capture.revision = pending.revision;
            return;
        }
        capture.front = capture.front === 0 ? 1 : 0;
        const target = capture.filtered[capture.front];
        const state = reflectionProbeState(capture.probe);
        state.texture = target.getColorTexture();
        state.atlasWidth = target.width;
        state.atlasHeight = target.height;
        state.maxLod = this.options.levels - 1;
        state.ready = true;
        state.revision++;
        state.captures++;
        state.capturedRevision = pending.revision;
        capture.face = 0;
        capture.filter = 0;
        capture.revision = 0;
        this.#cursor = (this.#captures.indexOf(capture) + 1) % this.#captures.length;
    }

    frameDiscarded(frameIndex: number): void {
        this.#pending = null;
        this.#lastFrame = -1;
        this.inner.frameDiscarded?.(frameIndex);
    }

    recordRenderGraphTimeline(snapshot: Readonly<RenderGraphTimelineSnapshot>): void {
        this.inner.recordRenderGraphTimeline?.(snapshot);
    }

    destroy(): void {
        for (const probe of this.options.probes) {
            const state = reflectionProbeState(probe);
            if (state.owner === this) {
                invalidateReflectionProbe(probe);
                state.owner = null;
            }
        }
        for (const target of this.#targets) target.destroy();
        this.#targets.length = 0;
        this.inner.destroy();
    }
}

/**
 * Adds budgeted, atomic HDR reflection captures to Forward or Clustered rendering. Captures use
 * shared scene lists, shadows, graph passes and portable raster shaders. Call probe.requestUpdate()
 * after relevant scene/light changes. A capture spans frames and is not a simultaneous snapshot.
 */
export class ReflectionProbePipelineFactory implements RenderPipelineFactory {
    /** Diagnostic name of the composed pipeline. */
    readonly name = 'Local reflection probes';
    /** Wrapped requirements plus HDR capture formats and atlas dimensions. */
    readonly requirements: Readonly<RenderPipelineRequirements>;
    /** Main-view invocation limits inherited from the wrapped pipeline. */
    readonly invocationPolicy: Readonly<RenderPipelineInvocationPolicy>;
    /** Exact declared texture/depth bytes, excluding driver padding and the wrapped pipeline. */
    readonly residentBytes: number;
    readonly #options: Readonly<Settings>;
    readonly #pipeline: RenderPipelineFactory;

    constructor(options: Readonly<ReflectionProbePipelineOptions>) {
        this.#options = settings(options);
        this.#pipeline = snapshotRenderPipelineFactory(
            options.pipeline ?? new ForwardRenderPipelineFactory()
        );
        this.residentBytes = this.#options.residentBytes;
        this.invocationPolicy =
            this.#pipeline.invocationPolicy ??
            Object.freeze({ cameraType: 'any', maxInvocationsPerFrame: null });
        const required = this.#pipeline.requirements;
        this.requirements = snapshotRenderPipelineRequirements({
            ...required,
            requiredLimits: {
                ...required?.requiredLimits,
                maxTextureDimension2D: Math.max(
                    required?.requiredLimits?.['maxTextureDimension2D'] ?? 0,
                    this.#options.resolution * 3,
                    (this.#options.resolution + 2) * this.#options.levels
                )
            },
            requiredTextureFormats: [
                ...(required?.requiredTextureFormats ?? []),
                { format: 'rgba16float', use: 'color-attachment' },
                { format: 'rgba16float', use: 'filterable-sampled' },
                { format: 'depth32float', use: 'depth-stencil-attachment' }
            ]
        });
    }

    /** Create isolated capture resources; sharing one dynamic probe across live renderers fails. */
    async create(context: RenderPipelineCreateContext): Promise<RenderPipeline> {
        const pipeline = await this.#pipeline.create(context);
        return new ReflectionProbePipeline(pipeline, this.#options, context);
    }
}
