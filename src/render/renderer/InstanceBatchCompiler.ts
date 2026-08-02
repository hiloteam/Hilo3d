import Mesh from '../../core/Mesh';
import GeometryData from '../../geometry/GeometryData';
import Material, {
    type InstancedUniform,
    type MaterialBinding,
    type MaterialBindingInfo,
    type ProgramBindingInfo
} from '../../material/MaterialInstance';
import Matrix3 from '../../math/Matrix3';
import Matrix4 from '../../math/Matrix4';
import UniformBuffer from '../UniformBuffer';
import { instanceBlockLayout, MAX_INSTANCES_PER_DRAW } from '../ubo/BuiltInUniformBlocks';
import type { RHIBackend, RHILimits, RHIVertexBufferLayout, RHIVertexFormat } from '../rhi/core';

/** Rich vertex reflection retained by the shared GLSL frontend. */
export interface InstanceBatchVertexInputReflection {
    readonly name: string;
    readonly type: string;
    readonly location: number;
    /** Matrices occupy one location per column. Omitted values are derived from `type`. */
    readonly locationCount?: number;
}

/** The portable limits that can affect an instance-batch plan. */
export interface InstanceBatchCompilerCapabilities {
    readonly limits: Pick<
        RHILimits,
        'maxVertexAttributes' | 'maxVertexBuffers' | 'maxVertexBufferArrayStride'
    >;
}

/** Internal bridge to the submission-transactional current/previous transform store. */
export interface InstanceTransformHistory {
    readonly renderOrigin: Readonly<Float32Array>;
    writeInstanceModelMatrices(
        mesh: Mesh,
        current: Float32Array,
        previous: Float32Array,
        offset: number
    ): void;
}

/** One interleaved, high-water CPU stream appended after the per-vertex streams. */
export interface InstanceBatchVertexStreamPlan {
    readonly source: GeometryData;
    readonly slot: number;
    readonly capacity: number;
    readonly layout: Readonly<RHIVertexBufferLayout>;
    readonly inputs: readonly InstanceBatchVertexInputReflection[];
}

/** Stable plan owned by one exact batch owner/backend pair until it is detached. */
export interface InstanceBatchPlan {
    readonly owner: object | null;
    readonly backend: RHIBackend;
    readonly perVertexInputs: readonly InstanceBatchVertexInputReflection[];
    readonly perVertexBufferCount: number;
    readonly requiredVertexBufferCount: number;
    /** Custom reflected inputs on either backend, plus built-in matrices on WebGL2. */
    readonly instanceVertexStream: Readonly<InstanceBatchVertexStreamPlan> | null;
    /** WebGL2 alias for the instance vertex stream. Always null on WebGPU. */
    readonly webGLInstance: Readonly<InstanceBatchVertexStreamPlan> | null;
    /** Fixed-capacity model/normal matrix ABI. Always null on WebGL2. */
    readonly webGPUInstanceBlock: UniformBuffer | null;
    readonly instanceCount: number;
    readonly layoutRevision: number;
    readonly resourceRevision: number;
}

export interface InstanceBatchCompilerDiagnostics {
    readonly activeOwnerCount: number;
    readonly activePlanCount: number;
    readonly planCapacity: number;
    readonly resolvedInputCapacity: number;
    readonly maxInstanceCapacity: number;
    readonly storageAllocationCount: number;
}

interface MutableDiagnostics {
    activeOwnerCount: number;
    activePlanCount: number;
    planCapacity: number;
    resolvedInputCapacity: number;
    maxInstanceCapacity: number;
    storageAllocationCount: number;
}

interface InstanceShape {
    readonly components: number;
    readonly columns: number;
    readonly rows: number;
    readonly format: RHIVertexFormat;
}

interface MutablePerVertexInput {
    input: InstanceBatchVertexInputReflection;
    binding: MaterialBinding | undefined;
    source: GeometryData;
    name: string;
    type: string;
    location: number;
    locationCount: number;
}

interface MutableInstanceInput {
    input: InstanceBatchVertexInputReflection;
    binding: MaterialBindingInfo;
    name: string;
    type: string;
    location: number;
    locationCount: number;
    components: number;
    columns: number;
    rows: number;
    format: RHIVertexFormat;
    componentOffset: number;
    builtIn: 0 | 1 | 2;
}

interface InputSnapshot {
    input: InstanceBatchVertexInputReflection | null;
    binding: MaterialBinding | MaterialBindingInfo | undefined;
    source: GeometryData | null;
    name: string;
    type: string;
    location: number;
    locationCount: number;
    components: number;
    columns: number;
    rows: number;
    componentOffset: number;
    builtIn: 0 | 1 | 2;
}

interface OwnerRecords {
    webgl2: BatchRecord | null;
    webgpu: BatchRecord | null;
}

const EMPTY_PROGRAM_INFO: ProgramBindingInfo = Object.freeze({});
const MODEL_MATRIX_INPUT = 'u_modelMatrix';
const NORMAL_MATRIX_INPUT = 'u_normalWorldMatrix';
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

const FLOAT_SHAPE: InstanceShape = Object.freeze({
    components: 1,
    columns: 1,
    rows: 1,
    format: 'float32'
});
const VEC2_SHAPE: InstanceShape = Object.freeze({
    components: 2,
    columns: 1,
    rows: 2,
    format: 'float32x2'
});
const VEC3_SHAPE: InstanceShape = Object.freeze({
    components: 3,
    columns: 1,
    rows: 3,
    format: 'float32x3'
});
const VEC4_SHAPE: InstanceShape = Object.freeze({
    components: 4,
    columns: 1,
    rows: 4,
    format: 'float32x4'
});
const MAT2_SHAPE: InstanceShape = Object.freeze({
    components: 4,
    columns: 2,
    rows: 2,
    format: 'float32x2'
});
const MAT3_SHAPE: InstanceShape = Object.freeze({
    components: 9,
    columns: 3,
    rows: 3,
    format: 'float32x3'
});
const MAT4_SHAPE: InstanceShape = Object.freeze({
    components: 16,
    columns: 4,
    rows: 4,
    format: 'float32x4'
});

