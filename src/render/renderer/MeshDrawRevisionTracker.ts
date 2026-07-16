import type Mesh from '../../core/Mesh';
import type Geometry from '../../geometry/Geometry';
import type GeometryData from '../../geometry/GeometryData';
import type Material from '../../material/Material';
import type { RHITextureFormat } from '../rhi/core';
import type { PreparedDrawRevision } from './PreparedDraw';
import type { RHIMeshDrawTargetDescriptor } from './RHIDescriptorMapping';

interface MeshRevisionRecord {
    geometry: Geometry;
    geometryRevision: number;
    mode: number;
    vertices: GeometryData;
    vertexRevision: number;
    vertexData: ArrayBufferView;
    vertexSize: number;
    vertexType: number;
    vertexNormalized: boolean;
    vertexStride: number;
    vertexOffset: number;
    vertexLayoutIdentity: object;
    indices: GeometryData | null;
    indexRevision: number;
    indexData: ArrayBufferView | null;
    indexSize: number;
    indexType: number;
    indexNormalized: boolean;
    indexStride: number;
    indexOffset: number;

    material: Material;
    materialRevision: number;
    shaderToken: number;

    wireframe: boolean;
    frontFace: number;
    cullFace: boolean;
    cullFaceType: number;
    depthTest: boolean;
    depthMask: boolean;
    depthRangeMin: number;
    depthRangeMax: number;
    depthFunc: number;
    transparent: boolean;
    premultiplyAlpha: boolean;
    blend: boolean;
    blendEquation: number;
    blendEquationAlpha: number;
    blendSrc: number;
    blendDst: number;
    blendSrcAlpha: number;
    blendDstAlpha: number;
    stencilTest: boolean;
    stencilMask: number;
    stencilFunc: number;
    stencilFuncRef: number;
    stencilFuncMask: number;
    stencilOpFail: number;
    stencilOpZFail: number;
    stencilOpZPass: number;
    sampleAlphaToCoverage: boolean;

    resourceBindings: number;
    colorFormats: readonly (RHITextureFormat | null)[];
    depthStencilFormat: RHITextureFormat | null;
    sampleCount: number;
    deviceGeneration: number;
    revision: PreparedDrawRevision;
}

export interface MeshDrawRevisionInputs {
    readonly mesh: Mesh;
    /** Distinct draw owner for multi-pass variants of the same mesh. Defaults to `mesh`. */
    readonly owner?: object;
    /** Material used by this prepared variant. Defaults to `mesh.material`. */
    readonly material?: Material;
    /** Monotonic identity of the exact backend shader artifact pair. */
    readonly shaderToken: number;
    /** Binding-cache identity. Buffer content updates do not change bind-group identity. */
    readonly resourceBindings: number;
    /** Exact multi-stream layout plan identity. Defaults to the legacy position source. */
    readonly vertexLayoutIdentity?: object;
    readonly target: RHIMeshDrawTargetDescriptor;
    readonly deviceGeneration: number;
}

