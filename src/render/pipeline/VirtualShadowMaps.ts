import type Camera from '../../camera/Camera';
import type DirectionalLight from '../../light/DirectionalLight';
import Matrix4 from '../../math/Matrix4';
import Vector3 from '../../math/Vector3';
import ComputeKernel from '../compute/ComputeKernel';
import ComputeShader from '../compute/ComputeShader';
import type ComputeSampler from '../compute/ComputeSampler';
import type { StorageBuffer } from '../StorageBuffer';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext,
    RenderPipelineShadowResources
} from './RenderPipeline';
import { RenderPassParameterPool } from './RenderPassParameterPool';
import { ComputeRenderPass, type ComputeRenderPassParameters } from './passes/ComputeRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineTargetResources,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from './ScriptableRenderGraph';

const INVALID_BUFFER = 0 as RenderGraphBufferHandle;
const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const MAX_DIRECTIONAL_VIRTUAL_LIGHTS = 4;
const CLIPMAP_HEADER_VEC4_COUNT = 13;
const CLIPMAP_MAP_VEC4_COUNT = 5;
const PHYSICAL_PAGE_STRIDE_BYTES = 256;
const PHYSICAL_PAGE_BINDING_BYTES = 32;
const SHADOW_INDIRECT_ARGUMENT_BYTES = 20;
const DRAW_INDIRECT_ARGUMENT_BYTES = 16;
const BUCKET_OFFSET_STRIDE_BYTES = 256;
const CULL_WORKGROUP_SIZE = 64;
const REQUEST_WORKGROUP_SIZE = 8;
const VIRTUAL_SHADOW_STATS_BYTES = 32;

/** GPU receiver-driven shadow-page allocation and directional clipmap controls. */
export interface VirtualShadowMapOptions {
    /** Square virtual resolution for every directional clipmap level. Defaults to 4096. */
    readonly virtualResolution?: number;
    /** Square physical page edge in pixels. Defaults to 128. */
    readonly pageSize?: number;
    /** Shared physical depth-page capacity. Defaults to 32. */
    readonly physicalPageCount?: number;
    /** Maximum missing or invalidated pages rendered by one frame. Defaults to 16. */
    readonly maxPageUpdatesPerFrame?: number;
    /** Camera-centered directional clipmap levels. Defaults to 4. */
    readonly directionalClipmapLevels?: number;
    /** Full world-space width covered by the finest clipmap. Defaults to 64. */
    readonly firstDirectionalClipmapExtent?: number;
}

/** Validated immutable virtual-shadow configuration used by one pipeline runtime. */
export interface VirtualShadowMapSettings {
    readonly virtualResolution: number;
    readonly pageSize: number;
    readonly virtualPageGridSize: number;
    readonly physicalPageCount: number;
    readonly physicalPageColumns: number;
    readonly physicalPageRows: number;
    readonly physicalAtlasWidth: number;
    readonly physicalAtlasHeight: number;
    readonly maxPageUpdatesPerFrame: number;
    readonly directionalClipmapLevels: number;
    readonly firstDirectionalClipmapExtent: number;
    readonly pageTableWidth: number;
    readonly pageTableHeaderRows: number;
    readonly pageTableHeight: number;
    readonly clipmapVec4Count: number;
}

/** On-demand counters copied only when diagnostics are explicitly requested. */
export interface VirtualShadowMapDiagnostics {
    /** Unique logical pages requested by the latest submitted receiver pass. */
    readonly requestedPageCount: number;
    /** Physical pages whose depth contents were refreshed by the latest submitted frame. */
    readonly renderedPageCount: number;
    /** Requested or dirty pages postponed by the configured update/physical-page budgets. */
    readonly deferredPageCount: number;
    /** Valid physical residency records retained after the latest submitted allocation. */
    readonly residentPageCount: number;
    /** Resident physical pages remapped to another logical identity. */
    readonly evictionCount: number;
    /** Unique logical pages touched by changed caster coverage. */
    readonly invalidatedPageCount: number;
    /** Configured physical depth-page capacity. */
    readonly physicalPageCapacity: number;
    /** Configured camera-centered clipmap levels per directional light. */
    readonly directionalClipmapLevelCount: number;
}

export interface VirtualShadowBucketDescriptor {
    readonly indexCount: number;
}

export interface VirtualShadowFrameResources {
    readonly atlas: RenderGraphTextureHandle;
    readonly pageTable: RenderGraphTextureHandle;
    readonly clipmapData: RenderGraphBufferHandle;
    readonly physicalPages: RenderGraphBufferHandle;
    readonly visibleIndices: RenderGraphBufferHandle;
    readonly visibleBucketOffsets: RenderGraphBufferHandle;
    readonly shadowIndirectArguments: RenderGraphBufferHandle;
    readonly clearIndirectArguments: RenderGraphBufferHandle;
    readonly clearAtlas: boolean;
    readonly directionalLightCount: number;
}

interface MutableBufferBinding {
    buffer: RenderGraphBufferHandle;
    byteOffset?: number;
    byteLength?: number;
}

interface MutableTextureBinding {
    texture: RenderGraphTextureAccessHandle;
}

class MutableComputeParameters implements ComputeRenderPassParameters {
    readonly buffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[];
    readonly samplers: ComputeSampler[] = [];
    dispatch: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };

    constructor(bufferCount: number, textureCount: number) {
        this.buffers = Array.from({ length: bufferCount }, () => ({ buffer: INVALID_BUFFER }));
        this.textures = Array.from({ length: textureCount }, () => ({ texture: INVALID_TEXTURE }));
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Virtual-shadow compute buffer is missing');
        binding.buffer = buffer;
        delete binding.byteOffset;
        delete binding.byteLength;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined)
            throw new RangeError('Virtual-shadow compute texture is missing');
        binding.texture = texture;
    }

    setDispatch(x: number, y = 1, z = 1): void {
        this.dispatch.x = x;
        this.dispatch.y = y;
        this.dispatch.z = z;
    }
}

interface BufferClearRange {
    buffer: RenderGraphBufferHandle;
    byteOffset: number;
    byteLength: number;
}

class BufferClearParameters {
    readonly ranges: BufferClearRange[] = [];

    add(buffer: RenderGraphBufferHandle, byteOffset: number, byteLength: number): void {
        let range = this.ranges[this.ranges.length];
        if (range === undefined) {
            range = { buffer, byteOffset, byteLength };
            this.ranges.push(range);
        } else {
            range.buffer = buffer;
            range.byteOffset = byteOffset;
            range.byteLength = byteLength;
        }
    }

    reset(): void {
        this.ranges.length = 0;
    }
}

class BufferClearPass implements ScriptableRenderPass<BufferClearParameters> {
    readonly name = 'Virtual shadow request and invalidation reset';

    setup(builder: ScriptableRenderPassBuilder, parameters: BufferClearParameters): void {
        for (const range of parameters.ranges) {
            builder.clearBuffer(range.buffer, range.byteOffset, range.byteLength);
        }
    }

    execute(context: ScriptableRenderPassContext, parameters: BufferClearParameters): void {
        for (const range of parameters.ranges) {
            context.commands.clearBuffer(range.buffer, range.byteOffset, range.byteLength);
        }
    }
}

function positiveInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
    return value as number;
}

