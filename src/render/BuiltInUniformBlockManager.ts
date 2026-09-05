import Matrix3 from '../math/Matrix3';
import Matrix4 from '../math/Matrix4';
import type Camera from '../camera/Camera';
import type Mesh from '../core/Mesh';
import type Geometry from '../geometry/Geometry';
import type Material from '../material/MaterialInstance';
import type { SemanticProgramBindingInfo } from '../material/MaterialInstance';
import BasicMaterial from '../material/BasicMaterial';
import UniformBuffer from './UniformBuffer';
import {
    BUILT_IN_UNIFORM_BLOCK_LAYOUTS,
    cameraBlockLayout,
    frameBlockLayout,
    geometryBlockLayout,
    lightBlockLayout,
    materialBlockLayout,
    materialTextureBlockLayout,
    modelBlockLayout,
    morphBlockLayout,
    MAX_SKIN_JOINTS,
    paddedStd140Value,
    sceneBlockLayout,
    skinningBlockLayout
} from './ubo/BuiltInUniformBlocks';
import type { Std140Layout, Std140WriteResult } from './ubo/Std140Layout';
import { getMeshPickingIdentity } from './PickingIdentity';
import type { RendererViewport } from './Renderer';
import type { SemanticFrameState } from './frame/SemanticFrameState';
import type { RHIUploadBatch, RHIUploadBatchParticipant } from './frame/RHIUploadBatch';
import type { RHISubmission } from './rhi/core';
import { getTransformHistoryRevision } from '../core/TransformHistory';

interface RendererSize {
    width: number;
    height: number;
    cameraRelative?: boolean;
    getViewport?(): RendererViewport;
}

/** Minimal block-binding surface implemented by backend pipeline/program adapters. */
export interface UniformBlockConsumer {
    readonly uniformBlocks: Readonly<Record<string, unknown>>;
    setUniformBlock(name: string, buffer: UniformBuffer): void;
}

interface RevisionCachedBuffer {
    buffer: UniformBuffer;
    revision: number;
}

interface MaterialCachedBuffer {
    buffer: UniformBuffer;
    /** Reused std140 candidate so material checks do not allocate a block-sized snapshot per draw. */
    candidate: ArrayBuffer;
    candidateBytes: Uint8Array;
    currentBytes: Uint8Array;
    initialized: boolean;
    /** Pass in which mesh-dependence was last classified from the material's live bindings. */
    classifiedPassEpoch: number;
    /** Pass in which a mesh-independent candidate was already packed. */
    packedPassEpoch: number;
    meshDependent: boolean;
}

interface FrameCachedBuffer {
    buffer: UniformBuffer;
    frameIndex: number;
}

interface ModelFrameCachedBuffer extends FrameCachedBuffer {
    readonly normal: Matrix3;
    revision: number;
}

interface MorphFrameCachedBuffer extends FrameCachedBuffer {
    readonly weights: Float32Array;
    readonly weights0: Float32Array;
    readonly weights1: Float32Array;
}

interface CameraHistoryRecord {
    readonly committedView: Float32Array;
    readonly committedProjection: Float32Array;
    readonly committedViewProjection: Float32Array;
    readonly committedViewInverse: Float32Array;
    readonly committedOrigin: Float32Array;
    readonly pendingView: Float32Array;
    readonly pendingProjection: Float32Array;
    readonly pendingViewProjection: Float32Array;
    readonly pendingViewInverse: Float32Array;
    readonly pendingOrigin: Float32Array;
    committedRevision: number;
    pendingRevision: number;
    committedDepthMode: Camera['depthMode'];
    pendingDepthMode: Camera['depthMode'];
    committedGeneration: number;
    committedSubmission: number;
    pendingFrame: number;
}

interface TransformHistoryRecord {
    readonly committed: Float32Array;
    readonly pending: Float32Array;
    committedRevision: number;
    pendingRevision: number;
    committedGeneration: number;
    pendingFrame: number;
}

interface MotionParticipationRecord {
    committedSubmission: number;
    pendingFrame: number;
}

type OwnedBufferRegistration =
    | { readonly kind: 'material' | 'material-texture'; readonly owner: Material }
    | { readonly kind: 'model'; readonly owner: Mesh }
    | { readonly kind: 'geometry'; readonly owner: Geometry }
    | { readonly kind: 'skinning'; readonly owner: Mesh }
    | { readonly kind: 'morph'; readonly owner: Mesh };

const tempInverseProjection = new Matrix4();
const tempViewNormal = new Matrix3();
const tempRelativeViewInverse = new Matrix4();
const tempRelativeView = new Matrix4();
const tempRelativeViewProjection = new Matrix4();
const tempRelativeNonJitteredViewProjection = new Matrix4();
const std140WriteResult: Std140WriteResult = { byteOffset: 0, byteLength: 0 };
const semanticBlockScratch = new WeakMap<UniformBuffer, Uint8Array>();
const uniformBufferByteViews = new WeakMap<UniformBuffer, Uint8Array>();
const layoutFieldNames = new WeakMap<Std140Layout, readonly string[]>();
const EMPTY_PROGRAM_BINDING_INFO: Readonly<SemanticProgramBindingInfo> = Object.freeze({});
const semanticProgramBindingInfos = new WeakMap<
    SemanticFrameState,
    Readonly<SemanticProgramBindingInfo>
>();
const EMPTY_NUMERIC_VALUES: readonly unknown[] = Object.freeze([]);
const MATERIAL_BLOCK_FIELD_NAMES = Object.freeze(
    Object.keys(materialBlockLayout.fields).filter(fieldName => !fieldName.endsWith('Padding'))
);
const MATERIAL_TEXTURE_BLOCK_FIELD_NAMES = Object.freeze(
    Object.keys(materialTextureBlockLayout.fields).filter(
        fieldName => !fieldName.endsWith('Padding')
    )
);
const MODEL_HISTORY_INVALID = new Float32Array(4);
const MODEL_HISTORY_VALID = new Float32Array([1, 0, 0, 0]);
const MODEL_AND_SKIN_HISTORY_PARAMS = new Float32Array(4);
const MODEL_LAYER_PARAMS = new Uint32Array(4);

function fieldNamesOf(layout: Std140Layout): readonly string[] {
    let names = layoutFieldNames.get(layout);
    if (names === undefined) {
        names = Object.freeze(Object.keys(layout.fields));
        layoutFieldNames.set(layout, names);
    }
    return names;
}