function requireToken(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

function geometryChanged(
    record: MeshRevisionRecord,
    geometry: Geometry,
    vertices: GeometryData,
    indices: GeometryData | null,
    vertexLayoutIdentity: object
): boolean {
    return (
        record.geometry !== geometry ||
        record.geometryRevision !== geometry.revision ||
        record.mode !== geometry.mode ||
        record.vertices !== vertices ||
        record.vertexRevision !== vertices.revision ||
        record.vertexData !== vertices.data ||
        record.vertexSize !== vertices.size ||
        record.vertexType !== vertices.type ||
        record.vertexNormalized !== vertices.normalized ||
        record.vertexStride !== vertices.stride ||
        record.vertexOffset !== vertices.offset ||
        record.vertexLayoutIdentity !== vertexLayoutIdentity ||
        record.indices !== indices ||
        record.indexRevision !== (indices?.revision ?? -1) ||
        record.indexData !== (indices?.data ?? null) ||
        record.indexSize !== (indices?.size ?? 0) ||
        record.indexType !== (indices?.type ?? 0) ||
        record.indexNormalized !== (indices?.normalized ?? false) ||
        record.indexStride !== (indices?.stride ?? 0) ||
        record.indexOffset !== (indices?.offset ?? 0)
    );
}

function storeGeometry(
    record: MeshRevisionRecord,
    geometry: Geometry,
    vertices: GeometryData,
    indices: GeometryData | null,
    vertexLayoutIdentity: object
): void {
    record.geometry = geometry;
    record.geometryRevision = geometry.revision;
    record.mode = geometry.mode;
    record.vertices = vertices;
    record.vertexRevision = vertices.revision;
    record.vertexData = vertices.data;
    record.vertexSize = vertices.size;
    record.vertexType = vertices.type;
    record.vertexNormalized = vertices.normalized;
    record.vertexStride = vertices.stride;
    record.vertexOffset = vertices.offset;
    record.vertexLayoutIdentity = vertexLayoutIdentity;
    record.indices = indices;
    record.indexRevision = indices?.revision ?? -1;
    record.indexData = indices?.data ?? null;
    record.indexSize = indices?.size ?? 0;
    record.indexType = indices?.type ?? 0;
    record.indexNormalized = indices?.normalized ?? false;
    record.indexStride = indices?.stride ?? 0;
    record.indexOffset = indices?.offset ?? 0;
}

function renderStateChanged(record: MeshRevisionRecord, material: Material): boolean {
    return (
        record.material !== material ||
        record.wireframe !== material.wireframe ||
        record.frontFace !== material.frontFace ||
        record.cullFace !== material.cullFace ||
        record.cullFaceType !== material.cullFaceType ||
        record.depthTest !== material.depthTest ||
        record.depthMask !== material.depthMask ||
        record.depthRangeMin !== material.depthRange[0] ||
        record.depthRangeMax !== material.depthRange[1] ||
        record.depthFunc !== material.depthFunc ||
        record.transparent !== material.transparent ||
        record.premultiplyAlpha !== material.premultiplyAlpha ||
        record.blend !== material.blend ||
        record.blendEquation !== material.blendEquation ||
        record.blendEquationAlpha !== material.blendEquationAlpha ||
        record.blendSrc !== material.blendSrc ||
        record.blendDst !== material.blendDst ||
        record.blendSrcAlpha !== material.blendSrcAlpha ||
        record.blendDstAlpha !== material.blendDstAlpha ||
        record.stencilTest !== material.stencilTest ||
        record.stencilMask !== material.stencilMask ||
        record.stencilFunc !== material.stencilFunc ||
        record.stencilFuncRef !== material.stencilFuncRef ||
        record.stencilFuncMask !== material.stencilFuncMask ||
        record.stencilOpFail !== material.stencilOpFail ||
        record.stencilOpZFail !== material.stencilOpZFail ||
        record.stencilOpZPass !== material.stencilOpZPass ||
        record.sampleAlphaToCoverage !== material.sampleAlphaToCoverage
    );
}

function storeRenderState(record: MeshRevisionRecord, material: Material): void {
    record.wireframe = material.wireframe;
    record.frontFace = material.frontFace;
    record.cullFace = material.cullFace;
    record.cullFaceType = material.cullFaceType;
    record.depthTest = material.depthTest;
    record.depthMask = material.depthMask;
    record.depthRangeMin = material.depthRange[0];
    record.depthRangeMax = material.depthRange[1];
    record.depthFunc = material.depthFunc;
    record.transparent = material.transparent;
    record.premultiplyAlpha = material.premultiplyAlpha;
    record.blend = material.blend;
    record.blendEquation = material.blendEquation;
    record.blendEquationAlpha = material.blendEquationAlpha;
    record.blendSrc = material.blendSrc;
    record.blendDst = material.blendDst;
    record.blendSrcAlpha = material.blendSrcAlpha;
    record.blendDstAlpha = material.blendDstAlpha;
    record.stencilTest = material.stencilTest;
    record.stencilMask = material.stencilMask;
    record.stencilFunc = material.stencilFunc;
    record.stencilFuncRef = material.stencilFuncRef;
    record.stencilFuncMask = material.stencilFuncMask;
    record.stencilOpFail = material.stencilOpFail;
    record.stencilOpZFail = material.stencilOpZFail;
    record.stencilOpZPass = material.stencilOpZPass;
    record.sampleAlphaToCoverage = material.sampleAlphaToCoverage;
}

function targetColorFormatsChanged(
    record: MeshRevisionRecord,
    colorFormats: readonly (RHITextureFormat | null)[]
): boolean {
    if (record.colorFormats.length !== colorFormats.length) return true;
    for (let index = 0; index < colorFormats.length; index += 1) {
        if (record.colorFormats[index] !== colorFormats[index]) return true;
    }
    return false;
}

/**
 * Converts exact public engine state into monotonic PreparedDraw revisions. It intentionally does
 * not trust only legacy `isDirty` flags: public layout and render-state fields remain mutable.
 * A steady-state capture performs scalar/identity comparisons without allocating.
 */
export class MeshDrawRevisionTracker {
    #records = new WeakMap<object, MeshRevisionRecord>();
    #nextRevision = 1;

    capture(inputs: MeshDrawRevisionInputs): PreparedDrawRevision {
        requireToken(inputs.shaderToken, 'Shader token');
        requireToken(inputs.resourceBindings, 'Resource-binding token');
        requireToken(inputs.deviceGeneration, 'Device generation');
        const geometry = inputs.mesh.geometry;
        const vertices = geometry?.vertices;
        const material = inputs.material ?? inputs.mesh.material;
        if (!geometry || !vertices) {
            throw new Error(`Mesh ${inputs.mesh.id} requires geometry with a position stream`);
        }
        if (!material) throw new Error(`Mesh ${inputs.mesh.id} requires a material`);
        const indices = geometry.indices;
        const vertexLayoutIdentity = inputs.vertexLayoutIdentity ?? vertices;
        const colorFormats = inputs.target.colorFormats;
        const depthStencilFormat = inputs.target.depthStencilFormat ?? null;
        const owner = inputs.owner ?? inputs.mesh;
        let record = this.#records.get(owner);
        if (!record) {
            const geometryRevision = this.allocateRevision();
            const materialVariantRevision = this.allocateRevision();
            const renderStateRevision = this.allocateRevision();
            const bindingRevision = this.allocateRevision();
            const targetRevision = this.allocateRevision();
            record = {
                geometry,
                geometryRevision: geometry.revision,
                mode: geometry.mode,
                vertices,
                vertexRevision: vertices.revision,
                vertexData: vertices.data,
                vertexSize: vertices.size,
                vertexType: vertices.type,
                vertexNormalized: vertices.normalized,
                vertexStride: vertices.stride,
                vertexOffset: vertices.offset,
                vertexLayoutIdentity,
                indices,
                indexRevision: indices?.revision ?? -1,
                indexData: indices?.data ?? null,
                indexSize: indices?.size ?? 0,
                indexType: indices?.type ?? 0,
                indexNormalized: indices?.normalized ?? false,
                indexStride: indices?.stride ?? 0,
                indexOffset: indices?.offset ?? 0,
                material,
                materialRevision: material.revision,
                shaderToken: inputs.shaderToken,
                wireframe: material.wireframe,
                frontFace: material.frontFace,
                cullFace: material.cullFace,
                cullFaceType: material.cullFaceType,
                depthTest: material.depthTest,
                depthMask: material.depthMask,
                depthRangeMin: material.depthRange[0],
                depthRangeMax: material.depthRange[1],
                depthFunc: material.depthFunc,
                transparent: material.transparent,
                premultiplyAlpha: material.premultiplyAlpha,
                blend: material.blend,
                blendEquation: material.blendEquation,
                blendEquationAlpha: material.blendEquationAlpha,
                blendSrc: material.blendSrc,
                blendDst: material.blendDst,
                blendSrcAlpha: material.blendSrcAlpha,
                blendDstAlpha: material.blendDstAlpha,
                stencilTest: material.stencilTest,
                stencilMask: material.stencilMask,
                stencilFunc: material.stencilFunc,
                stencilFuncRef: material.stencilFuncRef,
                stencilFuncMask: material.stencilFuncMask,
                stencilOpFail: material.stencilOpFail,
                stencilOpZFail: material.stencilOpZFail,
                stencilOpZPass: material.stencilOpZPass,
                sampleAlphaToCoverage: material.sampleAlphaToCoverage,
                resourceBindings: inputs.resourceBindings,
                colorFormats: Object.freeze([...colorFormats]),
                depthStencilFormat,
                sampleCount: inputs.target.sampleCount,
                deviceGeneration: inputs.deviceGeneration,
                revision: {
                    geometry: geometryRevision,
                    materialVariant: materialVariantRevision,
                    renderState: renderStateRevision,
                    resourceBindings: bindingRevision,
                    target: targetRevision,
                    deviceGeneration: inputs.deviceGeneration
                }
            };
            this.#records.set(owner, record);
            return record.revision;
        }

        let geometryRevision = record.revision.geometry;
        let materialVariantRevision = record.revision.materialVariant;
        let renderStateRevision = record.revision.renderState;
        let bindingRevision = record.revision.resourceBindings;
        let targetRevision = record.revision.target;
        let changed = false;

        if (geometryChanged(record, geometry, vertices, indices, vertexLayoutIdentity)) {
            storeGeometry(record, geometry, vertices, indices, vertexLayoutIdentity);
            geometryRevision = this.allocateRevision();
            changed = true;
        }
        if (
            record.material !== material ||
            record.materialRevision !== material.revision ||
            record.shaderToken !== inputs.shaderToken
        ) {
            record.material = material;
            record.materialRevision = material.revision;
            record.shaderToken = inputs.shaderToken;
            materialVariantRevision = this.allocateRevision();
            changed = true;
        }
        if (renderStateChanged(record, material)) {
            storeRenderState(record, material);
            renderStateRevision = this.allocateRevision();
            changed = true;
        }
        if (record.resourceBindings !== inputs.resourceBindings) {
            record.resourceBindings = inputs.resourceBindings;
            bindingRevision = this.allocateRevision();
            changed = true;
        }
        if (
            targetColorFormatsChanged(record, colorFormats) ||
            record.depthStencilFormat !== depthStencilFormat ||
            record.sampleCount !== inputs.target.sampleCount
        ) {
            record.colorFormats = Object.freeze([...colorFormats]);
            record.depthStencilFormat = depthStencilFormat;
            record.sampleCount = inputs.target.sampleCount;
            targetRevision = this.allocateRevision();
            changed = true;
        }
        if (record.deviceGeneration !== inputs.deviceGeneration) {
            record.deviceGeneration = inputs.deviceGeneration;
            changed = true;
        }
        if (changed) {
            record.revision = {
                geometry: geometryRevision,
                materialVariant: materialVariantRevision,
                renderState: renderStateRevision,
                resourceBindings: bindingRevision,
                target: targetRevision,
                deviceGeneration: inputs.deviceGeneration
            };
        }
        return record.revision;
    }

    delete(owner: object): boolean {
        return this.#records.delete(owner);
    }

    clear(): void {
        this.#records = new WeakMap();
    }

    private allocateRevision(): number {
        const revision = this.#nextRevision;
        if (!Number.isSafeInteger(revision)) {
            throw new RangeError('Mesh draw revision space is exhausted');
        }
        this.#nextRevision++;
        return revision;
    }
}