function requireLimit(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

function requireBackend(value: unknown): asserts value is RHIBackend {
    if (value !== 'webgl2' && value !== 'webgpu') {
        throw new RangeError(`Unsupported instance-batch backend: ${String(value)}`);
    }
}

function requirePresent<Value>(value: Value | null | undefined, description: string): Value {
    if (value === null || value === undefined) {
        throw new Error(`Instance batch compiler lost ${description}`);
    }
    return value;
}

function shapeFor(type: string, name: string): InstanceShape {
    switch (type) {
        case 'float':
            return FLOAT_SHAPE;
        case 'vec2':
            return VEC2_SHAPE;
        case 'vec3':
            return VEC3_SHAPE;
        case 'vec4':
            return VEC4_SHAPE;
        case 'mat2':
        case 'mat2x2':
            return MAT2_SHAPE;
        case 'mat3':
        case 'mat3x3':
            return MAT3_SHAPE;
        case 'mat4':
        case 'mat4x4':
            return MAT4_SHAPE;
        default:
            throw new TypeError(
                `Instanced input ${name} has unsupported reflected type ${type}; expected float, vec2-4, or mat2-4`
            );
    }
}

function reflectedLocationCount(
    input: InstanceBatchVertexInputReflection,
    name: string,
    derivedColumns?: number
): number {
    const locationCount = input.locationCount ?? derivedColumns ?? 1;
    if (!Number.isSafeInteger(locationCount) || locationCount <= 0) {
        throw new RangeError(`Vertex input ${name} locationCount must be a positive safe integer`);
    }
    return locationCount;
}

function reflectedTypeLocationCount(type: string): number {
    const matrix = /^mat([2-4])(?:x[2-4])?$/u.exec(type);
    return matrix?.[1] === undefined ? 1 : Number(matrix[1]);
}

function validateReflection(
    inputs: readonly InstanceBatchVertexInputReflection[],
    capabilities: InstanceBatchCompilerCapabilities
): void {
    const limits = capabilities.limits;
    requireLimit(limits.maxVertexAttributes, 'maxVertexAttributes');
    requireLimit(limits.maxVertexBuffers, 'maxVertexBuffers');
    requireLimit(limits.maxVertexBufferArrayStride, 'maxVertexBufferArrayStride');
    for (let index = 0; index < inputs.length; index += 1) {
        const input = inputs[index];
        if (input === undefined) throw new TypeError(`Vertex input ${String(index)} is missing`);
        if (typeof input.name !== 'string' || input.name.length === 0) {
            throw new TypeError(`Vertex input ${String(index)} must have a non-empty name`);
        }
        if (typeof input.type !== 'string' || input.type.length === 0) {
            throw new TypeError(`Vertex input ${input.name} must have a reflected GLSL type`);
        }
        if (!Number.isSafeInteger(input.location) || input.location < 0) {
            throw new RangeError(
                `Vertex input ${input.name} location must be a non-negative safe integer`
            );
        }
        const requiredLocationCount = reflectedTypeLocationCount(input.type);
        const locationCount = reflectedLocationCount(input, input.name, requiredLocationCount);
        if (locationCount !== requiredLocationCount) {
            throw new TypeError(
                `Vertex input ${input.name} type ${input.type} requires ${String(requiredLocationCount)} shader locations, received ${String(locationCount)}`
            );
        }
        const locationEnd = input.location + locationCount;
        if (locationEnd > limits.maxVertexAttributes) {
            throw new RangeError(
                `Vertex input ${input.name} occupies locations [${String(input.location)}, ${String(locationEnd)}), exceeding maxVertexAttributes ${String(limits.maxVertexAttributes)}`
            );
        }
        for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
            const previous = inputs[previousIndex];
            if (previous === undefined) continue;
            if (previous.name === input.name) {
                throw new TypeError(`Vertex input name ${input.name} is declared more than once`);
            }
            const previousCount = reflectedLocationCount(
                previous,
                previous.name,
                reflectedTypeLocationCount(previous.type)
            );
            const previousEnd = previous.location + previousCount;
            if (input.location < previousEnd && previous.location < locationEnd) {
                throw new TypeError(
                    `Vertex input ${input.name} overlaps ${previous.name} at shader location ${String(Math.max(input.location, previous.location))}`
                );
            }
        }
    }
}

function validateBatch(
    owner: unknown,
    meshes: readonly unknown[],
    material: unknown,
    allowMaterialOverride: boolean
): void {
    if (typeof owner !== 'object' || owner === null) {
        throw new TypeError('An instance batch requires a non-null object owner');
    }
    if (!(material instanceof Material)) {
        throw new TypeError('An instance batch requires a Material instance');
    }
    if (meshes.length === 0) {
        throw new RangeError('An instance batch requires at least one mesh');
    }
    if (meshes.length > MAX_INSTANCES_PER_DRAW) {
        throw new RangeError(
            `Instance batch count ${String(meshes.length)} exceeds MAX_INSTANCES_PER_DRAW ${String(MAX_INSTANCES_PER_DRAW)}`
        );
    }
    let geometry: Mesh['geometry'] = null;
    for (let index = 0; index < meshes.length; index += 1) {
        const mesh = meshes[index];
        if (!(mesh instanceof Mesh)) {
            throw new TypeError(`Instance batch entry ${String(index)} must be a Mesh instance`);
        }
        if (mesh.isDestroyed) {
            throw new TypeError(`Instance batch mesh ${mesh.name || mesh.id} is destroyed`);
        }
        if (!mesh.useInstanced) {
            throw new TypeError(
                `Instance batch mesh ${mesh.name || mesh.id} has not opted into instancing`
            );
        }
        if (!allowMaterialOverride && mesh.material !== material) {
            throw new TypeError(
                `Instance batch mesh ${mesh.name || mesh.id} does not use the batch material`
            );
        }
        if (mesh.geometry === null) {
            throw new TypeError(`Instance batch mesh ${mesh.name || mesh.id} has no geometry`);
        }
        if (geometry === null) geometry = mesh.geometry;
        else if (mesh.geometry !== geometry) {
            throw new TypeError('Every mesh in an instance batch must use the same geometry');
        }
        for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
            if (meshes[previousIndex] === mesh) {
                throw new TypeError(
                    `Instance batch contains mesh ${mesh.name || mesh.id} more than once`
                );
            }
        }
    }
}