function bytesOf(buffer: UniformBuffer): Uint8Array {
    let bytes = uniformBufferByteViews.get(buffer);
    if (bytes?.buffer !== buffer.data) {
        bytes = new Uint8Array(buffer.data);
        uniformBufferByteViews.set(buffer, bytes);
    }
    return bytes;
}

function programBindingInfoFor(
    semanticFrame: SemanticFrameState | undefined
): Readonly<SemanticProgramBindingInfo> {
    if (semanticFrame === undefined) return EMPTY_PROGRAM_BINDING_INFO;
    let info = semanticProgramBindingInfos.get(semanticFrame);
    if (info === undefined) {
        info = Object.freeze({ semanticFrame });
        semanticProgramBindingInfos.set(semanticFrame, info);
    }
    return info;
}

function numericCameraProperty(camera: Camera, name: string, fallback: number): number {
    const value: unknown = Reflect.get(camera, name);
    return typeof value === 'number' ? value : fallback;
}

function updateSemanticBlock(
    buffer: UniformBuffer,
    blockName: string,
    mesh: Mesh,
    material: Material,
    semanticFrame?: SemanticFrameState
): void {
    const layout = BUILT_IN_UNIFORM_BLOCK_LAYOUTS[blockName];
    if (!layout) return;
    const fieldNames = fieldNamesOf(layout);
    let candidate = semanticBlockScratch.get(buffer);
    if (candidate?.byteLength !== layout.byteLength) {
        candidate = new Uint8Array(layout.byteLength);
        semanticBlockScratch.set(buffer, candidate);
    } else {
        candidate.fill(0);
    }
    const candidateBuffer = candidate.buffer;
    if (!(candidateBuffer instanceof ArrayBuffer)) {
        throw new TypeError('Semantic block scratch storage must use an ArrayBuffer');
    }
    for (const fieldName of fieldNames) {
        if (fieldName.endsWith('Padding')) continue;
        const value = resolveSemanticBlockField(fieldName, mesh, material, semanticFrame);
        const padded = paddedStd140Value(layout, fieldName, value);
        if (padded !== null) {
            layout.writeInto(candidateBuffer, fieldName, padded, std140WriteResult);
        }
    }
    // A pass boundary is not necessarily a data boundary. Preserve the logical source revision
    // when the packed ABI is identical so one shared buffer can be referenced by several graph
    // passes without violating the upload cache's immutable-within-frame contract.
    if (bytesEqual(bytesOf(buffer), candidate, 0, candidate.byteLength)) return;
    buffer.write(0, candidate);
}

function resolveSemanticBlockField(
    fieldName: string,
    mesh: Mesh,
    material: Material,
    semanticFrame?: SemanticFrameState
): unknown {
    if (fieldName === 'u_objectIdColor') return getMeshPickingIdentity(mesh).color;
    if (!Object.hasOwn(material.uniforms, fieldName)) return undefined;
    let materialProperty: 'diffuse' | 'specular' | 'ambient' | 'emission' | null;
    switch (fieldName) {
        case 'u_diffuseColor':
            materialProperty = 'diffuse';
            break;
        case 'u_specularColor':
            materialProperty = 'specular';
            break;
        case 'u_ambientColor':
            materialProperty = 'ambient';
            break;
        case 'u_emissionColor':
            materialProperty = 'emission';
            break;
        default:
            materialProperty = null;
            break;
    }
    if (materialProperty) {
        const candidate: unknown = Reflect.get(material, materialProperty);
        return typeof candidate === 'object' &&
            candidate !== null &&
            Reflect.get(candidate, 'isColor') === true
            ? Reflect.get(candidate, 'elements')
            : undefined;
    }
    if (fieldName === 'u_transparencyFactor') {
        const candidate: unknown = Reflect.get(material, 'opacity');
        return typeof candidate === 'number' ? candidate : 1;
    }
    return material.getUniformData(fieldName, mesh, programBindingInfoFor(semanticFrame));
}

/** Whether packing a material-owned block must resolve fields separately for every mesh. */
function materialOwnedBlockDependsOnMesh(
    material: Material,
    fieldNames: readonly string[]
): boolean {
    let index = 0;
    while (index < fieldNames.length) {
        const fieldName = fieldNames[index];
        index += 1;
        if (fieldName === undefined) continue;
        if (!Object.hasOwn(material.uniforms, fieldName)) continue;
        switch (fieldName) {
            case 'u_diffuseColor':
            case 'u_specularColor':
            case 'u_ambientColor':
            case 'u_emissionColor':
            case 'u_transparencyFactor':
                continue;
            default:
                if (material.getUniformInfo(fieldName).isDependMesh === true) return true;
        }
    }
    return false;
}

/** Pack one material-owned ABI without mutating its live UniformBuffer. */
function packMaterialOwnedBlock(
    blockName: string,
    layout: Std140Layout,
    fieldNames: readonly string[],
    target: ArrayBuffer,
    targetBytes: Uint8Array,
    mesh: Mesh,
    material: Material,
    semanticFrame?: SemanticFrameState
): void {
    targetBytes.fill(0);
    let index = 0;
    while (index < fieldNames.length) {
        const fieldName = fieldNames[index];
        index += 1;
        if (fieldName === undefined) continue;
        const value = resolveSemanticBlockField(fieldName, mesh, material, semanticFrame);
        const padded = paddedStd140Value(layout, fieldName, value);
        if (padded === null) continue;
        if (typeof padded === 'boolean') {
            throw new TypeError(`${blockName} field ${fieldName} must be numeric`);
        }
        layout.writeInto(target, fieldName, padded, std140WriteResult);
    }
}

function bytesEqual(
    current: Uint8Array,
    candidate: Uint8Array,
    byteOffset: number,
    byteLength: number
): boolean {
    const end = byteOffset + byteLength;
    for (let offset = byteOffset; offset < end; offset++) {
        if (current[offset] !== candidate[offset]) return false;
    }
    return true;
}

function copyRelativeMatrix(
    target: Float32Array,
    source: ArrayLike<number>,
    origin: ArrayLike<number>
): void {
    target.set(source);
    target[12] = (source[12] ?? 0) - (origin[0] ?? 0);
    target[13] = (source[13] ?? 0) - (origin[1] ?? 0);
    target[14] = (source[14] ?? 0) - (origin[2] ?? 0);
}