function finitePositive(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be finite and positive`);
    }
    return value;
}

function powerOfTwo(value: number): boolean {
    return (value & (value - 1)) === 0;
}

/** Validate and snapshot public virtual-shadow options. */
export function snapshotVirtualShadowMapOptions(
    value: unknown
): Readonly<VirtualShadowMapSettings> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('Virtual shadow map options must be an object');
    }
    const input = value as Readonly<VirtualShadowMapOptions>;
    const virtualResolution = positiveInteger(
        input.virtualResolution ?? 4096,
        'Virtual shadow virtualResolution'
    );
    const pageSize = positiveInteger(input.pageSize ?? 128, 'Virtual shadow pageSize');
    if (!powerOfTwo(virtualResolution) || !powerOfTwo(pageSize)) {
        throw new RangeError('Virtual shadow virtualResolution and pageSize must be powers of two');
    }
    if (pageSize < 64 || pageSize > 256) {
        throw new RangeError('Virtual shadow pageSize must be between 64 and 256');
    }
    if (virtualResolution < pageSize || virtualResolution % pageSize !== 0) {
        throw new RangeError('Virtual shadow virtualResolution must contain complete pages');
    }
    const virtualPageGridSize = virtualResolution / pageSize;
    if (virtualPageGridSize < 8 || virtualPageGridSize > 128) {
        throw new RangeError('Virtual shadow page grid must contain between 8 and 128 pages');
    }
    const physicalPageCount = positiveInteger(
        input.physicalPageCount ?? 32,
        'Virtual shadow physicalPageCount'
    );
    if (physicalPageCount > 256) {
        throw new RangeError('Virtual shadow physicalPageCount cannot exceed 256');
    }
    const maxPageUpdatesPerFrame = positiveInteger(
        input.maxPageUpdatesPerFrame ?? 16,
        'Virtual shadow maxPageUpdatesPerFrame'
    );
    if (maxPageUpdatesPerFrame > physicalPageCount) {
        throw new RangeError(
            'Virtual shadow maxPageUpdatesPerFrame cannot exceed physicalPageCount'
        );
    }
    const directionalClipmapLevels = positiveInteger(
        input.directionalClipmapLevels ?? 4,
        'Virtual shadow directionalClipmapLevels'
    );
    if (directionalClipmapLevels > 4) {
        throw new RangeError('Virtual shadow directionalClipmapLevels cannot exceed four');
    }
    const firstDirectionalClipmapExtent = finitePositive(
        input.firstDirectionalClipmapExtent ?? 64,
        'Virtual shadow firstDirectionalClipmapExtent'
    );
    const physicalPageColumns = Math.ceil(Math.sqrt(physicalPageCount));
    const physicalPageRows = Math.ceil(physicalPageCount / physicalPageColumns);
    const clipmapVec4Count =
        CLIPMAP_HEADER_VEC4_COUNT +
        MAX_DIRECTIONAL_VIRTUAL_LIGHTS * directionalClipmapLevels * CLIPMAP_MAP_VEC4_COUNT;
    const pageTableWidth = Math.max(virtualPageGridSize, 32);
    const pageTableHeaderRows = Math.ceil(clipmapVec4Count / pageTableWidth);
    const pageTableHeight =
        pageTableHeaderRows +
        MAX_DIRECTIONAL_VIRTUAL_LIGHTS * directionalClipmapLevels * virtualPageGridSize;
    return Object.freeze({
        virtualResolution,
        pageSize,
        virtualPageGridSize,
        physicalPageCount,
        physicalPageColumns,
        physicalPageRows,
        physicalAtlasWidth: physicalPageColumns * pageSize,
        physicalAtlasHeight: physicalPageRows * pageSize,
        maxPageUpdatesPerFrame,
        directionalClipmapLevels,
        firstDirectionalClipmapExtent,
        pageTableWidth,
        pageTableHeaderRows,
        pageTableHeight,
        clipmapVec4Count
    });
}

function computePass(shader: ComputeShader): ComputeRenderPass {
    return new ComputeRenderPass(new ComputeKernel({ label: shader.label, shader }), shader.label);
}

function matrixToArray(matrix: Matrix4, target: Float32Array, offset: number): void {
    for (let index = 0; index < 16; index += 1) {
        target[offset + index] = matrix.elements[index] ?? 0;
    }
}

class DirectionalClipmapState {
    readonly data: ArrayBuffer;
    readonly floats: Float32Array;
    readonly uints: Uint32Array;
    readonly #view = new Matrix4();
    readonly #projection = new Matrix4();
    readonly #viewProjection = new Matrix4();
    readonly #inverseView = new Matrix4();
    readonly #previousView = new Matrix4();
    readonly #previousInverseView = new Matrix4();
    readonly #eye = new Vector3();
    readonly #target = new Vector3();
    readonly #up = new Vector3();
    readonly #committedLights: (DirectionalLight | null)[] = Array.from(
        { length: MAX_DIRECTIONAL_VIRTUAL_LIGHTS },
        () => null
    );
    readonly #pendingLights: (DirectionalLight | null)[] = Array.from(
        { length: MAX_DIRECTIONAL_VIRTUAL_LIGHTS },
        () => null
    );
    readonly #committedDirections = new Float32Array(MAX_DIRECTIONAL_VIRTUAL_LIGHTS * 3);
    readonly #pendingDirections = new Float32Array(MAX_DIRECTIONAL_VIRTUAL_LIGHTS * 3);
    readonly #committedEpochs = new Uint32Array(MAX_DIRECTIONAL_VIRTUAL_LIGHTS);
    readonly #pendingEpochs = new Uint32Array(MAX_DIRECTIONAL_VIRTUAL_LIGHTS);
    readonly #committedDepthCells = new Int32Array(MAX_DIRECTIONAL_VIRTUAL_LIGHTS);
    readonly #pendingDepthCells = new Int32Array(MAX_DIRECTIONAL_VIRTUAL_LIGHTS);
    #pendingFrame = -1;

    constructor(readonly settings: Readonly<VirtualShadowMapSettings>) {
        this.data = new ArrayBuffer(settings.clipmapVec4Count * 16);
        this.floats = new Float32Array(this.data);
        this.uints = new Uint32Array(this.data);
    }

    stage(
        frameIndex: number,
        camera: Camera,
        shadows: Readonly<RenderPipelineShadowResources>,
        cameraHistoryValid: boolean,
        previousViewMatrix: ArrayLike<number>,
        stateValid: boolean,
        bucketCount: number,
        visibleBucketCapacity: number
    ): number {
        const settings = this.settings;
        const lightCount = Math.min(shadows.directionalShadowCount, MAX_DIRECTIONAL_VIRTUAL_LIGHTS);
        this.floats.fill(0);
        this.floats[0] = lightCount;
        this.floats[1] = settings.directionalClipmapLevels;
        this.floats[2] = settings.virtualPageGridSize;
        this.floats[3] = settings.pageSize;
        this.floats[4] = settings.physicalAtlasWidth;
        this.floats[5] = settings.physicalAtlasHeight;
        this.floats[6] = settings.physicalPageColumns;
        this.floats[7] = settings.physicalPageRows;
        this.uints[8] = frameIndex >>> 0;
        this.uints[9] = settings.maxPageUpdatesPerFrame;
        this.uints[10] = cameraHistoryValid ? 1 : 0;
        this.uints[11] = shadows.depthMode === 'reversed' ? 1 : 0;
        this.uints[12] = settings.pageTableHeaderRows;
        this.uints[13] = bucketCount;
        this.uints[14] = visibleBucketCapacity;
        this.uints[15] = settings.physicalPageCount;
        this.uints[16] = stateValid ? 1 : 0;
        this.uints[17] = lightCount * settings.directionalClipmapLevels;
        this.uints[18] = settings.pageTableWidth;
        this.uints[19] = settings.pageTableHeight;

        this.#inverseView.invert(camera.viewMatrix);
        matrixToArray(this.#inverseView, this.floats, 20);
        this.#previousView.fromArray(
            cameraHistoryValid ? previousViewMatrix : camera.viewMatrix.elements
        );
        this.#previousInverseView.invert(this.#previousView);
        matrixToArray(this.#previousInverseView, this.floats, 36);

        const cameraX = camera.worldMatrix.elements[12];
        const cameraY = camera.worldMatrix.elements[13];
        const cameraZ = camera.worldMatrix.elements[14];
        const cameraFar = Math.max(
            settings.firstDirectionalClipmapExtent,
            typeof Reflect.get(camera, 'far') === 'number'
                ? (Reflect.get(camera, 'far') as number)
                : settings.firstDirectionalClipmapExtent * 16
        );

        for (let lightIndex = 0; lightIndex < MAX_DIRECTIONAL_VIRTUAL_LIGHTS; lightIndex += 1) {
            const light =
                lightIndex < lightCount ? shadows.directionalLights[lightIndex] : undefined;
            this.#pendingLights[lightIndex] = light ?? null;
            if (light === undefined) {
                this.#pendingEpochs[lightIndex] = this.#committedEpochs[lightIndex] ?? 0;
                this.#pendingDepthCells[lightIndex] = this.#committedDepthCells[lightIndex] ?? 0;
                continue;
            }
            const direction = light.getWorldDirection();
            const directionOffset = lightIndex * 3;
            this.#pendingDirections[directionOffset] = direction.x;
            this.#pendingDirections[directionOffset + 1] = direction.y;
            this.#pendingDirections[directionOffset + 2] = direction.z;
            const dzX = -direction.x;
            const dzY = -direction.y;
            const dzZ = -direction.z;
            const useXAxis = Math.abs(dzY) > 0.95;
            const upX = useXAxis ? 1 : 0;
            const upY = useXAxis ? 0 : 1;
            const upZ = 0;
            let rightX = upY * dzZ - upZ * dzY;
            let rightY = upZ * dzX - upX * dzZ;
            let rightZ = upX * dzY - upY * dzX;
            const rightLength = Math.hypot(rightX, rightY, rightZ);
            rightX /= rightLength;
            rightY /= rightLength;
            rightZ /= rightLength;
            const planeUpX = dzY * rightZ - dzZ * rightY;
            const planeUpY = dzZ * rightX - dzX * rightZ;
            const planeUpZ = dzX * rightY - dzY * rightX;
            const cameraPlaneX = cameraX * rightX + cameraY * rightY + cameraZ * rightZ;
            const cameraPlaneY = cameraX * planeUpX + cameraY * planeUpY + cameraZ * planeUpZ;
            const cameraPlaneZ = cameraX * dzX + cameraY * dzY + cameraZ * dzZ;
            const depthWorldSize =
                settings.firstDirectionalClipmapExtent / settings.virtualPageGridSize;
            const depthCell = Math.round(cameraPlaneZ / depthWorldSize);
            const snappedPlaneZ = depthCell * depthWorldSize;
            this.#pendingDepthCells[lightIndex] = depthCell;
            const changed =
                this.#committedLights[lightIndex] !== light ||
                this.#committedDirections[directionOffset] !== direction.x ||
                this.#committedDirections[directionOffset + 1] !== direction.y ||
                this.#committedDirections[directionOffset + 2] !== direction.z ||
                this.#committedDepthCells[lightIndex] !== depthCell;
            const previousEpoch = this.#committedEpochs[lightIndex] ?? 0;
            this.#pendingEpochs[lightIndex] = changed ? (previousEpoch + 1) >>> 0 : previousEpoch;

            for (let level = 0; level < settings.directionalClipmapLevels; level += 1) {
                const extent = settings.firstDirectionalClipmapExtent * 2 ** level;
                const pageWorldSize = extent / settings.virtualPageGridSize;
                const snappedX = Math.round(cameraPlaneX / pageWorldSize) * pageWorldSize;
                const snappedY = Math.round(cameraPlaneY / pageWorldSize) * pageWorldSize;
                const centerX = rightX * snappedX + planeUpX * snappedY + dzX * snappedPlaneZ;
                const centerY = rightY * snappedX + planeUpY * snappedY + dzY * snappedPlaneZ;
                const centerZ = rightZ * snappedX + planeUpZ * snappedY + dzZ * snappedPlaneZ;
                const depthHalf = Math.max(cameraFar, extent) * 1.25;
                this.#eye.set(
                    centerX - direction.x * depthHalf,
                    centerY - direction.y * depthHalf,
                    centerZ - direction.z * depthHalf
                );
                this.#target.set(centerX, centerY, centerZ);
                this.#up.set(planeUpX, planeUpY, planeUpZ);
                this.#view.lookAt(this.#eye, this.#target, this.#up);
                const halfExtent = extent * 0.5;
                const near = 0.1;
                const far = depthHalf * 2 + near;
                this.#projection.ortho(
                    -halfExtent,
                    halfExtent,
                    -halfExtent,
                    halfExtent,
                    shadows.depthMode === 'reversed' ? far : near,
                    shadows.depthMode === 'reversed' ? near : far
                );
                this.#viewProjection.multiply(this.#projection, this.#view);
                const mapIndex = lightIndex * settings.directionalClipmapLevels + level;
                const mapVec4 = CLIPMAP_HEADER_VEC4_COUNT + mapIndex * CLIPMAP_MAP_VEC4_COUNT;
                matrixToArray(this.#viewProjection, this.floats, mapVec4 * 4);
                const params = (mapVec4 + 4) * 4;
                this.uints[params] =
                    (Math.round(snappedX / pageWorldSize) - settings.virtualPageGridSize / 2) >>> 0;
                this.uints[params + 1] =
                    (-Math.round(snappedY / pageWorldSize) - settings.virtualPageGridSize / 2) >>>
                    0;
                this.uints[params + 2] = this.#pendingEpochs[lightIndex] ?? 0;
                this.uints[params + 3] = mapIndex;
            }
        }
        this.#pendingFrame = frameIndex;
        return lightCount;
    }

    frameSubmitted(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        for (let index = 0; index < MAX_DIRECTIONAL_VIRTUAL_LIGHTS; index += 1) {
            this.#committedLights[index] = this.#pendingLights[index] ?? null;
            this.#committedEpochs[index] = this.#pendingEpochs[index] ?? 0;
        }
        this.#committedDirections.set(this.#pendingDirections);
        this.#committedDepthCells.set(this.#pendingDepthCells);
        this.#pendingFrame = -1;
    }

    frameDiscarded(frameIndex: number): void {
        if (frameIndex === this.#pendingFrame) this.#pendingFrame = -1;
    }
}

const FRAME_WGSL = `
struct FrameData {
    currentViewProjection: mat4x4<f32>,
    previousViewProjection: mat4x4<f32>,
    view: mat4x4<f32>,
    projection: mat4x4<f32>,
    previousView: mat4x4<f32>,
    previousProjection: mat4x4<f32>,
    viewport: vec4<f32>,
    depth: vec4<f32>,
    previousDepth: vec4<f32>,
    cluster: vec4<u32>,
    counts: vec4<u32>,
    budgets: vec4<u32>,
    directional: vec4<u32>,
    ambient: vec4<f32>,
};
struct ObjectRecord {
    model0: vec4<f32>, model1: vec4<f32>, model2: vec4<f32>, model3: vec4<f32>,
    previous0: vec4<f32>, previous1: vec4<f32>, previous2: vec4<f32>, previous3: vec4<f32>,
    normal0: vec4<f32>, normal1: vec4<f32>, normal2: vec4<f32>,
    bounds: vec4<f32>,
    metadata: vec4<u32>,
};
struct BucketRecord {
    indices0: vec4<u32>,
    indices1: vec4<u32>,
    thresholds: vec4<f32>,
};
fn objectModel(object: ObjectRecord) -> mat4x4<f32> {
    return mat4x4<f32>(object.model0, object.model1, object.model2, object.model3);
}
fn objectPreviousModel(object: ObjectRecord) -> mat4x4<f32> {
    return mat4x4<f32>(
        object.previous0, object.previous1, object.previous2, object.previous3
    );
}
fn maximumScale(model: mat4x4<f32>) -> f32 {
    return max(length(model[0].xyz), max(length(model[1].xyz), length(model[2].xyz)));
}
`;

const CLIPMAP_WGSL = `
fn clipmapFloat(index: u32) -> vec4<f32> {
    return bitcast<vec4<f32>>(clipmapData[index]);
}
fn clipmapMatrix(mapIndex: u32) -> mat4x4<f32> {
    let base = ${String(CLIPMAP_HEADER_VEC4_COUNT)}u + mapIndex * ${String(CLIPMAP_MAP_VEC4_COUNT)}u;
    return mat4x4<f32>(
        clipmapFloat(base), clipmapFloat(base + 1u),
        clipmapFloat(base + 2u), clipmapFloat(base + 3u)
    );
}
fn clipmapIdentity(mapIndex: u32) -> vec4<u32> {
    return clipmapData[${String(CLIPMAP_HEADER_VEC4_COUNT)}u + mapIndex * ${String(CLIPMAP_MAP_VEC4_COUNT)}u + 4u];
}
fn clipmapInversePreviousView() -> mat4x4<f32> {
    return mat4x4<f32>(
        clipmapFloat(9u), clipmapFloat(10u), clipmapFloat(11u), clipmapFloat(12u)
    );
}
fn virtualPageBitIndex(mapIndex: u32, page: vec2<u32>) -> u32 {
    let grid = u32(clipmapFloat(0u).z + 0.5);
    return mapIndex * grid * grid + page.y * grid + page.x;
}
`;

function requestPass(): ComputeRenderPass {
    return computePass(
        new ComputeShader({
            label: 'Virtual shadow receiver depth page requests',
            source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clipmapData: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read_write> requestBits: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> statistics: array<atomic<u32>>;
@group(0) @binding(4) var previousHiZ: texture_2d<f32>;
${CLIPMAP_WGSL}
fn markRequested(mapIndex: u32, page: vec2<i32>) {
    let grid = i32(clipmapFloat(0u).z + 0.5);
    if (any(page < vec2<i32>(0)) || any(page >= vec2<i32>(grid))) { return; }
    let bitIndex = virtualPageBitIndex(mapIndex, vec2<u32>(page));
    let word = bitIndex >> 5u;
    let mask = 1u << (bitIndex & 31u);
    let previous = atomicOr(&requestBits[word], mask);
    if ((previous & mask) == 0u) { _ = atomicAdd(&statistics[0], 1u); }
}
fn reconstructPreviousWorld(uv: vec2<f32>, deviceDepth: f32) -> vec3<f32> {
    let ndc = vec3<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, deviceDepth * 2.0 - 1.0);
    let viewZ = -frameData.previousProjection[3][2] /
        (ndc.z + frameData.previousProjection[2][2]);
    let viewX = -(ndc.x + frameData.previousProjection[2][0]) * viewZ /
        frameData.previousProjection[0][0];
    let viewY = -(ndc.y + frameData.previousProjection[2][1]) * viewZ /
        frameData.previousProjection[1][1];
    let world = clipmapInversePreviousView() * vec4<f32>(viewX, viewY, viewZ, 1.0);
    return world.xyz / max(abs(world.w), 0.000001) * sign(world.w);
}
@compute @workgroup_size(${String(REQUEST_WORKGROUP_SIZE)}, ${String(REQUEST_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = textureDimensions(previousHiZ);
    if (any(id.xy >= size) || clipmapData[2u].z == 0u) { return; }
    let bounds = textureLoad(previousHiZ, vec2<i32>(id.xy), 0).xy;
    let reversed = clipmapData[2u].w != 0u;
    let depth = select(bounds.x, bounds.y, reversed);
    let empty = select(depth >= 0.999999, depth <= 0.000001, reversed);
    if (empty) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
    let world = reconstructPreviousWorld(uv, depth);
    let lightCount = u32(clipmapFloat(0u).x + 0.5);
    let levels = u32(clipmapFloat(0u).y + 0.5);
    let grid = u32(clipmapFloat(0u).z + 0.5);
    for (var light = 0u; light < lightCount; light += 1u) {
        var selected = 0xffffffffu;
        var selectedPage = vec2<i32>(0);
        for (var level = 0u; level < levels; level += 1u) {
            let mapIndex = light * levels + level;
            let clip = clipmapMatrix(mapIndex) * vec4<f32>(world, 1.0);
            if (clip.w <= 0.0) { continue; }
            let logicalUv = vec2<f32>(
                clip.x / clip.w * 0.5 + 0.5,
                0.5 - clip.y / clip.w * 0.5
            );
            if (all(logicalUv >= vec2<f32>(0.0)) && all(logicalUv < vec2<f32>(1.0))) {
                selected = mapIndex;
                selectedPage = vec2<i32>(logicalUv * f32(grid));
                break;
            }
        }
        if (selected == 0xffffffffu) { continue; }
        for (var y = -1; y <= 1; y += 1) {
            for (var x = -1; x <= 1; x += 1) {
                markRequested(selected, selectedPage + vec2<i32>(x, y));
            }
        }
        let coarse = selected + 1u;
        if ((coarse % levels) != 0u) {
            let clip = clipmapMatrix(coarse) * vec4<f32>(world, 1.0);
            let logicalUv = vec2<f32>(
                clip.x / clip.w * 0.5 + 0.5,
                0.5 - clip.y / clip.w * 0.5
            );
            markRequested(coarse, vec2<i32>(logicalUv * f32(grid)));
        }
    }
}`,
            workgroupSize: [REQUEST_WORKGROUP_SIZE, REQUEST_WORKGROUP_SIZE],
            bindings: [
                { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
                { name: 'clipmapData', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
                {
                    name: 'requestBits',
                    group: 0,
                    binding: 2,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'statistics',
                    group: 0,
                    binding: 3,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'previousHiZ',
                    group: 0,
                    binding: 4,
                    kind: 'sampled-texture',
                    sampleType: 'unfilterable-float'
                }
            ]
        })
    );
}