function findInstancedBinding(
    bindings: readonly InstancedUniform[],
    name: string
): MaterialBindingInfo | undefined {
    for (const binding of bindings) {
        if (binding.name === name) return binding.info;
    }
    return undefined;
}

function numericElements(value: unknown): ArrayLike<unknown> | null {
    if (Array.isArray(value)) return value as unknown[];
    if (ArrayBuffer.isView(value)) {
        return value instanceof DataView ? null : (value as unknown as ArrayLike<unknown>);
    }
    if (typeof value !== 'object' || value === null) return null;
    const elements: unknown = Reflect.get(value, 'elements');
    if (Array.isArray(elements)) return elements as unknown[];
    if (ArrayBuffer.isView(elements) && !(elements instanceof DataView)) {
        return elements as unknown as ArrayLike<unknown>;
    }
    return null;
}

function copyResolvedValue(
    target: Float32Array,
    targetOffset: number,
    value: unknown,
    expectedLength: number,
    name: string,
    mesh: Mesh
): void {
    if (expectedLength === 1 && typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(
                `Instanced input ${name} on mesh ${mesh.name || mesh.id} must be finite`
            );
        }
        target[targetOffset] = value;
        return;
    }
    const elements = numericElements(value);
    if (elements?.length !== expectedLength) {
        throw new TypeError(
            `Instanced input ${name} on mesh ${mesh.name || mesh.id} must resolve to exactly ${String(expectedLength)} numeric values`
        );
    }
    for (let index = 0; index < expectedLength; index += 1) {
        const component = elements[index];
        if (typeof component !== 'number' || !Number.isFinite(component)) {
            throw new TypeError(
                `Instanced input ${name} on mesh ${mesh.name || mesh.id} must contain only finite numbers`
            );
        }
        target[targetOffset + index] = component;
    }
}

function validateWorldMatrix(mesh: Mesh): ArrayLike<number> {
    const elements = mesh.worldMatrix.elements;
    if (elements.length !== 16) {
        throw new TypeError(`Mesh ${mesh.name || mesh.id} has an invalid world matrix`);
    }
    for (let index = 0; index < 16; index += 1) {
        if (!Number.isFinite(elements[index])) {
            throw new TypeError(
                `Mesh ${mesh.name || mesh.id} world matrix must contain only finite values`
            );
        }
    }
    return elements;
}

function requireInvertibleWorldMatrix(mesh: Mesh): void {
    const determinant = mesh.worldMatrix.determinant();
    if (!Number.isFinite(determinant) || determinant === 0) {
        throw new TypeError(
            `Mesh ${mesh.name || mesh.id} world matrix must be invertible for normal-matrix instancing`
        );
    }
}

function arraysEqual(
    left: Float32Array,
    right: Float32Array,
    length: number,
    rightOffset = 0
): boolean {
    for (let index = 0; index < length; index += 1) {
        if (left[index] !== right[rightOffset + index]) return false;
    }
    return true;
}

function copyFloats(target: Float32Array, source: Float32Array, length: number): void {
    for (let index = 0; index < length; index += 1) {
        target[index] = requirePresent(source[index], 'staged instance component');
    }
}

function nextCapacity(current: number, required: number): number {
    let capacity = Math.max(1, current);
    while (capacity < required) capacity *= 2;
    return Math.min(capacity, MAX_INSTANCES_PER_DRAW);
}

function nextStorageByteLength(required: number): number {
    let byteLength = 64;
    while (byteLength < required) byteLength *= 2;
    return byteLength;
}

function perVertexSnapshotMatches(
    snapshot: InputSnapshot | undefined,
    candidate: MutablePerVertexInput
): boolean {
    return (
        snapshot?.input === candidate.input &&
        snapshot.binding === candidate.binding &&
        snapshot.source === candidate.source &&
        snapshot.name === candidate.name &&
        snapshot.type === candidate.type &&
        snapshot.location === candidate.location &&
        snapshot.locationCount === candidate.locationCount
    );
}

function instanceSnapshotMatches(
    snapshot: InputSnapshot | undefined,
    candidate: MutableInstanceInput
): boolean {
    return (
        snapshot?.input === candidate.input &&
        snapshot.binding === candidate.binding &&
        snapshot.name === candidate.name &&
        snapshot.type === candidate.type &&
        snapshot.location === candidate.location &&
        snapshot.locationCount === candidate.locationCount &&
        snapshot.components === candidate.components &&
        snapshot.columns === candidate.columns &&
        snapshot.rows === candidate.rows &&
        snapshot.componentOffset === candidate.componentOffset &&
        snapshot.builtIn === candidate.builtIn
    );
}

function assignPerVertexSnapshot(snapshot: InputSnapshot, candidate: MutablePerVertexInput): void {
    snapshot.input = candidate.input;
    snapshot.binding = candidate.binding;
    snapshot.source = candidate.source;
    snapshot.name = candidate.name;
    snapshot.type = candidate.type;
    snapshot.location = candidate.location;
    snapshot.locationCount = candidate.locationCount;
    snapshot.components = 0;
    snapshot.columns = 0;
    snapshot.rows = 0;
    snapshot.componentOffset = 0;
    snapshot.builtIn = 0;
}

function assignInstanceSnapshot(snapshot: InputSnapshot, candidate: MutableInstanceInput): void {
    snapshot.input = candidate.input;
    snapshot.binding = candidate.binding;
    snapshot.source = null;
    snapshot.name = candidate.name;
    snapshot.type = candidate.type;
    snapshot.location = candidate.location;
    snapshot.locationCount = candidate.locationCount;
    snapshot.components = candidate.components;
    snapshot.columns = candidate.columns;
    snapshot.rows = candidate.rows;
    snapshot.componentOffset = candidate.componentOffset;
    snapshot.builtIn = candidate.builtIn;
}

function emptySnapshot(): InputSnapshot {
    return {
        input: null,
        binding: undefined,
        source: null,
        name: '',
        type: '',
        location: 0,
        locationCount: 0,
        components: 0,
        columns: 0,
        rows: 0,
        componentOffset: 0,
        builtIn: 0
    };
}

function emptyPerVertexInput(): MutablePerVertexInput {
    return {
        input: { name: '', type: '', location: 0 },
        binding: undefined,
        source: null as unknown as GeometryData,
        name: '',
        type: '',
        location: 0,
        locationCount: 0
    };
}