function updateModelTransformBlock(
    buffer: UniformBuffer,
    mesh: Mesh,
    current: Float32Array,
    previous: Float32Array,
    normal: Matrix3,
    historyValid: boolean,
    skinHistoryValid: boolean
): void {
    let candidate = semanticBlockScratch.get(buffer);
    if (candidate?.byteLength !== modelBlockLayout.byteLength) {
        candidate = new Uint8Array(modelBlockLayout.byteLength);
        semanticBlockScratch.set(buffer, candidate);
    } else {
        candidate.fill(0);
    }
    const target = candidate.buffer;
    if (!(target instanceof ArrayBuffer)) {
        throw new TypeError('ModelBlock scratch storage must use an ArrayBuffer');
    }
    modelBlockLayout.writeInto(target, 'u_modelMatrix', current, std140WriteResult);
    modelBlockLayout.writeInto(target, 'u_previousModelMatrix', previous, std140WriteResult);
    modelBlockLayout.writeInto(
        target,
        'u_normalWorldMatrix',
        normal.normalFromMat4(mesh.worldMatrix).elements,
        std140WriteResult
    );
    MODEL_AND_SKIN_HISTORY_PARAMS[0] = historyValid ? 1 : 0;
    MODEL_AND_SKIN_HISTORY_PARAMS[1] = skinHistoryValid ? 1 : 0;
    modelBlockLayout.writeInto(
        target,
        'u_modelHistoryParams',
        MODEL_AND_SKIN_HISTORY_PARAMS,
        std140WriteResult
    );
    modelBlockLayout.writeInto(
        target,
        'u_objectIdColor',
        getMeshPickingIdentity(mesh).color,
        std140WriteResult
    );
    MODEL_LAYER_PARAMS[0] = mesh.layer >>> 0;
    modelBlockLayout.writeInto(target, 'u_modelLayerParams', MODEL_LAYER_PARAMS, std140WriteResult);
    if (!bytesEqual(bytesOf(buffer), candidate, 0, candidate.byteLength)) {
        buffer.write(0, candidate);
    }
}

/**
 * Commit only fields whose packed std140 bytes changed. Comparing the final ABI bytes catches
 * scalar assignments, in-place Color/Matrix edits and texture-derived numeric values without
 * requiring callers to manually toggle a dirty flag. Unchanged blocks keep their revision, so
 * neither backend schedules a redundant GPU upload.
 */
function synchronizeMaterialOwnedBlock(
    cached: MaterialCachedBuffer,
    layout: Std140Layout,
    fieldNames: readonly string[]
): void {
    if (cached.currentBytes.buffer !== cached.buffer.data) {
        cached.currentBytes = new Uint8Array(cached.buffer.data);
        cached.initialized = false;
    }
    const current = cached.currentBytes;
    const candidate = cached.candidateBytes;
    if (!cached.initialized) {
        cached.buffer.write(0, candidate);
        cached.initialized = true;
        return;
    }
    let index = 0;
    while (index < fieldNames.length) {
        const fieldName = fieldNames[index];
        index += 1;
        if (fieldName === undefined) continue;
        const field = layout.fields[fieldName];
        if (field === undefined) continue;
        if (!bytesEqual(current, candidate, field.offset, field.byteLength)) {
            cached.buffer.write(
                field.offset,
                candidate.subarray(field.offset, field.offset + field.byteLength)
            );
        }
    }
}

/** Owns the canonical cross-backend uniform blocks and updates each at its natural frequency. */
class BuiltInUniformBlockManager implements RHIUploadBatchParticipant {
    private readonly renderer: RendererSize;
    private readonly ownedBuffers = new Set<UniformBuffer>();
    private readonly frameUniformBuffer: UniformBuffer;
    private readonly cameraBuffer: UniformBuffer;
    private activeCameraBuffer: UniformBuffer;
    private readonly cameraBuffers = new WeakMap<Camera, UniformBuffer>();
    private defaultCameraBufferAssigned = false;
    private readonly sceneBuffer: UniformBuffer;
    private readonly lightBuffer: UniformBuffer;
    private activeSceneBuffer: UniformBuffer;
    private activeLightBuffer: UniformBuffer;
    private readonly semanticPassBuffers: {
        readonly camera: UniformBuffer;
        readonly scene: UniformBuffer;
        readonly light: UniformBuffer;
    }[] = [];
    private semanticPassCursor = 0;
    private materialPassEpoch = 0;
    private readonly rendererSizeScratch = new Float32Array(2);
    private readonly cameraPositionNearScratch = new Float32Array(4);
    private readonly cameraParamsScratch = new Float32Array(4);
    private readonly renderOriginScratch = new Float32Array(4);
    private readonly historyParamsScratch = new Float32Array(4);
    /** Canonical semantic bindings for pass-global blocks, independent of draw order/material. */
    private readonly globalSemanticMaterial = new BasicMaterial({ lightType: 'NONE' });
    private readonly materialBuffers = new WeakMap<Material, MaterialCachedBuffer>();
    private readonly materialTextureBuffers = new WeakMap<Material, MaterialCachedBuffer>();
    private readonly modelBuffers = new WeakMap<Mesh, ModelFrameCachedBuffer>();
    private readonly geometryBuffers = new WeakMap<Geometry, RevisionCachedBuffer>();
    private readonly skinningBuffers = new WeakMap<Mesh, FrameCachedBuffer>();
    private readonly morphBuffers = new WeakMap<Mesh, MorphFrameCachedBuffer>();
    private readonly cameraHistory = new WeakMap<Camera, CameraHistoryRecord>();
    private readonly modelHistory = new WeakMap<Mesh, TransformHistoryRecord>();
    private readonly skinningHistory = new WeakMap<Mesh, TransformHistoryRecord>();
    private readonly morphHistory = new WeakMap<Mesh, TransformHistoryRecord>();
    private readonly motionParticipation = new WeakMap<Mesh, MotionParticipationRecord>();
    private readonly stagedCameras: CameraHistoryRecord[] = [];
    private readonly stagedModels: TransformHistoryRecord[] = [];
    private readonly stagedSkinning: TransformHistoryRecord[] = [];
    private readonly stagedMorphs: TransformHistoryRecord[] = [];
    private readonly stagedMotionParticipation: MotionParticipationRecord[] = [];
    private readonly bufferOwners = new WeakMap<UniformBuffer, OwnedBufferRegistration>();
    private camera: Camera | null = null;
    private semanticFrame: SemanticFrameState | null = null;
    private frameIndex = 0;
    private readonly startTime = performance.now();
    private sceneRevision = -1;
    private lightRevision = -1;
    private historyGeneration = 1;
    private submissionIndex = 0;