const INVALIDATION_PASS = computePass(
    new ComputeShader({
        label: 'Virtual shadow changed-caster page invalidation',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clipmapData: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> objects: array<ObjectRecord>;
@group(0) @binding(3) var<storage, read_write> dirtyBits: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> statistics: array<atomic<u32>>;
${CLIPMAP_WGSL}
fn markDirty(mapIndex: u32, page: vec2<u32>) {
    let bitIndex = virtualPageBitIndex(mapIndex, page);
    let word = bitIndex >> 5u;
    let mask = 1u << (bitIndex & 31u);
    let previous = atomicOr(&dirtyBits[word], mask);
    if ((previous & mask) == 0u) { _ = atomicAdd(&statistics[5], 1u); }
}
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.counts.x || id.x >= frameData.budgets.x) { return; }
    let object = objects[id.x];
    let flags = object.metadata.z;
    if ((flags & 129u) != 129u) { return; }
    let currentModel = objectModel(object);
    let previousModel = objectPreviousModel(object);
    let currentWorld = currentModel * vec4<f32>(object.bounds.xyz, 1.0);
    let previousWorld = previousModel * vec4<f32>(object.bounds.xyz, 1.0);
    let currentRadius = object.bounds.w * maximumScale(currentModel);
    let previousRadius = object.bounds.w * maximumScale(previousModel);
    let mapCount = clipmapData[4u].y;
    let grid = u32(clipmapFloat(0u).z + 0.5);
    for (var mapIndex = 0u; mapIndex < mapCount; mapIndex += 1u) {
        let matrix = clipmapMatrix(mapIndex);
        let currentClip = matrix * currentWorld;
        let previousClip = matrix * previousWorld;
        if (currentClip.w <= 0.0 && previousClip.w <= 0.0) { continue; }
        let rowX = vec3<f32>(matrix[0].x, matrix[1].x, matrix[2].x);
        let rowY = vec3<f32>(matrix[0].y, matrix[1].y, matrix[2].y);
        let axisScale = vec2<f32>(length(rowX), length(rowY)) * 0.5;
        let currentRadiusUv = axisScale * currentRadius;
        let previousRadiusUv = axisScale * previousRadius;
        let currentCenterUv = vec2<f32>(
            currentClip.x / currentClip.w * 0.5 + 0.5,
            0.5 - currentClip.y / currentClip.w * 0.5
        );
        let previousCenterUv = vec2<f32>(
            previousClip.x / previousClip.w * 0.5 + 0.5,
            0.5 - previousClip.y / previousClip.w * 0.5
        );
        let minimumUv = min(
            currentCenterUv - currentRadiusUv,
            previousCenterUv - previousRadiusUv
        );
        let maximumUv = max(
            currentCenterUv + currentRadiusUv,
            previousCenterUv + previousRadiusUv
        );
        if (any(maximumUv < vec2<f32>(0.0)) || any(minimumUv >= vec2<f32>(1.0))) { continue; }
        let minimum = clamp(floor(minimumUv * f32(grid)), vec2<f32>(0.0), vec2<f32>(f32(grid - 1u)));
        let maximum = clamp(floor(maximumUv * f32(grid)), vec2<f32>(0.0), vec2<f32>(f32(grid - 1u)));
        for (var y = u32(minimum.y); y <= u32(maximum.y); y += 1u) {
            for (var x = u32(minimum.x); x <= u32(maximum.x); x += 1u) {
                markDirty(mapIndex, vec2<u32>(x, y));
            }
        }
    }
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'clipmapData', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            { name: 'objects', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
            {
                name: 'dirtyBits',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'statistics',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write'
            }
        ]
    })
);