function emptyInstanceInput(): MutableInstanceInput {
    return {
        input: { name: '', type: '', location: 0 },
        binding: null as unknown as MaterialBindingInfo,
        name: '',
        type: '',
        location: 0,
        locationCount: 0,
        components: 0,
        columns: 0,
        rows: 0,
        format: 'float32',
        componentOffset: 0,
        builtIn: 0
    };
}

function compareInstanceInputs(left: MutableInstanceInput, right: MutableInstanceInput): number {
    return left.location - right.location;
}

class BatchRecord {
    readonly backend: RHIBackend;
    readonly plan: Readonly<InstanceBatchPlan>;
    readonly streamPlan: Readonly<InstanceBatchVertexStreamPlan>;
    private readonly diagnostics: MutableDiagnostics;
    private active = false;
    private ownerValue: object | null = null;
    private initialized = false;
    private material: Material | null = null;
    private readonly publicPerVertexInputs: InstanceBatchVertexInputReflection[] = [];
    private readonly publicInstanceInputs: InstanceBatchVertexInputReflection[] = [];
    private readonly committedMeshes: Mesh[] = [];
    private readonly perVertexSnapshots: InputSnapshot[] = [];
    private readonly instanceSnapshots: InputSnapshot[] = [];
    private perVertexSnapshotCount = 0;
    private instanceSnapshotCount = 0;
    private readonly perVertexScratchPool: MutablePerVertexInput[] = [];
    private readonly perVertexScratch: MutablePerVertexInput[] = [];
    private readonly instanceScratchPool: MutableInstanceInput[] = [];
    private readonly instanceScratch: MutableInstanceInput[] = [];
    private perVertexBufferCountValue = 0;
    private instanceCountValue = 0;
    private layoutRevisionValue = 0;
    private resourceRevisionValue = 0;
    private hasInstanceStream = false;
    private streamLayout: Readonly<RHIVertexBufferLayout> | null = null;
    private streamSource: GeometryData | null = null;
    private streamCapacity = 0;
    private streamComponents = 0;
    private currentStorage: ArrayBuffer | null = null;
    private stagingStorage: ArrayBuffer | null = null;
    private currentView: Float32Array | null = null;
    private stagingView: Float32Array | null = null;
    private uniformBuffer: UniformBuffer | null = null;
    private uniformBufferFloats: Float32Array | null = null;
    private modelScratch: Float32Array | null = null;
    private previousModelScratch: Float32Array | null = null;
    private normalScratch: Float32Array | null = null;
    private readonly normalMatrix3 = new Matrix3();
    private readonly normalMatrix4 = new Matrix4();

    constructor(backend: RHIBackend, diagnostics: MutableDiagnostics) {
        this.backend = backend;
        this.diagnostics = diagnostics;
        const streamSource = () => requirePresent(this.streamSource, 'active instance stream');
        const streamLayout = () => requirePresent(this.streamLayout, 'active instance layout');
        const streamSlot = () => this.perVertexBufferCountValue;
        const streamCapacity = () => this.streamCapacity;
        const streamInputs = () => this.publicInstanceInputs;
        const planOwner = () => (this.active ? this.ownerValue : null);
        const perVertexInputs = () => this.publicPerVertexInputs;
        const perVertexBufferCount = () => this.perVertexBufferCountValue;
        const requiredVertexBufferCount = () =>
            this.perVertexBufferCountValue + (this.hasInstanceStream ? 1 : 0);
        const instanceVertexStream = () =>
            this.active && this.hasInstanceStream ? this.streamPlan : null;
        const webGLInstance = () =>
            this.active && backend === 'webgl2' && this.hasInstanceStream ? this.streamPlan : null;
        const webGPUInstanceBlock = () =>
            this.active && backend === 'webgpu' ? this.uniformBuffer : null;
        const instanceCount = () => (this.active ? this.instanceCountValue : 0);
        const layoutRevision = () => (this.active ? this.layoutRevisionValue : 0);
        const resourceRevision = () => (this.active ? this.resourceRevisionValue : 0);
        this.streamPlan = Object.freeze({
            get source() {
                return streamSource();
            },
            get slot() {
                return streamSlot();
            },
            get capacity() {
                return streamCapacity();
            },
            get layout() {
                return streamLayout();
            },
            get inputs() {
                return streamInputs();
            }
        });
        this.plan = Object.freeze({
            get owner() {
                return planOwner();
            },
            backend,
            get perVertexInputs() {
                return perVertexInputs();
            },
            get perVertexBufferCount() {
                return perVertexBufferCount();
            },
            get requiredVertexBufferCount() {
                return requiredVertexBufferCount();
            },
            get instanceVertexStream() {
                return instanceVertexStream();
            },
            get webGLInstance() {
                return webGLInstance();
            },
            get webGPUInstanceBlock() {
                return webGPUInstanceBlock();
            },
            get instanceCount() {
                return instanceCount();
            },
            get layoutRevision() {
                return layoutRevision();
            },
            get resourceRevision() {
                return resourceRevision();
            }
        });
    }