    constructor(renderer: RendererSize) {
        this.renderer = renderer;
        this.frameUniformBuffer = this.createBuffer(frameBlockLayout);
        this.cameraBuffer = this.createBuffer(cameraBlockLayout);
        this.activeCameraBuffer = this.cameraBuffer;
        this.sceneBuffer = this.createBuffer(sceneBlockLayout);
        this.lightBuffer = this.createBuffer(lightBlockLayout);
        this.activeSceneBuffer = this.sceneBuffer;
        this.activeLightBuffer = this.lightBuffer;
        this.semanticPassBuffers.push({
            camera: this.cameraBuffer,
            scene: this.sceneBuffer,
            light: this.lightBuffer
        });
    }

    beginFrame(
        camera: Camera,
        viewport: RendererViewport = this.defaultViewport(),
        uploads?: RHIUploadBatch
    ): void {
        this.semanticFrame = null;
        this.beginApplicationFrame(camera, uploads);
        this.beginPass(camera, viewport);
    }

    /** Begin one shared-renderer frame with explicit semantic ownership. */
    beginSemanticFrame(frame: SemanticFrameState, uploads?: RHIUploadBatch): void {
        this.semanticFrame = frame;
        this.beginApplicationFrame(frame.camera, uploads);
        this.beginSemanticPass(frame);
    }

    /** Advance frame-frequency semantics once, independently of the number of render passes. */
    beginApplicationFrame(camera?: Camera, uploads?: RHIUploadBatch): void {
        this.frameIndex++;
        uploads?.enlist(this);
        this.semanticPassCursor = 0;
        this.renderOriginScratch.fill(0);
        if (this.renderer.cameraRelative === true && camera !== undefined) {
            this.renderOriginScratch[0] = camera.worldMatrix.elements[12];
            this.renderOriginScratch[1] = camera.worldMatrix.elements[13];
            this.renderOriginScratch[2] = camera.worldMatrix.elements[14];
        }
        this.rendererSizeScratch[0] = this.renderer.width;
        this.rendererSizeScratch[1] = this.renderer.height;
        this.frameUniformBuffer
            .set('u_rendererSize', this.rendererSizeScratch)
            .set('u_time', (performance.now() - this.startTime) * 0.001)
            .set('u_frameIndex', this.frameIndex);
    }

    prepareCommit(_submission: RHISubmission): void {
        // History snapshots are CPU-side and require no pre-submission work.
    }

    commit(_submission: RHISubmission): void {
        const committedSubmission = this.submissionIndex + 1;
        for (const record of this.stagedCameras) {
            record.committedView.set(record.pendingView);
            record.committedProjection.set(record.pendingProjection);
            record.committedViewProjection.set(record.pendingViewProjection);
            record.committedViewInverse.set(record.pendingViewInverse);
            record.committedOrigin.set(record.pendingOrigin);
            record.committedRevision = record.pendingRevision;
            record.committedDepthMode = record.pendingDepthMode;
            record.committedGeneration = this.historyGeneration;
            record.committedSubmission = committedSubmission;
            record.pendingFrame = -1;
        }
        this.commitTransformRecords(this.stagedModels);
        this.commitTransformRecords(this.stagedSkinning);
        this.commitTransformRecords(this.stagedMorphs);
        for (const record of this.stagedMotionParticipation) {
            record.committedSubmission = committedSubmission;
            record.pendingFrame = -1;
        }
        this.submissionIndex = committedSubmission;
        this.clearStagedHistory();
    }

    rollback(): void {
        for (const record of this.stagedCameras) record.pendingFrame = -1;
        for (const record of this.stagedModels) record.pendingFrame = -1;
        for (const record of this.stagedSkinning) record.pendingFrame = -1;
        for (const record of this.stagedMorphs) record.pendingFrame = -1;
        for (const record of this.stagedMotionParticipation) record.pendingFrame = -1;
        this.clearStagedHistory();
    }

    /** Invalidate every previous transform at a device-generation boundary. */
    synchronizeAfterRecovery(): void {
        this.historyGeneration += 1;
    }

    /** @internal Record that a visible mesh emitted motion data in this submitted frame. */
    markMotionVectorParticipation(mesh: Mesh): void {
        let record = this.motionParticipation.get(mesh);
        if (record === undefined) {
            record = { committedSubmission: -1, pendingFrame: -1 };
            this.motionParticipation.set(mesh, record);
        }
        if (record.pendingFrame === this.frameIndex) return;
        record.pendingFrame = this.frameIndex;
        this.stagedMotionParticipation.push(record);
    }

    /** @internal Stage and write one current/previous camera-relative instance transform. */
    writeInstanceModelMatrices(
        mesh: Mesh,
        current: Float32Array,
        previous: Float32Array,
        offset: number
    ): boolean {
        const history = this.transformHistoryRecord(this.modelHistory, mesh, 16);
        if (history.pendingFrame !== this.frameIndex) {
            copyRelativeMatrix(
                history.pending,
                mesh.worldMatrix.elements,
                this.renderOriginScratch
            );
            history.pendingRevision = getTransformHistoryRevision(mesh);
            history.pendingFrame = this.frameIndex;
            this.stagedModels.push(history);
        }
        current.set(history.pending, offset);
        const valid =
            history.committedGeneration === this.historyGeneration &&
            history.committedRevision === getTransformHistoryRevision(mesh) &&
            this.hasConsecutiveMotionParticipation(mesh);
        previous.set(valid ? history.committed : history.pending, offset);
        return valid;
    }

    /** Start a camera/render pass without advancing animation-frame scoped buffers. */
    beginPass(camera: Camera, viewport: RendererViewport = this.defaultViewport()): void {
        this.materialPassEpoch += 1;
        this.semanticFrame = null;
        this.activeSceneBuffer = this.sceneBuffer;
        this.activeLightBuffer = this.lightBuffer;
        this.sceneRevision = -1;
        this.lightRevision = -1;
        this.updateCamera(camera, viewport);
    }