function allocatorPass(settings: Readonly<VirtualShadowMapSettings>): ComputeRenderPass {
    const recordWords = PHYSICAL_PAGE_STRIDE_BYTES / 4;
    return computePass(
        new ComputeShader({
            label: 'Virtual shadow deterministic page-table allocation and remap',
            source: `
@group(0) @binding(0) var<storage, read> clipmapData: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> requestBits: array<u32>;
@group(0) @binding(2) var<storage, read> dirtyBits: array<u32>;
@group(0) @binding(3) var<storage, read> previousPhysical: array<u32>;
@group(0) @binding(4) var<storage, read_write> currentPhysical: array<u32>;
@group(0) @binding(5) var<storage, read_write> clearArguments: array<u32>;
@group(0) @binding(6) var<storage, read_write> shadowArguments: array<u32>;
@group(0) @binding(7) var<storage, read_write> statistics: array<u32>;
@group(0) @binding(8) var pageTable: texture_storage_2d<rgba32float, write>;
fn clipmapFloat(index: u32) -> vec4<f32> { return bitcast<vec4<f32>>(clipmapData[index]); }
fn requested(bitIndex: u32) -> bool {
    return (requestBits[bitIndex >> 5u] & (1u << (bitIndex & 31u))) != 0u;
}
fn dirty(bitIndex: u32) -> bool {
    return (dirtyBits[bitIndex >> 5u] & (1u << (bitIndex & 31u))) != 0u;
}
fn physicalBase(index: u32) -> u32 { return index * ${String(recordWords)}u; }
fn previousBitIndex(base: u32) -> u32 {
    if (previousPhysical[base + 5u] == 0u) { return 0xffffffffu; }
    let mapIndex = previousPhysical[base];
    if (mapIndex >= clipmapData[4u].y) { return 0xffffffffu; }
    let identity = clipmapData[${String(CLIPMAP_HEADER_VEC4_COUNT)}u + mapIndex * ${String(CLIPMAP_MAP_VEC4_COUNT)}u + 4u];
    if (previousPhysical[base + 3u] != identity.z) { return 0xffffffffu; }
    let grid = i32(clipmapFloat(0u).z + 0.5);
    let page = vec2<i32>(
        bitcast<i32>(previousPhysical[base + 1u]) - bitcast<i32>(identity.x),
        bitcast<i32>(previousPhysical[base + 2u]) - bitcast<i32>(identity.y)
    );
    if (any(page < vec2<i32>(0)) || any(page >= vec2<i32>(grid))) {
        return 0xffffffffu;
    }
    let unsignedGrid = u32(grid);
    return mapIndex * unsignedGrid * unsignedGrid +
        u32(page.y) * unsignedGrid + u32(page.x);
}
fn sameIdentity(base: u32, mapIndex: u32, absolutePage: vec2<i32>, epoch: u32) -> bool {
    return previousPhysical[base + 5u] != 0u &&
        previousPhysical[base] == mapIndex &&
        bitcast<i32>(previousPhysical[base + 1u]) == absolutePage.x &&
        bitcast<i32>(previousPhysical[base + 2u]) == absolutePage.y &&
        previousPhysical[base + 3u] == epoch;
}
@compute @workgroup_size(1)
fn main() {
    let tableSize = textureDimensions(pageTable);
    for (var y = 0u; y < tableSize.y; y += 1u) {
        for (var x = 0u; x < tableSize.x; x += 1u) {
            textureStore(pageTable, vec2<i32>(i32(x), i32(y)), vec4<f32>(0.0));
        }
    }
    let headerCount = ${String(settings.clipmapVec4Count)}u;
    for (var index = 0u; index < headerCount; index += 1u) {
        let x = index % tableSize.x;
        let y = index / tableSize.x;
        var value = bitcast<vec4<f32>>(clipmapData[index]);
        if (index >= 2u && index <= 4u) {
            value = vec4<f32>(clipmapData[index]);
        } else if (
            index >= ${String(CLIPMAP_HEADER_VEC4_COUNT)}u &&
            ((index - ${String(CLIPMAP_HEADER_VEC4_COUNT)}u) % ${String(CLIPMAP_MAP_VEC4_COUNT)}u) == 4u
        ) {
            let identity = clipmapData[index];
            value = vec4<f32>(
                f32(bitcast<i32>(identity.x)),
                f32(bitcast<i32>(identity.y)),
                f32(identity.z),
                f32(identity.w)
            );
        }
        textureStore(pageTable, vec2<i32>(i32(x), i32(y)), value);
    }
    let physicalCount = clipmapData[3u].w;
    let bucketCount = clipmapData[3u].y;
    let stateValid = clipmapData[4u].x != 0u;
    for (var physical = 0u; physical < physicalCount; physical += 1u) {
        let base = physicalBase(physical);
        for (var word = 0u; word < ${String(recordWords)}u; word += 1u) {
            currentPhysical[base + word] = select(0u, previousPhysical[base + word], stateValid);
        }
        currentPhysical[base + 6u] = 0u;
        currentPhysical[base + 7u] = 0u;
        let previousBit = previousBitIndex(base);
        if (stateValid && previousBit != 0xffffffffu && dirty(previousBit)) {
            currentPhysical[base + 8u] = 1u;
        }
        let clearBase = physical * 4u;
        clearArguments[clearBase] = 3u;
        clearArguments[clearBase + 1u] = 0u;
        clearArguments[clearBase + 2u] = 0u;
        clearArguments[clearBase + 3u] = 0u;
        for (var bucket = 0u; bucket < bucketCount; bucket += 1u) {
            shadowArguments[(physical * bucketCount + bucket) * 5u + 1u] = 0u;
        }
    }
    let lightCount = u32(clipmapFloat(0u).x + 0.5);
    let levels = u32(clipmapFloat(0u).y + 0.5);
    let grid = u32(clipmapFloat(0u).z + 0.5);
    let headerRows = clipmapData[3u].x;
    let frameIndex = clipmapData[2u].x;
    let updateBudget = clipmapData[2u].y;
    var rendered = 0u;
    var deferred = 0u;
    var evictions = 0u;
    var resident = 0u;
    for (var mapIndex = 0u; mapIndex < lightCount * levels; mapIndex += 1u) {
        let identity = clipmapData[${String(CLIPMAP_HEADER_VEC4_COUNT)}u + mapIndex * ${String(CLIPMAP_MAP_VEC4_COUNT)}u + 4u];
        let origin = vec2<i32>(bitcast<i32>(identity.x), bitcast<i32>(identity.y));
        let epoch = identity.z;
        for (var y = 0u; y < grid; y += 1u) {
            for (var x = 0u; x < grid; x += 1u) {
                let bitIndex = mapIndex * grid * grid + y * grid + x;
                if (!requested(bitIndex)) { continue; }
                let absolutePage = origin + vec2<i32>(i32(x), i32(y));
                var selected = 0xffffffffu;
                for (var physical = 0u; physical < physicalCount; physical += 1u) {
                    let base = physicalBase(physical);
                    if (
                        currentPhysical[base + 7u] == 0u &&
                        sameIdentity(base, mapIndex, absolutePage, epoch)
                    ) {
                        selected = physical;
                        break;
                    }
                }
                var needsUpdate = dirty(bitIndex);
                if (selected != 0xffffffffu) {
                    needsUpdate = needsUpdate || previousPhysical[physicalBase(selected) + 8u] != 0u;
                }
                if (selected == 0xffffffffu) {
                    var candidate = 0xffffffffu;
                    var oldest = 0xffffffffu;
                    for (var physical = 0u; physical < physicalCount; physical += 1u) {
                        let base = physicalBase(physical);
                        if (currentPhysical[base + 7u] != 0u) { continue; }
                        if (currentPhysical[base + 5u] == 0u) {
                            candidate = physical;
                            break;
                        }
                        let age = currentPhysical[base + 4u];
                        if (age <= oldest) {
                            oldest = age;
                            candidate = physical;
                        }
                    }
                    if (candidate != 0xffffffffu && rendered < updateBudget) {
                        selected = candidate;
                        let base = physicalBase(selected);
                        if (currentPhysical[base + 5u] != 0u) { evictions += 1u; }
                        currentPhysical[base] = mapIndex;
                        currentPhysical[base + 1u] = bitcast<u32>(absolutePage.x);
                        currentPhysical[base + 2u] = bitcast<u32>(absolutePage.y);
                        currentPhysical[base + 3u] = epoch;
                        currentPhysical[base + 5u] = 1u;
                        needsUpdate = true;
                    }
                }
                if (selected == 0xffffffffu) {
                    deferred += 1u;
                    continue;
                }
                let base = physicalBase(selected);
                currentPhysical[base + 4u] = frameIndex;
                currentPhysical[base + 7u] = 1u;
                if (needsUpdate) {
                    if (rendered < updateBudget) {
                        currentPhysical[base + 6u] = 1u;
                        currentPhysical[base + 8u] = 0u;
                        clearArguments[selected * 4u + 1u] = 1u;
                        rendered += 1u;
                    } else {
                        currentPhysical[base + 8u] = 1u;
                        deferred += 1u;
                        continue;
                    }
                }
                let tableY = headerRows + mapIndex * grid + y;
                textureStore(
                    pageTable,
                    vec2<i32>(i32(x), i32(tableY)),
                    vec4<f32>(f32(selected + 1u), f32(absolutePage.x), f32(absolutePage.y), f32(epoch))
                );
            }
        }
    }
    for (var physical = 0u; physical < physicalCount; physical += 1u) {
        let base = physicalBase(physical);
        if (currentPhysical[base + 5u] != 0u) { resident += 1u; }
        currentPhysical[base + 7u] = physical;
    }
    statistics[1] = rendered;
    statistics[2] = deferred;
    statistics[3] = resident;
    statistics[4] = evictions;
    statistics[6] = physicalCount;
    statistics[7] = levels;
}`,
            workgroupSize: [1],
            bindings: [
                { name: 'clipmapData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
                { name: 'requestBits', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
                { name: 'dirtyBits', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
                {
                    name: 'previousPhysical',
                    group: 0,
                    binding: 3,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'currentPhysical',
                    group: 0,
                    binding: 4,
                    kind: 'storage-buffer',
                    access: 'write-discard'
                },
                {
                    name: 'clearArguments',
                    group: 0,
                    binding: 5,
                    kind: 'storage-buffer',
                    access: 'write-discard'
                },
                {
                    name: 'shadowArguments',
                    group: 0,
                    binding: 6,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'statistics',
                    group: 0,
                    binding: 7,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'pageTable',
                    group: 0,
                    binding: 8,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba32float'
                }
            ]
        })
    );
}

const PAGE_CULL_PASS = computePass(
    new ComputeShader({
        label: 'Virtual shadow per-page caster culling',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clipmapData: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> physicalPages: array<u32>;
@group(0) @binding(3) var<storage, read> objects: array<ObjectRecord>;
@group(0) @binding(4) var<storage, read> buckets: array<BucketRecord>;
@group(0) @binding(5) var<storage, read_write> selectedBuckets: array<u32>;
@group(0) @binding(6) var<storage, read_write> shadowArguments: array<atomic<u32>>;
${CLIPMAP_WGSL}
fn physicalBase(index: u32) -> u32 {
    return index * ${String(PHYSICAL_PAGE_STRIDE_BYTES / 4)}u;
}
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let objectIndex = id.x;
    let physicalIndex = id.y;
    let objectCount = frameData.counts.x;
    let maximumObjects = frameData.budgets.x;
    if (objectIndex >= objectCount || objectIndex >= maximumObjects) { return; }
    let base = physicalBase(physicalIndex);
    let selectedIndex = physicalIndex * maximumObjects + objectIndex;
    selectedBuckets[selectedIndex] = 0xffffffffu;
    if (physicalPages[base + 6u] == 0u) { return; }
    let object = objects[objectIndex];
    let flags = object.metadata.z;
    if ((flags & 65u) != 65u || (object.metadata.y & frameData.budgets.w) == 0u) { return; }
    let mapIndex = physicalPages[base];
    let identity = clipmapIdentity(mapIndex);
    let page = vec2<i32>(
        bitcast<i32>(physicalPages[base + 1u]) - bitcast<i32>(identity.x),
        bitcast<i32>(physicalPages[base + 2u]) - bitcast<i32>(identity.y)
    );
    let grid = u32(clipmapFloat(0u).z + 0.5);
    if (any(page < vec2<i32>(0)) || any(page >= vec2<i32>(i32(grid)))) { return; }
    let model = objectModel(object);
    let center = model * vec4<f32>(object.bounds.xyz, 1.0);
    let radius = object.bounds.w * maximumScale(model);
    let matrix = clipmapMatrix(mapIndex);
    let clip = matrix * center;
    if (clip.w <= 0.0) { return; }
    let rowX = vec3<f32>(matrix[0].x, matrix[1].x, matrix[2].x);
    let rowY = vec3<f32>(matrix[0].y, matrix[1].y, matrix[2].y);
    let rowZ = vec3<f32>(matrix[0].z, matrix[1].z, matrix[2].z);
    let radiusNdc = vec3<f32>(length(rowX), length(rowY), length(rowZ)) * radius / clip.w;
    let centerNdc = clip.xyz / clip.w;
    let pageMinimum = vec2<f32>(page) / f32(grid) * 2.0 - vec2<f32>(1.0);
    let pageMaximum = vec2<f32>(page + vec2<i32>(1)) / f32(grid) * 2.0 - vec2<f32>(1.0);
    let yMinimum = -pageMaximum.y;
    let yMaximum = -pageMinimum.y;
    if (
        centerNdc.x + radiusNdc.x < pageMinimum.x ||
        centerNdc.x - radiusNdc.x > pageMaximum.x ||
        centerNdc.y + radiusNdc.y < yMinimum ||
        centerNdc.y - radiusNdc.y > yMaximum ||
        centerNdc.z + radiusNdc.z < -1.0 ||
        centerNdc.z - radiusNdc.z > 1.0
    ) { return; }
    let bucket = buckets[object.metadata.x].indices0.x;
    let bucketCount = clipmapData[3u].y;
    let indirectIndex = (physicalIndex * bucketCount + bucket) * 5u;
    _ = atomicAdd(&shadowArguments[indirectIndex + 1u], 1u);
    selectedBuckets[selectedIndex] = bucket;
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'clipmapData', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            { name: 'physicalPages', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
            { name: 'objects', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
            { name: 'buckets', group: 0, binding: 4, kind: 'read-only-storage-buffer' },
            {
                name: 'selectedBuckets',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'shadowArguments',
                group: 0,
                binding: 6,
                kind: 'storage-buffer',
                access: 'read-write'
            }
        ]
    })
);

const PAGE_BUCKET_PREFIX_PASS = computePass(
    new ComputeShader({
        label: 'Virtual shadow per-page bucket prefix',
        source: `
@group(0) @binding(0) var<storage, read> clipmapData: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> physicalPages: array<u32>;
@group(0) @binding(2) var<storage, read_write> shadowArguments: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> bucketCursors: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> bucketOffsets: array<u32>;
fn physicalBase(index: u32) -> u32 {
    return index * ${String(PHYSICAL_PAGE_STRIDE_BYTES / 4)}u;
}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let physicalIndex = id.x;
    let bucketCount = clipmapData[3u].y;
    let visibleCapacity = clipmapData[3u].z;
    var offset = physicalIndex * visibleCapacity;
    for (var bucket = 0u; bucket < bucketCount; bucket += 1u) {
        let entry = physicalIndex * bucketCount + bucket;
        atomicStore(&bucketCursors[entry], 0u);
        bucketOffsets[entry * ${String(BUCKET_OFFSET_STRIDE_BYTES / 4)}u] = offset;
        let indirect = entry * 5u;
        let count = select(0u, atomicLoad(&shadowArguments[indirect + 1u]), physicalPages[physicalBase(physicalIndex) + 6u] != 0u);
        atomicStore(&shadowArguments[indirect + 4u], offset);
        offset += count;
    }
}`,
        workgroupSize: [1],
        bindings: [
            { name: 'clipmapData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'physicalPages', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'shadowArguments',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'bucketCursors',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'bucketOffsets',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

const PAGE_VISIBLE_COMPACT_PASS = computePass(
    new ComputeShader({
        label: 'Virtual shadow per-page visible caster compact',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clipmapData: array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> selectedBuckets: array<u32>;
@group(0) @binding(3) var<storage, read_write> bucketCursors: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> bucketOffsets: array<u32>;
@group(0) @binding(5) var<storage, read_write> visibleIndices: array<u32>;
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let objectIndex = id.x;
    let physicalIndex = id.y;
    let maximumObjects = frameData.budgets.x;
    if (objectIndex >= frameData.counts.x || objectIndex >= maximumObjects) { return; }
    let bucket = selectedBuckets[physicalIndex * maximumObjects + objectIndex];
    if (bucket == 0xffffffffu) { return; }
    let bucketCount = clipmapData[3u].y;
    let entry = physicalIndex * bucketCount + bucket;
    let localIndex = atomicAdd(&bucketCursors[entry], 1u);
    let offset = bucketOffsets[entry * ${String(BUCKET_OFFSET_STRIDE_BYTES / 4)}u];
    visibleIndices[offset + localIndex] = objectIndex;
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'clipmapData', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'selectedBuckets',
                group: 0,
                binding: 2,
                kind: 'read-only-storage-buffer'
            },
            {
                name: 'bucketCursors',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'bucketOffsets',
                group: 0,
                binding: 4,
                kind: 'read-only-storage-buffer'
            },
            {
                name: 'visibleIndices',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

/** Return the aligned storage-binding range for one physical-page record. */
export function virtualShadowPhysicalPageRange(
    physicalPageIndex: number
): Readonly<{ byteOffset: number; byteLength: number }> {
    return Object.freeze({
        byteOffset: physicalPageIndex * PHYSICAL_PAGE_STRIDE_BYTES,
        byteLength: PHYSICAL_PAGE_BINDING_BYTES
    });
}

/** Return the aligned storage-binding range containing one page/bucket visible offset. */
export function virtualShadowBucketOffsetRange(
    physicalPageIndex: number,
    bucketIndex: number,
    bucketCount: number
): Readonly<{ byteOffset: number; byteLength: number }> {
    return Object.freeze({
        byteOffset: (physicalPageIndex * bucketCount + bucketIndex) * BUCKET_OFFSET_STRIDE_BYTES,
        byteLength: 4
    });
}

/** Return one page/bucket indexed indirect-draw argument offset. */
export function virtualShadowIndirectOffset(
    physicalPageIndex: number,
    bucketIndex: number,
    bucketCount: number
): number {
    return (physicalPageIndex * bucketCount + bucketIndex) * SHADOW_INDIRECT_ARGUMENT_BYTES;
}

/** Return one physical-page non-indexed clear-draw argument offset. */
export function virtualShadowClearIndirectOffset(physicalPageIndex: number): number {
    return physicalPageIndex * DRAW_INDIRECT_ARGUMENT_BYTES;
}

export interface VirtualShadowRecordInputs {
    readonly frameBuffer: RenderGraphBufferHandle;
    readonly objects: RenderGraphBufferHandle;
    readonly bucketData: RenderGraphBufferHandle;
    readonly previousHiZ: RenderGraphTextureHandle | null;
    readonly hiZHistoryValid: boolean;
    readonly shadows: Readonly<RenderPipelineShadowResources>;
    readonly activeObjectHighWater: number;
    readonly previousViewMatrix: ArrayLike<number>;
    readonly cameraHistoryValid: boolean;
}

/** Renderer-local WebGPU virtual-shadow state and graph recorder. */
export class VirtualShadowMapController {
    readonly settings: Readonly<VirtualShadowMapSettings>;
    readonly #clipmaps: DirectionalClipmapState;
    readonly #clipmapData: StorageBuffer;
    readonly #requestBits: StorageBuffer;
    readonly #dirtyBits: StorageBuffer;
    readonly #physicalPages: readonly [StorageBuffer, StorageBuffer];
    readonly #selectedBuckets: StorageBuffer;
    readonly #visibleIndices: StorageBuffer;
    readonly #bucketCursors: StorageBuffer;
    readonly #bucketOffsets: StorageBuffer;
    readonly #shadowArguments: StorageBuffer;
    readonly #clearArguments: StorageBuffer;
    readonly #statistics: StorageBuffer;
    readonly #pageTableKey = {};
    readonly #atlasKey = {};
    readonly #requestPass = requestPass();
    readonly #allocatorPass: ComputeRenderPass;
    readonly #clearPass = new BufferClearPass();
    readonly #clearPool = new RenderPassParameterPool(
        () => new BufferClearParameters(),
        value => {
            value.reset();
        }
    );
    readonly #requestPool = new RenderPassParameterPool(() => new MutableComputeParameters(4, 1));
    readonly #invalidationPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(5, 0)
    );
    readonly #allocatorPool = new RenderPassParameterPool(() => new MutableComputeParameters(8, 1));
    readonly #cullPool = new RenderPassParameterPool(() => new MutableComputeParameters(7, 0));
    readonly #prefixPool = new RenderPassParameterPool(() => new MutableComputeParameters(5, 0));
    readonly #compactPool = new RenderPassParameterPool(() => new MutableComputeParameters(6, 0));
    readonly #bucketCount: number;
    readonly #visibleBucketCapacity: number;
    #physicalPageIndex = 0;
    #pendingFrame = -1;
    #pendingPhysicalPageIndex = 0;
    #stateValid = false;
    #invalidateRequested = false;
    #destroyed = false;

    constructor(
        settings: Readonly<VirtualShadowMapSettings>,
        context: RenderPipelineCreateContext,
        buckets: readonly Readonly<VirtualShadowBucketDescriptor>[],
        maximumObjects: number,
        visibleBucketCapacity: number
    ) {
        this.settings = settings;
        this.#clipmaps = new DirectionalClipmapState(settings);
        this.#allocatorPass = allocatorPass(settings);
        this.#bucketCount = buckets.length;
        this.#visibleBucketCapacity = visibleBucketCapacity;
        const create = (
            descriptor: Parameters<RenderPipelineCreateContext['createStorageBuffer']>[0]
        ): StorageBuffer => context.createStorageBuffer(descriptor);
        const virtualPageCount =
            MAX_DIRECTIONAL_VIRTUAL_LIGHTS *
            settings.directionalClipmapLevels *
            settings.virtualPageGridSize *
            settings.virtualPageGridSize;
        const bitsetByteLength = Math.ceil(virtualPageCount / 32) * 4;
        this.#clipmapData = create({
            label: 'Virtual shadow directional clipmap database',
            byteLength: this.#clipmaps.data.byteLength,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
        this.#requestBits = create({
            label: 'Virtual shadow receiver request bitset',
            byteLength: bitsetByteLength,
            usage: ['storage', 'copy-destination'],
            recovery: 'reinitialize'
        });
        this.#dirtyBits = create({
            label: 'Virtual shadow changed-caster invalidation bitset',
            byteLength: bitsetByteLength,
            usage: ['storage', 'copy-destination'],
            recovery: 'reinitialize'
        });
        const physicalByteLength = settings.physicalPageCount * PHYSICAL_PAGE_STRIDE_BYTES;
        this.#physicalPages = Object.freeze([
            create({
                label: 'Virtual shadow physical residency state A',
                byteLength: physicalByteLength,
                usage: ['storage', 'copy-destination'],
                recovery: 'reinitialize'
            }),
            create({
                label: 'Virtual shadow physical residency state B',
                byteLength: physicalByteLength,
                usage: ['storage', 'copy-destination'],
                recovery: 'reinitialize'
            })
        ]);
        this.#selectedBuckets = create({
            label: 'Virtual shadow per-page selected caster buckets',
            byteLength: settings.physicalPageCount * maximumObjects * 4,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#visibleIndices = create({
            label: 'Virtual shadow per-page visible caster indices',
            byteLength: settings.physicalPageCount * visibleBucketCapacity * 4,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        const pageBucketCount = settings.physicalPageCount * buckets.length;
        this.#bucketCursors = create({
            label: 'Virtual shadow page bucket compact cursors',
            byteLength: pageBucketCount * 4,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#bucketOffsets = create({
            label: 'Virtual shadow aligned page bucket offsets',
            byteLength: pageBucketCount * BUCKET_OFFSET_STRIDE_BYTES,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        const shadowArguments = new Uint32Array(pageBucketCount * 5);
        for (let page = 0; page < settings.physicalPageCount; page += 1) {
            for (let bucket = 0; bucket < buckets.length; bucket += 1) {
                const descriptor = buckets[bucket];
                if (descriptor === undefined) {
                    throw new Error('Virtual shadow bucket plan is incomplete');
                }
                shadowArguments[(page * buckets.length + bucket) * 5] = descriptor.indexCount;
            }
        }
        this.#shadowArguments = create({
            label: 'Virtual shadow page bucket indirect arguments',
            byteLength: shadowArguments.byteLength,
            usage: ['storage', 'indirect'],
            initialData: shadowArguments,
            recovery: 'cpu-shadow'
        });
        this.#clearArguments = create({
            label: 'Virtual shadow physical-page clear indirect arguments',
            byteLength: settings.physicalPageCount * DRAW_INDIRECT_ARGUMENT_BYTES,
            usage: ['storage', 'indirect'],
            recovery: 'reinitialize'
        });
        this.#statistics = create({
            label: 'Virtual shadow request, residency, and update counters',
            byteLength: VIRTUAL_SHADOW_STATS_BYTES,
            usage: ['storage', 'copy-source', 'copy-destination'],
            recovery: 'reinitialize'
        });
    }

    record(
        context: RenderPipelineContext,
        inputs: Readonly<VirtualShadowRecordInputs>
    ): Readonly<VirtualShadowFrameResources> {
        if (this.#destroyed) throw new Error('Virtual shadow controller is destroyed');
        const settings = this.settings;
        const pageTableHistory = context.graph.acquireHistoryTexture(this.#pageTableKey, {
            label: 'Virtual shadow logical-to-physical page table',
            format: 'rgba32float',
            extent: { width: settings.pageTableWidth, height: settings.pageTableHeight },
            usage: ['sampled', 'storage'],
            bufferCount: 2
        });
        const atlasTarget: RenderPipelineTargetResources = context.graph.acquirePersistentTarget(
            this.#atlasKey,
            {
                label: 'Virtual shadow physical depth atlas',
                extent: {
                    width: settings.physicalAtlasWidth,
                    height: settings.physicalAtlasHeight
                },
                colorFormats: [],
                depthStencilFormat: 'depth32float',
                depthStencilSampled: true,
                sampleCount: 1
            }
        );
        if (atlasTarget.depthStencil === null) {
            throw new Error('Virtual shadow physical atlas has no depth attachment');
        }
        const stateValid = this.#stateValid && pageTableHistory.valid && !this.#invalidateRequested;
        const directionalLightCount = this.#clipmaps.stage(
            context.frameIndex,
            context.camera,
            inputs.shadows,
            inputs.cameraHistoryValid,
            inputs.previousViewMatrix,
            stateValid,
            this.#bucketCount,
            this.#visibleBucketCapacity
        );
        context.writeStorageBuffer(this.#clipmapData, 0, new Uint8Array(this.#clipmaps.data));
        const clipmapData = context.graph.importStorageBuffer(this.#clipmapData);
        const requestBits = context.graph.importStorageBuffer(this.#requestBits);
        const dirtyBits = context.graph.importStorageBuffer(this.#dirtyBits);
        const previousPhysicalBuffer =
            this.#physicalPageIndex === 0 ? this.#physicalPages[0] : this.#physicalPages[1];
        const currentPhysicalPageIndex = this.#physicalPageIndex === 0 ? 1 : 0;
        const currentPhysicalBuffer =
            currentPhysicalPageIndex === 0 ? this.#physicalPages[0] : this.#physicalPages[1];
        const previousPhysical = context.graph.importStorageBuffer(previousPhysicalBuffer);
        const currentPhysical = context.graph.importStorageBuffer(currentPhysicalBuffer);
        const selectedBuckets = context.graph.importStorageBuffer(this.#selectedBuckets);
        const visibleIndices = context.graph.importStorageBuffer(this.#visibleIndices);
        const bucketCursors = context.graph.importStorageBuffer(this.#bucketCursors);
        const bucketOffsets = context.graph.importStorageBuffer(this.#bucketOffsets);
        const shadowArguments = context.graph.importStorageBuffer(this.#shadowArguments);
        const clearArguments = context.graph.importStorageBuffer(this.#clearArguments);
        const statistics = context.graph.importStorageBuffer(this.#statistics);

        const clear = context.acquirePassParameters(this.#clearPool);
        clear.add(requestBits, 0, this.#requestBits.byteLength);
        clear.add(dirtyBits, 0, this.#dirtyBits.byteLength);
        clear.add(statistics, 0, this.#statistics.byteLength);
        if (!stateValid) {
            clear.add(previousPhysical, 0, previousPhysicalBuffer.byteLength);
        }
        context.graph.addPass(this.#clearPass, clear);

        if (inputs.hiZHistoryValid && inputs.previousHiZ !== null && directionalLightCount > 0) {
            const request = context.acquirePassParameters(this.#requestPool);
            request.setBuffer(0, inputs.frameBuffer);
            request.setBuffer(1, clipmapData);
            request.setBuffer(2, requestBits);
            request.setBuffer(3, statistics);
            request.setTexture(0, inputs.previousHiZ);
            request.setDispatch(
                Math.max(1, Math.ceil(context.viewport[2] / 2 / REQUEST_WORKGROUP_SIZE)),
                Math.max(1, Math.ceil(context.viewport[3] / 2 / REQUEST_WORKGROUP_SIZE))
            );
            context.graph.addPass(this.#requestPass, request);
        }

        if (directionalLightCount > 0 && inputs.activeObjectHighWater > 0) {
            const invalidation = context.acquirePassParameters(this.#invalidationPool);
            invalidation.setBuffer(0, inputs.frameBuffer);
            invalidation.setBuffer(1, clipmapData);
            invalidation.setBuffer(2, inputs.objects);
            invalidation.setBuffer(3, dirtyBits);
            invalidation.setBuffer(4, statistics);
            invalidation.setDispatch(
                Math.max(1, Math.ceil(inputs.activeObjectHighWater / CULL_WORKGROUP_SIZE))
            );
            context.graph.addPass(INVALIDATION_PASS, invalidation);
        }

        const allocation = context.acquirePassParameters(this.#allocatorPool);
        allocation.setBuffer(0, clipmapData);
        allocation.setBuffer(1, requestBits);
        allocation.setBuffer(2, dirtyBits);
        allocation.setBuffer(3, previousPhysical);
        allocation.setBuffer(4, currentPhysical);
        allocation.setBuffer(5, clearArguments);
        allocation.setBuffer(6, shadowArguments);
        allocation.setBuffer(7, statistics);
        allocation.setTexture(0, pageTableHistory.current);
        allocation.setDispatch(1);
        context.graph.addPass(this.#allocatorPass, allocation);

        const cull = context.acquirePassParameters(this.#cullPool);
        cull.setBuffer(0, inputs.frameBuffer);
        cull.setBuffer(1, clipmapData);
        cull.setBuffer(2, currentPhysical);
        cull.setBuffer(3, inputs.objects);
        cull.setBuffer(4, inputs.bucketData);
        cull.setBuffer(5, selectedBuckets);
        cull.setBuffer(6, shadowArguments);
        cull.setDispatch(
            Math.max(1, Math.ceil(inputs.activeObjectHighWater / CULL_WORKGROUP_SIZE)),
            settings.physicalPageCount
        );
        context.graph.addPass(PAGE_CULL_PASS, cull);

        const prefix = context.acquirePassParameters(this.#prefixPool);
        prefix.setBuffer(0, clipmapData);
        prefix.setBuffer(1, currentPhysical);
        prefix.setBuffer(2, shadowArguments);
        prefix.setBuffer(3, bucketCursors);
        prefix.setBuffer(4, bucketOffsets);
        prefix.setDispatch(settings.physicalPageCount);
        context.graph.addPass(PAGE_BUCKET_PREFIX_PASS, prefix);

        const compact = context.acquirePassParameters(this.#compactPool);
        compact.setBuffer(0, inputs.frameBuffer);
        compact.setBuffer(1, clipmapData);
        compact.setBuffer(2, selectedBuckets);
        compact.setBuffer(3, bucketCursors);
        compact.setBuffer(4, bucketOffsets);
        compact.setBuffer(5, visibleIndices);
        compact.setDispatch(
            Math.max(1, Math.ceil(inputs.activeObjectHighWater / CULL_WORKGROUP_SIZE)),
            settings.physicalPageCount
        );
        context.graph.addPass(PAGE_VISIBLE_COMPACT_PASS, compact);

        this.#pendingFrame = context.frameIndex;
        this.#pendingPhysicalPageIndex = currentPhysicalPageIndex;
        return Object.freeze({
            atlas: atlasTarget.depthStencil,
            pageTable: pageTableHistory.current,
            clipmapData,
            physicalPages: currentPhysical,
            visibleIndices,
            visibleBucketOffsets: bucketOffsets,
            shadowIndirectArguments: shadowArguments,
            clearIndirectArguments: clearArguments,
            clearAtlas: !stateValid,
            directionalLightCount
        });
    }

    frameSubmitted(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#physicalPageIndex = this.#pendingPhysicalPageIndex;
        this.#stateValid = true;
        this.#invalidateRequested = false;
        this.#clipmaps.frameSubmitted(frameIndex);
        this.#pendingFrame = -1;
    }

    frameDiscarded(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#clipmaps.frameDiscarded(frameIndex);
        this.#pendingFrame = -1;
    }

    async readDiagnostics(): Promise<Readonly<VirtualShadowMapDiagnostics>> {
        if (this.#destroyed) throw new Error('Virtual shadow controller is destroyed');
        const result = await this.#statistics.read();
        const values = new Uint32Array(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength / 4
        );
        return Object.freeze({
            requestedPageCount: values[0] ?? 0,
            renderedPageCount: values[1] ?? 0,
            deferredPageCount: values[2] ?? 0,
            residentPageCount: values[3] ?? 0,
            evictionCount: values[4] ?? 0,
            invalidatedPageCount: values[5] ?? 0,
            physicalPageCapacity: this.settings.physicalPageCount,
            directionalClipmapLevelCount: this.settings.directionalClipmapLevels
        });
    }

    /** Invalidate all submitted mappings on the next recorded virtual-shadow frame. */
    invalidateAll(): void {
        if (this.#destroyed) throw new Error('Virtual shadow controller is destroyed');
        this.#invalidateRequested = true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const buffers: readonly StorageBuffer[] = [
            this.#clipmapData,
            this.#requestBits,
            this.#dirtyBits,
            ...this.#physicalPages,
            this.#selectedBuckets,
            this.#visibleIndices,
            this.#bucketCursors,
            this.#bucketOffsets,
            this.#shadowArguments,
            this.#clearArguments,
            this.#statistics
        ];
        const failures: unknown[] = [];
        for (const buffer of buffers) {
            try {
                buffer.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length !== 0) {
            throw new AggregateError(failures, 'Virtual shadow resource destruction failed', {
                cause: failures[0]
            });
        }
    }
}