    compile(
        owner: object,
        meshes: readonly Mesh[],
        material: Material,
        inputs: readonly InstanceBatchVertexInputReflection[],
        capabilities: InstanceBatchCompilerCapabilities,
        programInfo: ProgramBindingInfo,
        transformHistory?: InstanceTransformHistory
    ): Readonly<InstanceBatchPlan> {
        this.classify(
            inputs,
            requirePresent(meshes[0], 'first instance mesh'),
            material,
            capabilities,
            programInfo
        );
        const perVertexCount = this.perVertexScratch.length;
        const instanceInputCount = this.instanceScratch.length;
        let perVertexChanged =
            !this.initialized ||
            this.material !== material ||
            this.perVertexSnapshotCount !== perVertexCount;
        if (!perVertexChanged) {
            for (let index = 0; index < perVertexCount; index += 1) {
                const candidate = this.perVertexScratch[index];
                if (
                    candidate === undefined ||
                    !perVertexSnapshotMatches(this.perVertexSnapshots[index], candidate)
                ) {
                    perVertexChanged = true;
                    break;
                }
            }
        }
        let instanceLayoutChanged =
            !this.initialized ||
            this.material !== material ||
            this.instanceSnapshotCount !== instanceInputCount;
        if (!instanceLayoutChanged) {
            for (let index = 0; index < instanceInputCount; index += 1) {
                const candidate = this.instanceScratch[index];
                if (
                    candidate === undefined ||
                    !instanceSnapshotMatches(this.instanceSnapshots[index], candidate)
                ) {
                    instanceLayoutChanged = true;
                    break;
                }
            }
        }
        const nextPerVertexBufferCount = this.countPerVertexBuffers();
        if (nextPerVertexBufferCount !== this.perVertexBufferCountValue) perVertexChanged = true;
        const hasStream = instanceInputCount > 0;
        let componentCount = 0;
        if (hasStream) {
            const lastInput = requirePresent(
                this.instanceScratch[instanceInputCount - 1],
                'last reflected instance input'
            );
            componentCount = lastInput.componentOffset + lastInput.components;
        }
        if (hasStream !== this.hasInstanceStream || componentCount !== this.streamComponents) {
            instanceLayoutChanged = true;
        }
        const requiredBufferCount = nextPerVertexBufferCount + (hasStream ? 1 : 0);
        if (requiredBufferCount > capabilities.limits.maxVertexBuffers) {
            throw new RangeError(
                `Instance batch requires ${String(requiredBufferCount)} vertex buffers, exceeding maxVertexBuffers ${String(capabilities.limits.maxVertexBuffers)}`
            );
        }
        const stride = componentCount * FLOAT_BYTES;
        if (stride > capabilities.limits.maxVertexBufferArrayStride) {
            throw new RangeError(
                `Instance stream stride ${String(stride)} exceeds maxVertexBufferArrayStride ${String(capabilities.limits.maxVertexBufferArrayStride)}`
            );
        }

        let candidateCapacity = this.streamCapacity;
        let candidateCurrentStorage = this.currentStorage;
        let candidateStagingStorage = this.stagingStorage;
        let candidateCurrentView = this.currentView;
        let candidateStagingView = this.stagingView;
        if (hasStream) {
            candidateCapacity = nextCapacity(candidateCapacity, meshes.length);
            const requiredFloatLength = candidateCapacity * componentCount;
            const requiredByteLength = requiredFloatLength * FLOAT_BYTES;
            if (
                candidateCurrentStorage === null ||
                candidateStagingStorage === null ||
                candidateCurrentStorage.byteLength < requiredByteLength ||
                candidateStagingStorage.byteLength < requiredByteLength
            ) {
                const storageByteLength = nextStorageByteLength(requiredByteLength);
                candidateCurrentStorage = new ArrayBuffer(storageByteLength);
                candidateStagingStorage = new ArrayBuffer(storageByteLength);
                this.diagnostics.storageAllocationCount += 2;
            }
            if (
                candidateCurrentView?.buffer !== candidateCurrentStorage ||
                candidateCurrentView.length !== requiredFloatLength
            ) {
                candidateCurrentView = new Float32Array(
                    candidateCurrentStorage,
                    0,
                    requiredFloatLength
                );
            }
            if (
                candidateStagingView?.buffer !== candidateStagingStorage ||
                candidateStagingView.length !== requiredFloatLength
            ) {
                candidateStagingView = new Float32Array(
                    candidateStagingStorage,
                    0,
                    requiredFloatLength
                );
            }
            this.fillInstanceStream(
                requirePresent(candidateStagingView, 'instance staging view'),
                meshes,
                material,
                programInfo,
                transformHistory?.renderOrigin
            );
        }

        let modelChanged = false;
        let normalChanged = false;
        if (this.backend === 'webgpu') {
            this.ensureUniformScratch();
            const modelScratch = requirePresent(this.modelScratch, 'model-matrix staging storage');
            const previousModelScratch = requirePresent(
                this.previousModelScratch,
                'previous model-matrix staging storage'
            );
            const normalScratch = requirePresent(
                this.normalScratch,
                'normal-matrix staging storage'
            );
            modelScratch.fill(0);
            previousModelScratch.fill(0);
            normalScratch.fill(0);
            for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
                const mesh = requirePresent(meshes[meshIndex], 'instance mesh');
                const matrixOffset = meshIndex * 16;
                if (transformHistory !== undefined) {
                    transformHistory.writeInstanceModelMatrices(
                        mesh,
                        modelScratch,
                        previousModelScratch,
                        matrixOffset
                    );
                } else {
                    const world = validateWorldMatrix(mesh);
                    for (let component = 0; component < 16; component += 1) {
                        const value = requirePresent(world[component], 'world-matrix component');
                        modelScratch[matrixOffset + component] = value;
                        previousModelScratch[matrixOffset + component] = value;
                    }
                }
                requireInvertibleWorldMatrix(mesh);
                this.normalMatrix4.invert(mesh.worldMatrix).transpose();
                const normal = this.normalMatrix4.elements;
                for (let component = 0; component < 16; component += 1) {
                    const value = requirePresent(normal[component], 'normal-matrix component');
                    if (!Number.isFinite(value)) {
                        throw new TypeError(
                            `Mesh ${mesh.name || mesh.id} produced a non-finite normal matrix`
                        );
                    }
                    normalScratch[matrixOffset + component] = value;
                }
            }
            if (this.uniformBufferFloats === null) {
                modelChanged = true;
                normalChanged = true;
            } else {
                const modelOffset =
                    instanceBlockLayout.fields.u_instanceModelMatrices.offset / FLOAT_BYTES;
                const normalOffset =
                    instanceBlockLayout.fields.u_instanceNormalMatrices.offset / FLOAT_BYTES;
                const previousModelOffset =
                    instanceBlockLayout.fields.u_previousInstanceModelMatrices.offset / FLOAT_BYTES;
                modelChanged =
                    !arraysEqual(
                        modelScratch,
                        this.uniformBufferFloats,
                        modelScratch.length,
                        modelOffset
                    ) ||
                    !arraysEqual(
                        previousModelScratch,
                        this.uniformBufferFloats,
                        previousModelScratch.length,
                        previousModelOffset
                    );
                normalChanged = !arraysEqual(
                    normalScratch,
                    this.uniformBufferFloats,
                    normalScratch.length,
                    normalOffset
                );
            }
        }