    /** Change camera/pass context without advancing frame-frequency data. */
    beginSemanticPass(frame: SemanticFrameState): void {
        this.materialPassEpoch += 1;
        this.semanticFrame = frame;
        let buffers = this.semanticPassBuffers[this.semanticPassCursor++];
        if (buffers === undefined) {
            buffers = {
                camera: this.createBuffer(cameraBlockLayout),
                scene: this.createBuffer(sceneBlockLayout),
                light: this.createBuffer(lightBlockLayout)
            };
            this.semanticPassBuffers.push(buffers);
        }
        this.activeCameraBuffer = buffers.camera;
        this.activeSceneBuffer = buffers.scene;
        this.activeLightBuffer = buffers.light;
        this.sceneRevision = -1;
        this.lightRevision = -1;
        this.updateCamera(frame.camera, frame.viewport, true);
    }

    private defaultViewport(): RendererViewport {
        return this.renderer.getViewport?.() ?? [0, 0, this.renderer.width, this.renderer.height];
    }

    /** Update only pass viewport state when WebGL changes it between draws. */
    setViewport(viewport: RendererViewport): void {
        const [x, y, width, height] = viewport;
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width <= 0 ||
            height <= 0
        ) {
            throw new RangeError(
                'Renderer viewport must contain finite x/y and positive width/height'
            );
        }
        this.activeCameraBuffer.set('u_viewport', viewport);
    }

    private updateCamera(
        camera: Camera,
        viewport: RendererViewport,
        useActiveBuffer = false
    ): void {
        this.camera = camera;
        let cameraBuffer = this.activeCameraBuffer;
        if (!useActiveBuffer) {
            const cached = this.cameraBuffers.get(camera);
            if (cached === undefined) {
                if (!this.defaultCameraBufferAssigned) {
                    cameraBuffer = this.cameraBuffer;
                    this.defaultCameraBufferAssigned = true;
                } else {
                    cameraBuffer = this.createBuffer(cameraBlockLayout);
                }
                this.cameraBuffers.set(camera, cameraBuffer);
            } else {
                cameraBuffer = cached;
            }
        }
        this.activeCameraBuffer = cameraBuffer;
        const history = this.cameraHistoryRecord(camera);
        const firstCameraStage = history.pendingFrame !== this.frameIndex;
        copyRelativeMatrix(
            history.pendingViewInverse,
            camera.worldMatrix.elements,
            this.renderOriginScratch
        );
        tempRelativeViewInverse.fromArray(history.pendingViewInverse);
        tempRelativeView.invert(tempRelativeViewInverse);
        history.pendingView.set(tempRelativeView.elements);
        history.pendingProjection.set(camera.jitteredProjectionMatrix.elements);
        tempRelativeViewProjection.multiply(camera.jitteredProjectionMatrix, tempRelativeView);
        history.pendingViewProjection.set(tempRelativeViewProjection.elements);
        history.pendingOrigin.set(this.renderOriginScratch);
        history.pendingRevision = getTransformHistoryRevision(camera);
        history.pendingDepthMode = camera.depthMode;
        if (firstCameraStage) {
            history.pendingFrame = this.frameIndex;
            this.stagedCameras.push(history);
        }
        const historyValid =
            history.committedGeneration === this.historyGeneration &&
            history.committedRevision === getTransformHistoryRevision(camera) &&
            history.committedDepthMode === camera.depthMode &&
            history.committedSubmission === this.submissionIndex;
        const previousView = historyValid ? history.committedView : history.pendingView;
        const previousProjection = historyValid
            ? history.committedProjection
            : history.pendingProjection;
        const previousViewProjection = historyValid
            ? history.committedViewProjection
            : history.pendingViewProjection;
        const previousViewInverse = historyValid
            ? history.committedViewInverse
            : history.pendingViewInverse;
        const previousOrigin = historyValid ? history.committedOrigin : history.pendingOrigin;
        this.cameraPositionNearScratch[0] = history.pendingViewInverse[12] ?? 0;
        this.cameraPositionNearScratch[1] = history.pendingViewInverse[13] ?? 0;
        this.cameraPositionNearScratch[2] = history.pendingViewInverse[14] ?? 0;
        this.cameraPositionNearScratch[3] = numericCameraProperty(camera, 'near', 0);
        this.cameraParamsScratch[0] = numericCameraProperty(camera, 'far', 0);
        this.cameraParamsScratch[1] = camera.isPerspectiveCamera ? 1 : 0;
        this.cameraParamsScratch[2] = camera.isPerspectiveCamera
            ? 2 / Math.log2(numericCameraProperty(camera, 'far', 1) + 1)
            : 0;
        this.cameraParamsScratch[3] = camera.depthMode === 'reversed' ? 1 : 0;
        this.historyParamsScratch.fill(0);
        this.historyParamsScratch[0] = historyValid ? 1 : 0;
        cameraBuffer
            .set('u_viewMatrix', history.pendingView)
            .set('u_projectionMatrix', history.pendingProjection)
            .set('u_viewProjectionMatrix', history.pendingViewProjection)
            .set('u_nonJitteredProjectionMatrix', camera.projectionMatrix.elements)
            .set(
                'u_nonJitteredViewProjectionMatrix',
                tempRelativeNonJitteredViewProjection.multiply(
                    camera.projectionMatrix,
                    tempRelativeView
                ).elements
            )
            .set('u_previousViewMatrix', previousView)
            .set('u_previousProjectionMatrix', previousProjection)
            .set('u_previousViewProjectionMatrix', previousViewProjection)
            .set('u_viewInverseMatrix', history.pendingViewInverse)
            .set('u_previousViewInverseMatrix', previousViewInverse)
            .set(
                'u_projectionInverseMatrix',
                tempInverseProjection.invert(camera.jitteredProjectionMatrix).elements
            )
            .set(
                'u_viewInverseNormalMatrix',
                tempViewNormal.normalFromMat4(camera.worldMatrix).elements
            )
            .set('u_cameraPositionNear', this.cameraPositionNearScratch)
            .set('u_cameraParams', this.cameraParamsScratch)
            .set('u_renderOrigin', history.pendingOrigin)
            .set('u_previousRenderOrigin', previousOrigin)
            .set('u_historyParams', this.historyParamsScratch);
        this.setViewport(viewport);
    }

    bind(
        program: UniformBlockConsumer,
        mesh: Mesh,
        material: Material,
        _forceMaterialUpdate: boolean,
        activeCamera?: Camera | null
    ): Readonly<Record<string, UniformBuffer>> {
        const buffers = this.getUniformBlocks(
            Object.keys(program.uniformBlocks),
            mesh,
            material,
            activeCamera
        );
        for (const [blockName, buffer] of Object.entries(buffers)) {
            program.setUniformBlock(blockName, buffer);
        }
        return buffers;
    }

    /** Resolve logical parameter blocks without coupling the caller to a graphics API. */
    getUniformBlocks(
        blockNames: readonly string[],
        mesh: Mesh,
        material: Material,
        activeCamera?: Camera | null,
        semanticFrame: SemanticFrameState | null = this.semanticFrame
    ): Readonly<Record<string, UniformBuffer>> {
        const result: Record<string, UniformBuffer> = {};
        for (const blockName of blockNames) {
            result[blockName] = this.resolveUniformBlock(
                blockName,
                mesh,
                material,
                activeCamera,
                semanticFrame
            );
        }
        return result;
    }

    /** Resolve one block without allocating an aggregate Record for sampler-free draw loops. */
    resolveUniformBlock(
        blockName: string,
        mesh: Mesh,
        material: Material,
        activeCamera?: Camera | null,
        semanticFrame: SemanticFrameState | null = this.semanticFrame
    ): UniformBuffer {
        if (activeCamera && activeCamera !== this.camera) {
            throw new Error(
                'Camera changed without beginPass; start every camera/render pass explicitly'
            );
        }
        if (!this.camera) throw new Error('Uniform blocks cannot be resolved before beginFrame');
        const buffer =
            material.uniformBlocks[blockName] ??
            this.resolveBuiltInBuffer(blockName, mesh, material, semanticFrame ?? undefined);
        if (!buffer) {
            throw new Error(`No UniformBuffer is configured for active block ${blockName}`);
        }
        return buffer;
    }

    /**
     * Release every object-frequency block cached for an owner. Returns the number of logical
     * buffers removed; global frame/camera/scene/light blocks are intentionally retained.
     */
    releaseOwner(owner: object): number {
        return this.releaseOwnerBuffers(owner).length;
    }

    /**
     * Release and return the exact CPU blocks formerly owned by an engine object. Shared renderer
     * resource caches use these identities to release the matching recoverable GPU buffers.
     */
    releaseOwnerBuffers(owner: object): readonly UniformBuffer[] {
        const buffers = new Set<UniformBuffer>();
        const material = this.materialBuffers.get(owner as Material);
        const materialTexture = this.materialTextureBuffers.get(owner as Material);
        const model = this.modelBuffers.get(owner as Mesh);
        const geometry = this.geometryBuffers.get(owner as Geometry);
        const skinning = this.skinningBuffers.get(owner as Mesh);
        const morph = this.morphBuffers.get(owner as Mesh);
        if (material) buffers.add(material.buffer);
        if (materialTexture) buffers.add(materialTexture.buffer);
        if (model) buffers.add(model.buffer);
        if (geometry) buffers.add(geometry.buffer);
        if (skinning) buffers.add(skinning.buffer);
        if (morph) buffers.add(morph.buffer);
        const released: UniformBuffer[] = [];
        for (const buffer of buffers) {
            if (this.releaseBuffer(buffer)) released.push(buffer);
        }
        return Object.freeze(released);
    }

    /** Release an object-frequency buffer by identity when a renderer resource loses its last ref. */
    releaseBuffer(buffer: UniformBuffer): boolean {
        const registration = this.bufferOwners.get(buffer);
        if (!registration) return false;
        switch (registration.kind) {
            case 'material':
                if (this.materialBuffers.get(registration.owner)?.buffer === buffer) {
                    this.materialBuffers.delete(registration.owner);
                }
                break;
            case 'material-texture':
                if (this.materialTextureBuffers.get(registration.owner)?.buffer === buffer) {
                    this.materialTextureBuffers.delete(registration.owner);
                }
                break;
            case 'model':
                if (this.modelBuffers.get(registration.owner)?.buffer === buffer) {
                    this.modelBuffers.delete(registration.owner);
                }
                break;
            case 'geometry':
                if (this.geometryBuffers.get(registration.owner)?.buffer === buffer) {
                    this.geometryBuffers.delete(registration.owner);
                }
                break;
            case 'skinning':
                if (this.skinningBuffers.get(registration.owner)?.buffer === buffer) {
                    this.skinningBuffers.delete(registration.owner);
                }
                break;
            case 'morph':
                if (this.morphBuffers.get(registration.owner)?.buffer === buffer) {
                    this.morphBuffers.delete(registration.owner);
                }
                break;
        }
        this.bufferOwners.delete(buffer);
        this.ownedBuffers.delete(buffer);
        return true;
    }

    private getMaterialBuffer(
        mesh: Mesh,
        material: Material,
        semanticFrame?: SemanticFrameState
    ): UniformBuffer {
        return this.getMaterialOwnedBuffer(
            'MaterialBlock',
            materialBlockLayout,
            MATERIAL_BLOCK_FIELD_NAMES,
            this.materialBuffers,
            'material',
            mesh,
            material,
            semanticFrame
        );
    }

    private getMaterialTextureBuffer(
        mesh: Mesh,
        material: Material,
        semanticFrame?: SemanticFrameState
    ): UniformBuffer {
        return this.getMaterialOwnedBuffer(
            'MaterialTextureBlock',
            materialTextureBlockLayout,
            MATERIAL_TEXTURE_BLOCK_FIELD_NAMES,
            this.materialTextureBuffers,
            'material-texture',
            mesh,
            material,
            semanticFrame
        );
    }

    private getMaterialOwnedBuffer(
        blockName: 'MaterialBlock' | 'MaterialTextureBlock',
        layout: Std140Layout,
        fieldNames: readonly string[],
        buffers: WeakMap<Material, MaterialCachedBuffer>,
        registrationKind: 'material' | 'material-texture',
        mesh: Mesh,
        material: Material,
        semanticFrame?: SemanticFrameState
    ): UniformBuffer {
        let cached = buffers.get(material);
        if (!cached) {
            const buffer = this.createOwnedBuffer(layout, {
                kind: registrationKind,
                owner: material
            });
            const candidate = new ArrayBuffer(layout.byteLength);
            cached = {
                buffer,
                candidate,
                candidateBytes: new Uint8Array(candidate),
                currentBytes: new Uint8Array(buffer.data),
                initialized: false,
                classifiedPassEpoch: -1,
                packedPassEpoch: -1,
                meshDependent: true
            };
            buffers.set(material, cached);
        }
        if (cached.classifiedPassEpoch !== this.materialPassEpoch) {
            cached.meshDependent = materialOwnedBlockDependsOnMesh(material, fieldNames);
            cached.classifiedPassEpoch = this.materialPassEpoch;
        }
        if (!cached.meshDependent && cached.packedPassEpoch === this.materialPassEpoch) {
            return cached.buffer;
        }
        packMaterialOwnedBlock(
            blockName,
            layout,
            fieldNames,
            cached.candidate,
            cached.candidateBytes,
            mesh,
            material,
            semanticFrame
        );
        synchronizeMaterialOwnedBlock(cached, layout, fieldNames);
        cached.packedPassEpoch = this.materialPassEpoch;
        return cached.buffer;
    }

    private getModelBuffer(
        mesh: Mesh,
        _material: Material,
        _semanticFrame?: SemanticFrameState
    ): UniformBuffer {
        let cached = this.modelBuffers.get(mesh);
        if (!cached) {
            cached = {
                buffer: this.createOwnedBuffer(modelBlockLayout, {
                    kind: 'model',
                    owner: mesh
                }),
                frameIndex: -1,
                normal: new Matrix3(),
                revision: -1
            };
            this.modelBuffers.set(mesh, cached);
        }
        if (cached.frameIndex !== this.frameIndex || cached.revision !== mesh.worldMatrixVersion) {
            const history = this.transformHistoryRecord(this.modelHistory, mesh, 16);
            const firstModelStage = history.pendingFrame !== this.frameIndex;
            copyRelativeMatrix(
                history.pending,
                mesh.worldMatrix.elements,
                this.renderOriginScratch
            );
            history.pendingRevision = getTransformHistoryRevision(mesh);
            if (firstModelStage) {
                history.pendingFrame = this.frameIndex;
                this.stagedModels.push(history);
            }
            const historyValid =
                history.committedGeneration === this.historyGeneration &&
                history.committedRevision === getTransformHistoryRevision(mesh) &&
                this.hasConsecutiveMotionParticipation(mesh);
            updateModelTransformBlock(
                cached.buffer,
                mesh,
                history.pending,
                historyValid ? history.committed : history.pending,
                cached.normal,
                historyValid,
                this.hasValidSkinHistory(mesh)
            );
            cached.frameIndex = this.frameIndex;
            cached.revision = mesh.worldMatrixVersion;
        }
        return cached.buffer;
    }

    private getGeometryBuffer(
        mesh: Mesh,
        material: Material,
        semanticFrame?: SemanticFrameState
    ): UniformBuffer {
        const geometry = mesh.geometry;
        if (!geometry) throw new Error(`Mesh ${mesh.id} has no Geometry for GeometryBlock`);
        let cached = this.geometryBuffers.get(geometry);
        if (!cached) {
            cached = {
                buffer: this.createOwnedBuffer(geometryBlockLayout, {
                    kind: 'geometry',
                    owner: geometry
                }),
                revision: -1
            };
            this.geometryBuffers.set(geometry, cached);
        }
        if (cached.revision !== geometry.revision) {
            updateSemanticBlock(cached.buffer, 'GeometryBlock', mesh, material, semanticFrame);
            cached.revision = geometry.revision;
        }
        return cached.buffer;
    }

    private getSkinningBuffer(
        mesh: Mesh,
        material: Material,
        semanticFrame?: SemanticFrameState
    ): UniformBuffer {
        let cached = this.skinningBuffers.get(mesh);
        if (!cached) {
            cached = {
                buffer: this.createOwnedBuffer(skinningBlockLayout, {
                    kind: 'skinning',
                    owner: mesh
                }),
                frameIndex: -1
            };
            this.skinningBuffers.set(mesh, cached);
        }
        if (cached.frameIndex !== this.frameIndex) {
            const value = material.getUniformData(
                'u_jointMat',
                mesh,
                programBindingInfoFor(semanticFrame)
            );
            const values =
                Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView))
                    ? (value as ArrayLike<unknown>)
                    : EMPTY_NUMERIC_VALUES;
            const capacity = MAX_SKIN_JOINTS * 16;
            if (values.length > capacity) {
                throw new RangeError(
                    `SkinningBlock supports at most ${String(MAX_SKIN_JOINTS)} joints`
                );
            }
            const history = this.transformHistoryRecord(this.skinningHistory, mesh, capacity);
            history.pending.fill(0);
            for (let index = 0; index < values.length; index += 1) {
                const component = values[index];
                if (typeof component !== 'number' || !Number.isFinite(component)) {
                    throw new TypeError(`Joint matrix component ${String(index)} must be finite`);
                }
                history.pending[index] = component;
            }
            history.pendingRevision = getTransformHistoryRevision(mesh);
            history.pendingFrame = this.frameIndex;
            this.stagedSkinning.push(history);
            const historyValid = this.hasValidSkinHistory(mesh);
            cached.buffer
                .set('u_jointMat', history.pending)
                .set('u_previousJointMat', historyValid ? history.committed : history.pending);
            cached.frameIndex = this.frameIndex;
        }
        return cached.buffer;
    }

    /** Read committed skin history independently of this frame's block resolution order. */
    private hasValidSkinHistory(mesh: Mesh): boolean {
        const history = this.skinningHistory.get(mesh);
        return (
            history?.committedGeneration === this.historyGeneration &&
            history.committedRevision === getTransformHistoryRevision(mesh) &&
            this.hasConsecutiveMotionParticipation(mesh)
        );
    }

    private getMorphBuffer(
        mesh: Mesh,
        material: Material,
        semanticFrame?: SemanticFrameState
    ): UniformBuffer {
        let cached = this.morphBuffers.get(mesh);
        if (!cached) {
            const weights = new Float32Array(8);
            cached = {
                buffer: this.createOwnedBuffer(morphBlockLayout, {
                    kind: 'morph',
                    owner: mesh
                }),
                frameIndex: -1,
                weights,
                weights0: weights.subarray(0, 4),
                weights1: weights.subarray(4, 8)
            };
            this.morphBuffers.set(mesh, cached);
        }
        if (cached.frameIndex === this.frameIndex) return cached.buffer;
        const weights = material.getUniformData(
            'u_morphWeights',
            mesh,
            programBindingInfoFor(semanticFrame)
        );
        const values: ArrayLike<unknown> =
            Array.isArray(weights) ||
            (ArrayBuffer.isView(weights) && !(weights instanceof DataView))
                ? (weights as ArrayLike<unknown>)
                : EMPTY_NUMERIC_VALUES;
        if (values.length > cached.weights.length) {
            throw new RangeError('MorphBlock supports at most 8 morph weights');
        }
        cached.weights.fill(0);
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index];
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                throw new TypeError(`Morph weight ${String(index)} must be finite`);
            }
            cached.weights[index] = value;
        }
        const history = this.transformHistoryRecord(this.morphHistory, mesh, cached.weights.length);
        history.pending.set(cached.weights);
        history.pendingRevision = getTransformHistoryRevision(mesh);
        history.pendingFrame = this.frameIndex;
        this.stagedMorphs.push(history);
        const historyValid =
            history.committedGeneration === this.historyGeneration &&
            history.committedRevision === history.pendingRevision &&
            this.hasConsecutiveMotionParticipation(mesh);
        const previous = historyValid ? history.committed : history.pending;
        cached.buffer
            .set('u_morphWeights0', cached.weights0)
            .set('u_morphWeights1', cached.weights1)
            .set('u_previousMorphWeights0', previous.subarray(0, 4))
            .set('u_previousMorphWeights1', previous.subarray(4, 8))
            .set(
                'u_morphHistoryParams',
                historyValid ? MODEL_HISTORY_VALID : MODEL_HISTORY_INVALID
            );
        cached.frameIndex = this.frameIndex;
        return cached.buffer;
    }

    private resolveBuiltInBuffer(
        blockName: string,
        mesh: Mesh,
        material: Material,
        semanticFrame?: SemanticFrameState
    ): UniformBuffer | undefined {
        switch (blockName) {
            case 'FrameBlock':
                return this.frameUniformBuffer;
            case 'CameraBlock':
                return this.activeCameraBuffer;
            case 'SceneBlock':
                if (this.sceneRevision !== this.frameIndex) {
                    updateSemanticBlock(
                        this.activeSceneBuffer,
                        blockName,
                        mesh,
                        this.globalSemanticMaterial,
                        semanticFrame
                    );
                    this.sceneRevision = this.frameIndex;
                }
                return this.activeSceneBuffer;
            case 'LightBlock':
                if (this.lightRevision !== this.frameIndex) {
                    updateSemanticBlock(
                        this.activeLightBuffer,
                        blockName,
                        mesh,
                        this.globalSemanticMaterial,
                        semanticFrame
                    );
                    this.lightRevision = this.frameIndex;
                }
                return this.activeLightBuffer;
            case 'MaterialBlock':
                return this.getMaterialBuffer(mesh, material, semanticFrame);
            case 'MaterialTextureBlock':
                return this.getMaterialTextureBuffer(mesh, material, semanticFrame);
            case 'ModelBlock':
                return this.getModelBuffer(mesh, material, semanticFrame);
            case 'GeometryBlock':
                return this.getGeometryBuffer(mesh, material, semanticFrame);
            case 'SkinningBlock':
                return this.getSkinningBuffer(mesh, material, semanticFrame);
            case 'MorphBlock':
                return this.getMorphBuffer(mesh, material, semanticFrame);
            default:
                return undefined;
        }
    }

    private cameraHistoryRecord(camera: Camera): CameraHistoryRecord {
        let record = this.cameraHistory.get(camera);
        if (record !== undefined) return record;
        const matrix = (): Float32Array => new Float32Array(16);
        const origin = (): Float32Array => new Float32Array(4);
        record = {
            committedView: matrix(),
            committedProjection: matrix(),
            committedViewProjection: matrix(),
            committedViewInverse: matrix(),
            committedOrigin: origin(),
            pendingView: matrix(),
            pendingProjection: matrix(),
            pendingViewProjection: matrix(),
            pendingViewInverse: matrix(),
            pendingOrigin: origin(),
            committedRevision: -1,
            pendingRevision: -1,
            committedDepthMode: 'standard',
            pendingDepthMode: 'standard',
            committedGeneration: 0,
            committedSubmission: -1,
            pendingFrame: -1
        };
        this.cameraHistory.set(camera, record);
        return record;
    }

    private transformHistoryRecord(
        records: WeakMap<Mesh, TransformHistoryRecord>,
        mesh: Mesh,
        length: number
    ): TransformHistoryRecord {
        let record = records.get(mesh);
        if (record !== undefined) return record;
        record = {
            committed: new Float32Array(length),
            pending: new Float32Array(length),
            committedRevision: -1,
            pendingRevision: -1,
            committedGeneration: 0,
            pendingFrame: -1
        };
        records.set(mesh, record);
        return record;
    }

    private commitTransformRecords(records: readonly TransformHistoryRecord[]): void {
        for (const record of records) {
            record.committed.set(record.pending);
            record.committedRevision = record.pendingRevision;
            record.committedGeneration = this.historyGeneration;
            record.pendingFrame = -1;
        }
    }

    private hasConsecutiveMotionParticipation(mesh: Mesh): boolean {
        return this.motionParticipation.get(mesh)?.committedSubmission === this.submissionIndex;
    }

    private clearStagedHistory(): void {
        this.stagedCameras.length = 0;
        this.stagedModels.length = 0;
        this.stagedSkinning.length = 0;
        this.stagedMorphs.length = 0;
        this.stagedMotionParticipation.length = 0;
    }

    private createBuffer(layout: Std140Layout): UniformBuffer {
        const buffer = UniformBuffer.fromSchema(layout);
        this.ownedBuffers.add(buffer);
        return buffer;
    }

    private createOwnedBuffer(
        layout: Std140Layout,
        registration: OwnedBufferRegistration
    ): UniformBuffer {
        const buffer = this.createBuffer(layout);
        this.bufferOwners.set(buffer, registration);
        return buffer;
    }
}

export default BuiltInUniformBlockManager;