        let membershipChanged = this.committedMeshes.length !== meshes.length;
        if (!membershipChanged) {
            for (let index = 0; index < meshes.length; index += 1) {
                if (this.committedMeshes[index] !== meshes[index]) {
                    membershipChanged = true;
                    break;
                }
            }
        }
        let streamBytesChanged = false;
        if (hasStream) {
            const activeFloatLength = meshes.length * componentCount;
            const current = requirePresent(candidateCurrentView, 'instance current view');
            const staging = requirePresent(candidateStagingView, 'instance staging view');
            streamBytesChanged =
                instanceLayoutChanged ||
                candidateCurrentView !== this.currentView ||
                this.currentView === null ||
                !arraysEqual(staging, current, activeFloatLength);
        }
        const layoutChanged = perVertexChanged || instanceLayoutChanged;
        const resourceChanged =
            membershipChanged ||
            instanceLayoutChanged ||
            streamBytesChanged ||
            modelChanged ||
            normalChanged;

        let candidateLayout = this.streamLayout;
        if (instanceLayoutChanged) {
            candidateLayout = hasStream ? this.buildStreamLayout(stride) : null;
        }

        if (hasStream) {
            const activeFloatLength = meshes.length * componentCount;
            const current = requirePresent(candidateCurrentView, 'instance current view');
            const staging = requirePresent(candidateStagingView, 'instance staging view');
            if (streamBytesChanged) {
                copyFloats(current, staging, activeFloatLength);
            }
            const sourceNeedsReplacementView =
                this.streamSource === null ||
                candidateCurrentView !== this.currentView ||
                instanceLayoutChanged;
            if (this.streamSource === null) {
                this.streamSource = new GeometryData(current, 1, {
                    stride
                });
            } else if (sourceNeedsReplacementView) {
                this.streamSource.stride = stride;
                this.streamSource.data = current;
            } else if (streamBytesChanged) {
                this.streamSource.isDirty = true;
            }
            this.currentStorage = candidateCurrentStorage;
            this.stagingStorage = candidateStagingStorage;
            this.currentView = candidateCurrentView;
            this.stagingView = candidateStagingView;
            this.streamCapacity = candidateCapacity;
            if (candidateCapacity > this.diagnostics.maxInstanceCapacity) {
                this.diagnostics.maxInstanceCapacity = candidateCapacity;
            }
        }
        if (this.backend === 'webgpu' && (modelChanged || normalChanged)) {
            if (this.uniformBuffer === null) {
                this.uniformBuffer = UniformBuffer.fromSchema(instanceBlockLayout);
                this.uniformBufferFloats = new Float32Array(this.uniformBuffer.data);
                this.diagnostics.storageAllocationCount++;
            }
            if (modelChanged) {
                this.uniformBuffer.set(
                    'u_instanceModelMatrices',
                    requirePresent(this.modelScratch, 'model-matrix staging storage')
                );
                this.uniformBuffer.set(
                    'u_previousInstanceModelMatrices',
                    requirePresent(
                        this.previousModelScratch,
                        'previous model-matrix staging storage'
                    )
                );
            }
            if (normalChanged) {
                this.uniformBuffer.set(
                    'u_instanceNormalMatrices',
                    requirePresent(this.normalScratch, 'normal-matrix staging storage')
                );
            }
        }

        this.commitLayoutSnapshots(material);
        this.committedMeshes.length = 0;
        for (const mesh of meshes) this.committedMeshes.push(mesh);
        this.ownerValue = owner;
        this.material = material;
        this.active = true;
        this.initialized = true;
        this.perVertexBufferCountValue = nextPerVertexBufferCount;
        this.instanceCountValue = meshes.length;
        this.hasInstanceStream = hasStream;
        this.streamComponents = componentCount;
        this.streamLayout = candidateLayout;
        if (layoutChanged) this.layoutRevisionValue++;
        if (resourceChanged) this.resourceRevisionValue++;
        return this.plan;
    }

    detach(): void {
        this.active = false;
        this.ownerValue = null;
        this.initialized = false;
        this.material = null;
        this.publicPerVertexInputs.length = 0;
        this.publicInstanceInputs.length = 0;
        this.committedMeshes.length = 0;
        this.perVertexSnapshots.length = 0;
        this.instanceSnapshots.length = 0;
        this.perVertexSnapshotCount = 0;
        this.instanceSnapshotCount = 0;
        this.perVertexBufferCountValue = 0;
        this.instanceCountValue = 0;
        this.layoutRevisionValue = 0;
        this.resourceRevisionValue = 0;
        this.hasInstanceStream = false;
        this.streamLayout = null;
        this.streamSource = null;
        this.streamCapacity = 0;
        this.streamComponents = 0;
        this.currentStorage = null;
        this.stagingStorage = null;
        this.currentView = null;
        this.stagingView = null;
        this.uniformBuffer = null;
        this.uniformBufferFloats = null;
        this.modelScratch = null;
        this.previousModelScratch = null;
        this.normalScratch = null;
    }

    private classify(
        inputs: readonly InstanceBatchVertexInputReflection[],
        firstMesh: Mesh,
        material: Material,
        capabilities: InstanceBatchCompilerCapabilities,
        programInfo: ProgramBindingInfo
    ): void {
        validateReflection(inputs, capabilities);
        this.perVertexScratch.length = 0;
        this.instanceScratch.length = 0;
        const instancedBindings = material.getInstancedUniforms();
        let perVertexIndex = 0;
        let instanceIndex = 0;
        for (const input of inputs) {
            const name = input.name;
            const type = input.type;
            if (Object.hasOwn(material.attributes, name)) {
                const locationCount = reflectedLocationCount(
                    input,
                    name,
                    reflectedTypeLocationCount(type)
                );
                const value = material.getAttributeData(name, firstMesh, programInfo);
                if (!(value instanceof GeometryData)) {
                    throw new TypeError(`Per-vertex input ${name} must resolve to GeometryData`);
                }
                const candidate = this.requirePerVertexScratch(perVertexIndex++);
                candidate.input = input;
                candidate.binding = material.attributes[name];
                candidate.source = value;
                candidate.name = name;
                candidate.type = type;
                candidate.location = input.location;
                candidate.locationCount = locationCount;
                this.perVertexScratch.push(candidate);
                continue;
            }
            const binding = findInstancedBinding(instancedBindings, name);
            if (binding === undefined) {
                throw new TypeError(
                    `Vertex input ${name} has neither a per-vertex attribute nor a mesh-dependent instanced binding`
                );
            }
            if (
                this.backend === 'webgpu' &&
                (name === MODEL_MATRIX_INPUT || name === NORMAL_MATRIX_INPUT)
            ) {
                throw new TypeError(
                    `WebGPU built-in input ${name} must be supplied by InstanceBlock, not reflected as a vertex input`
                );
            }
            const shape = shapeFor(type, name);
            const locationCount = reflectedLocationCount(input, name, shape.columns);
            if (locationCount !== shape.columns) {
                throw new TypeError(
                    `Instanced input ${name} type ${type} requires ${String(shape.columns)} shader locations, received ${String(locationCount)}`
                );
            }
            if (name === MODEL_MATRIX_INPUT && (shape.columns !== 4 || shape.rows !== 4)) {
                throw new TypeError(
                    'u_modelMatrix must be reflected as mat4 for WebGL2 instancing'
                );
            }
            if (name === NORMAL_MATRIX_INPUT && (shape.columns !== 3 || shape.rows !== 3)) {
                throw new TypeError(
                    'u_normalWorldMatrix must be reflected as mat3 for WebGL2 instancing'
                );
            }
            const candidate = this.requireInstanceScratch(instanceIndex++);
            candidate.input = input;
            candidate.binding = binding;
            candidate.name = name;
            candidate.type = type;
            candidate.location = input.location;
            candidate.locationCount = locationCount;
            candidate.components = shape.components;
            candidate.columns = shape.columns;
            candidate.rows = shape.rows;
            candidate.format = shape.format;
            candidate.componentOffset = 0;
            candidate.builtIn =
                name === MODEL_MATRIX_INPUT ? 1 : name === NORMAL_MATRIX_INPUT ? 2 : 0;
            this.instanceScratch.push(candidate);
        }
        this.instanceScratch.sort(compareInstanceInputs);
        let componentOffset = 0;
        for (const input of this.instanceScratch) {
            input.componentOffset = componentOffset;
            componentOffset += input.components;
        }
    }

    private requirePerVertexScratch(index: number): MutablePerVertexInput {
        let candidate = this.perVertexScratchPool[index];
        if (candidate === undefined) {
            candidate = emptyPerVertexInput();
            this.perVertexScratchPool[index] = candidate;
            this.diagnostics.resolvedInputCapacity++;
        }
        return candidate;
    }

    private requireInstanceScratch(index: number): MutableInstanceInput {
        let candidate = this.instanceScratchPool[index];
        if (candidate === undefined) {
            candidate = emptyInstanceInput();
            this.instanceScratchPool[index] = candidate;
            this.diagnostics.resolvedInputCapacity++;
        }
        return candidate;
    }

    private countPerVertexBuffers(): number {
        let count = 0;
        for (let index = 0; index < this.perVertexScratch.length; index += 1) {
            const candidate = requirePresent(
                this.perVertexScratch[index],
                'per-vertex input classification'
            );
            let duplicate = false;
            for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
                const previous = requirePresent(
                    this.perVertexScratch[previousIndex],
                    'previous per-vertex input classification'
                );
                if (previous.source === candidate.source) {
                    duplicate = true;
                    break;
                }
                if (previous.source.bufferViewId === candidate.source.bufferViewId) {
                    const previousData = previous.source.data;
                    const candidateData = candidate.source.data;
                    const sameRange =
                        previousData === candidateData ||
                        (previousData.buffer === candidateData.buffer &&
                            previousData.byteOffset === candidateData.byteOffset &&
                            previousData.byteLength === candidateData.byteLength);
                    if (!sameRange) {
                        throw new TypeError(
                            `Per-vertex inputs sharing bufferViewId ${candidate.source.bufferViewId} must reference the exact same underlying byte range`
                        );
                    }
                    const previousStride =
                        previous.source.stride === 0
                            ? previous.source.size * previousData.BYTES_PER_ELEMENT
                            : previous.source.stride;
                    const candidateStride =
                        candidate.source.stride === 0
                            ? candidate.source.size * candidateData.BYTES_PER_ELEMENT
                            : candidate.source.stride;
                    if (previousStride !== candidateStride) {
                        throw new TypeError(
                            `Per-vertex inputs sharing bufferViewId ${candidate.source.bufferViewId} must use the same effective array stride`
                        );
                    }
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) count++;
        }
        return count;
    }

    private fillInstanceStream(
        target: Float32Array,
        meshes: readonly Mesh[],
        material: Material,
        programInfo: ProgramBindingInfo,
        renderOrigin?: Readonly<Float32Array>
    ): void {
        let componentsPerInstance = 0;
        const last = this.instanceScratch.at(-1);
        if (last !== undefined) componentsPerInstance = last.componentOffset + last.components;
        for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
            const mesh = requirePresent(meshes[meshIndex], 'instance mesh');
            const instanceOffset = meshIndex * componentsPerInstance;
            for (const input of this.instanceScratch) {
                const targetOffset = instanceOffset + input.componentOffset;
                if (input.builtIn === 1) {
                    const world = validateWorldMatrix(mesh);
                    if (renderOrigin !== undefined) {
                        this.normalMatrix4.fromArray(world);
                        this.normalMatrix4.elements[12] -= renderOrigin[0] ?? 0;
                        this.normalMatrix4.elements[13] -= renderOrigin[1] ?? 0;
                        this.normalMatrix4.elements[14] -= renderOrigin[2] ?? 0;
                    }
                    copyResolvedValue(
                        target,
                        targetOffset,
                        renderOrigin === undefined ? world : this.normalMatrix4.elements,
                        16,
                        input.name,
                        mesh
                    );
                } else if (input.builtIn === 2) {
                    validateWorldMatrix(mesh);
                    requireInvertibleWorldMatrix(mesh);
                    this.normalMatrix3.normalFromMat4(mesh.worldMatrix);
                    copyResolvedValue(
                        target,
                        targetOffset,
                        this.normalMatrix3.elements,
                        9,
                        input.name,
                        mesh
                    );
                } else {
                    const value = input.binding.get(mesh, material, programInfo);
                    copyResolvedValue(
                        target,
                        targetOffset,
                        value,
                        input.components,
                        input.name,
                        mesh
                    );
                }
            }
        }
    }

    private ensureUniformScratch(): void {
        if (
            this.modelScratch !== null &&
            this.previousModelScratch !== null &&
            this.normalScratch !== null
        )
            return;
        const componentCount = MAX_INSTANCES_PER_DRAW * 16;
        this.modelScratch = new Float32Array(componentCount);
        this.previousModelScratch = new Float32Array(componentCount);
        this.normalScratch = new Float32Array(componentCount);
        this.diagnostics.storageAllocationCount += 3;
    }

    private buildStreamLayout(stride: number): Readonly<RHIVertexBufferLayout> {
        const attributeCount = this.instanceScratch.reduce(
            (count, input) => count + input.columns,
            0
        );
        const attributes = new Array<
            Readonly<{
                format: RHIVertexFormat;
                offset: number;
                shaderLocation: number;
            }>
        >(attributeCount);
        let attributeIndex = 0;
        for (const input of this.instanceScratch) {
            for (let column = 0; column < input.columns; column += 1) {
                attributes[attributeIndex++] = Object.freeze({
                    format: input.format,
                    offset: (input.componentOffset + column * input.rows) * FLOAT_BYTES,
                    shaderLocation: input.location + column
                });
            }
        }
        return Object.freeze({
            arrayStride: stride,
            stepMode: 'instance',
            attributes: Object.freeze(attributes)
        });
    }

    private commitLayoutSnapshots(material: Material): void {
        const perVertexCount = this.perVertexScratch.length;
        this.perVertexSnapshotCount = perVertexCount;
        this.publicPerVertexInputs.length = perVertexCount;
        let perVertexIndex = 0;
        for (const candidate of this.perVertexScratch) {
            const snapshot = this.perVertexSnapshots[perVertexIndex] ?? emptySnapshot();
            assignPerVertexSnapshot(snapshot, candidate);
            this.perVertexSnapshots[perVertexIndex] = snapshot;
            this.publicPerVertexInputs[perVertexIndex] = candidate.input;
            perVertexIndex++;
        }
        const instanceCount = this.instanceScratch.length;
        this.instanceSnapshotCount = instanceCount;
        this.publicInstanceInputs.length = instanceCount;
        let instanceIndex = 0;
        for (const candidate of this.instanceScratch) {
            const snapshot = this.instanceSnapshots[instanceIndex] ?? emptySnapshot();
            assignInstanceSnapshot(snapshot, candidate);
            this.instanceSnapshots[instanceIndex] = snapshot;
            this.publicInstanceInputs[instanceIndex] = candidate.input;
            instanceIndex++;
        }
        this.material = material;
    }
}

/**
 * Compile one exact mesh batch into backend-neutral per-vertex classification, an optional
 * interleaved instance stream, and the canonical WebGPU InstanceBlock.
 *
 * All binding values are staged and validated before any previously returned plan or resource is
 * mutated. CPU storage grows geometrically to the batch high-water mark and remains stable on a
 * steady layout/count.
 */
export class InstanceBatchCompiler {
    private readonly owners = new Map<object, OwnerRecords>();
    private readonly diagnosticState: MutableDiagnostics = {
        activeOwnerCount: 0,
        activePlanCount: 0,
        planCapacity: 0,
        resolvedInputCapacity: 0,
        maxInstanceCapacity: 0,
        storageAllocationCount: 0
    };
    readonly diagnostics: Readonly<InstanceBatchCompilerDiagnostics>;

    constructor() {
        const state = this.diagnosticState;
        this.diagnostics = Object.freeze({
            get activeOwnerCount() {
                return state.activeOwnerCount;
            },
            get activePlanCount() {
                return state.activePlanCount;
            },
            get planCapacity() {
                return state.planCapacity;
            },
            get resolvedInputCapacity() {
                return state.resolvedInputCapacity;
            },
            get maxInstanceCapacity() {
                return state.maxInstanceCapacity;
            },
            get storageAllocationCount() {
                return state.storageAllocationCount;
            }
        });
    }

    compile(
        owner: object,
        meshes: readonly Mesh[],
        material: Material,
        inputs: readonly InstanceBatchVertexInputReflection[],
        backend: RHIBackend,
        capabilities: InstanceBatchCompilerCapabilities,
        programInfo: ProgramBindingInfo = EMPTY_PROGRAM_INFO,
        allowMaterialOverride = false,
        transformHistory?: InstanceTransformHistory
    ): Readonly<InstanceBatchPlan> {
        validateBatch(owner, meshes, material, allowMaterialOverride);
        requireBackend(backend);
        let records = this.owners.get(owner);
        let createdOwner = false;
        if (records === undefined) {
            records = { webgl2: null, webgpu: null };
            createdOwner = true;
        }
        let record = records[backend];
        let createdRecord = false;
        if (record === null) {
            record = new BatchRecord(backend, this.diagnosticState);
            createdRecord = true;
            this.diagnosticState.planCapacity++;
        }
        try {
            const plan = record.compile(
                owner,
                meshes,
                material,
                inputs,
                capabilities,
                programInfo,
                transformHistory
            );
            if (createdRecord) {
                records[backend] = record;
                this.diagnosticState.activePlanCount++;
            }
            if (createdOwner) {
                this.owners.set(owner, records);
                this.diagnosticState.activeOwnerCount++;
            }
            return plan;
        } catch (error) {
            if (createdRecord) record.detach();
            throw error;
        }
    }

    hasOwner(owner: object): boolean {
        return this.owners.has(owner);
    }

    detach(owner: object): boolean {
        const records = this.owners.get(owner);
        if (records === undefined) return false;
        let detachedPlans = 0;
        if (records.webgl2 !== null) {
            records.webgl2.detach();
            detachedPlans++;
        }
        if (records.webgpu !== null) {
            records.webgpu.detach();
            detachedPlans++;
        }
        this.owners.delete(owner);
        this.diagnosticState.activeOwnerCount--;
        this.diagnosticState.activePlanCount -= detachedPlans;
        return true;
    }

    reset(): void {
        for (const records of this.owners.values()) {
            records.webgl2?.detach();
            records.webgpu?.detach();
        }
        this.owners.clear();
        this.diagnosticState.activeOwnerCount = 0;
        this.diagnosticState.activePlanCount = 0;
    }
}
