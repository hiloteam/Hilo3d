import { MeshletVirtualShadowRuntime } from './MeshletVirtualShadows';
import type {
    VirtualShadowCasterPreparation,
    VirtualShadowMapSettings
} from '../VirtualShadowMaps';
import type MeshletGeometry from '../../../geometry/meshlet/MeshletGeometry';
import type { MeshletGeometryPage } from '../../../geometry/meshlet/MeshletAsset';
import ComputeShader, { type ComputeShaderBinding } from '../../compute/ComputeShader';
import type { StorageBuffer } from '../../StorageBuffer';
import type { RenderPipelineContext, RenderPipelineCreateContext } from '../RenderPipeline';
import { RenderPassParameterPool } from '../RenderPassParameterPool';
import type { RenderGraphBufferHandle, RenderGraphTextureHandle } from '../ScriptableRenderGraph';
import type { ComputeRenderPass } from '../passes';
import {
    ClearBuffersPass,
    ClearBuffersParameters,
    MutableComputeParameters,
    type MutableGPUDrivenParameters
} from './clusteredPassParameters';
import { computePass, FRAME_WGSL, gpuSceneHiZSource } from './clusteredComputePasses';
import {
    CULL_WORKGROUP_SIZE,
    OBJECT_FRUSTUM_CULLING_FLAG,
    OBJECT_HIZ_STABLE_FLAG
} from './clusteredLayout';

interface ResidentPage {
    readonly page: WeakRef<Readonly<MeshletGeometryPage>>;
    readonly offset: number;
    readonly bytes: number;
}

/** CPU residency counters and GPU visibility counters, observed only after valid submissions. */
export interface MeshletGeometryDiagnostics {
    readonly allocatedBytes: number;
    readonly maxResidentBytes: number;
    readonly residentBytes: number;
    readonly residentPageCount: number;
    readonly uploadedBytes: number;
    readonly lastUploadBytes: number;
    readonly deferredPageCount: number;
    readonly visibleMeshletCount: number;
    readonly overflowObjectCount: number;
}

interface CullInputs {
    readonly frame: RenderGraphBufferHandle;
    readonly frameOffset?: number;
    readonly frameLength?: number;
    readonly objects: RenderGraphBufferHandle;
    readonly selected: RenderGraphBufferHandle;
    readonly indirect: RenderGraphBufferHandle;
    readonly visibility: RenderGraphBufferHandle | null;
    readonly previousHiZ: readonly RenderGraphTextureHandle[];
    readonly objectCount: number;
    readonly shadow?: boolean;
}

function outwardFloat(value: number): number {
    const rounded = Math.fround(value);
    if (rounded >= value) return rounded;
    const floats = new Float32Array([rounded]);
    const words = new Uint32Array(floats.buffer);
    words[0] = (words[0] ?? 0) + 1;
    return floats[0] ?? rounded;
}

function pageBytes(page: Readonly<MeshletGeometryPage>): number {
    return 16 + page.meshlets.length * 64 + page.vertices.byteLength + page.indices.byteLength;
}

function packPage(page: Readonly<MeshletGeometryPage>, byteOffset: number): Uint32Array {
    const data = new Uint32Array(pageBytes(page) / 4);
    const floats = new Float32Array(data.buffer);
    const base = byteOffset / 4;
    const vertices = 4 + page.meshlets.length * 16;
    const indices = vertices + page.vertices.length;
    data.set([page.meshlets.length, base + 4, base + vertices, base + indices]);
    floats.set(page.vertices, vertices);
    data.set(page.indices, indices);
    for (let index = 0; index < page.meshlets.length; index++) {
        const cluster = page.meshlets[index];
        if (cluster === undefined) continue;
        const offset = 4 + index * 16;
        floats.set(cluster.bounds, offset);
        floats[offset + 3] = outwardFloat(
            cluster.bounds[3] +
                Math.hypot(
                    cluster.bounds[0] - (floats[offset] ?? 0),
                    cluster.bounds[1] - (floats[offset + 1] ?? 0),
                    cluster.bounds[2] - (floats[offset + 2] ?? 0)
                )
        );
        floats.set(cluster.coneApex, offset + 4);
        floats[offset + 7] = cluster.coneCutoff;
        floats.set(cluster.coneAxis, offset + 8);
        data[offset + 12] = base + indices + cluster.firstIndex;
        data[offset + 13] = cluster.indexCount;
        data[offset + 14] = base + vertices;
    }
    return data;
}

function cullShader(hiZLevels: number, temporal: boolean, shadow: boolean): ComputeShader {
    const bufferCount = temporal ? 10 : 7;
    const { textureDeclarations, textureSample } = gpuSceneHiZSource(hiZLevels, bufferCount);
    const bindings: ComputeShaderBinding[] = [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'selected', group: 0, binding: 2, kind: 'storage-buffer', access: 'read-write' },
        {
            name: 'fallbackIndirect',
            group: 0,
            binding: 3,
            kind: 'storage-buffer',
            access: 'read-write'
        },
        { name: 'geometry', group: 0, binding: 4, kind: 'read-only-storage-buffer' },
        { name: 'arguments', group: 0, binding: 5, kind: 'storage-buffer', access: 'read-write' },
        { name: 'visible', group: 0, binding: 6, kind: 'storage-buffer', access: 'write-discard' }
    ];
    if (temporal)
        bindings.push(
            {
                name: 'visibility',
                group: 0,
                binding: 7,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            { name: 'previousChoices', group: 0, binding: 8, kind: 'read-only-storage-buffer' },
            {
                name: 'currentChoices',
                group: 0,
                binding: 9,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        );
    for (let level = 0; level < hiZLevels; level++)
        bindings.push({
            name: `previousHiZ${String(level)}`,
            group: 0,
            binding: bufferCount + level,
            kind: 'sampled-texture',
            sampleType: 'unfilterable-float'
        });
    return new ComputeShader({
        label: `Meshlet ${shadow ? 'shadow' : 'scene'} group LOD, cluster cull and bounded compact`,
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> objects: array<ObjectRecord>;
@group(0) @binding(2) var<storage, read_write> selected: array<u32>;
@group(0) @binding(3) var<storage, read_write> fallbackIndirect: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> geometry: array<u32>;
@group(0) @binding(5) var<storage, read_write> arguments: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> visible: array<u32>;
${
    temporal
        ? `@group(0) @binding(7) var<storage, read_write> visibility: array<u32>;
@group(0) @binding(8) var<storage, read> previousChoices: array<u32>;
@group(0) @binding(9) var<storage, read_write> currentChoices: array<u32>;`
        : ''
}
${textureDeclarations}
${textureSample}
fn f(index: u32) -> f32 { return bitcast<f32>(geometry[index]); }
fn v3(index: u32) -> vec3<f32> { return vec3<f32>(f(index), f(index+1u), f(index+2u)); }
fn conservativeScale(model: mat4x4<f32>) -> f32 {
    // Induced matrix norm bounds the spectral norm, including shear from parent transforms.
    let a = abs(model[0].xyz); let b = abs(model[1].xyz); let c = abs(model[2].xyz);
    let norm1 = max(a.x+a.y+a.z, max(b.x+b.y+b.z, c.x+c.y+c.z));
    let rows = a+b+c;
    return sqrt(norm1 * max(rows.x, max(rows.y, rows.z)));
}
fn selectedPage(group: u32, model: mat4x4<f32>) -> u32 {
    let base = 16u + group * 8u;
    let lodOffset = geometry[base+4u]; let lodCount = geometry[base+5u];
    let viewCenter = frameData.view * model * vec4<f32>(v3(base), 1.0);
    let scale = conservativeScale(model);
    let radius = f(base+3u)*scale;
    let pixels = max(abs(frameData.projection[0][0])*frameData.viewport.z, abs(frameData.projection[1][1])*frameData.viewport.w) * 0.5;
    let distance = max(-viewCenter.z-radius, frameData.depth.x);
    var chosen = 0u;
    for (var level = 0u; level < lodCount; level++) {
        let entry = lodOffset + level*4u;
        let page = geometry[entry+1u];
        if (page == 0u) { continue; }
        if (chosen == 0u) { chosen = page; }
        if (f(5u) == 0.0) { return chosen; }
        ${shadow ? 'return chosen;' : 'if (f(entry)*scale*pixels/max(distance, 0.00001) <= f(5u)) { chosen = page; }'}
    }
    return chosen;
}
fn clusterVisible(cluster: u32, object: ObjectRecord, model: mat4x4<f32>) -> bool {
    let center = (model*vec4<f32>(v3(cluster),1.0)).xyz;
    let radius = f(cluster+3u)*conservativeScale(model);
    if ((object.metadata.z & ${String(OBJECT_FRUSTUM_CULLING_FLAG)}u) != 0u) {
        let m = transpose(frameData.currentViewProjection);
        let planes = array<vec4<f32>,6>(m[3]+m[0], m[3]-m[0], m[3]+m[1], m[3]-m[1], m[3]+m[2], m[3]-m[2]);
        for (var plane=0u; plane<6u; plane++) {
            let p = planes[plane];
            if (dot(p, vec4<f32>(center,1.0)) < -radius*length(p.xyz)) { return false; }
        }
    }
    ${
        shadow
            ? ''
            : `if (geometry[6u] != 0u && f(cluster+7u)<1.0) {
        let a=model[0].xyz; let b=model[1].xyz; let c=model[2].xyz;
        let scale2=dot(a,a); let epsilon=max(scale2,0.00001)*0.00001;
        let uniformScale=abs(dot(b,b)-scale2)<epsilon && abs(dot(c,c)-scale2)<epsilon && abs(dot(a,b))<epsilon && abs(dot(a,c))<epsilon && abs(dot(b,c))<epsilon && dot(cross(a,b),c)>0.0;
        if (uniformScale) {
            let viewModel=frameData.view*model;
            let apex=(viewModel*vec4<f32>(v3(cluster+4u),1.0)).xyz;
            let axis=normalize((viewModel*vec4<f32>(v3(cluster+8u),0.0)).xyz);
            if (length(apex)>0.00001 && dot(normalize(apex),axis)>=f(cluster+7u)) { return false; }
        }
    }
    if (geometry[7u] != 0u && (object.metadata.z & ${String(OBJECT_HIZ_STABLE_FLAG)}u)!=0u) {
        let previousModel=objectPreviousModel(object);
        let previousCenter=(previousModel*vec4<f32>(v3(cluster),1.0)).xyz;
        if (occludedByPreviousHiZ(frameData,previousCenter,f(cluster+3u)*conservativeScale(previousModel))) { return false; }
    }`
    }
    return true;
}
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x>=frameData.counts.x || id.x>=frameData.budgets.x) { return; }
    let object=objects[id.x];
    if (object.metadata.x!=geometry[0u] || selected[id.x]==0xffffffffu) { return; }
    let model=objectModel(object);
    var count=0u;
    var historyValid=geometry[7u]!=0u;
    for (var group=0u; group<geometry[2u]; group++) {
        let page=selectedPage(group,model);
        if (page==0u) { return; }
        ${temporal ? 'let choice=id.x*geometry[2u]+group; historyValid=historyValid && previousChoices[choice]==page; currentChoices[choice]=page;' : ''}
        let clusters=geometry[page]; let first=geometry[page+1u];
        for (var index=0u; index<clusters; index++) { if (clusterVisible(first+index*16u,object,model)) { count++; } }
    }
    // Reserve all selected groups atomically. Overflow keeps the complete ordinary object.
    var start=atomicLoad(&arguments[1]);
    loop {
        if (count>geometry[4u]-min(start,geometry[4u])) { _=atomicAdd(&arguments[5],1u); return; }
        let reservation=atomicCompareExchangeWeak(&arguments[1],start,start+count);
        if (reservation.exchanged) { break; }
        start=reservation.old_value;
    }
    _=atomicSub(&fallbackIndirect[selected[id.x]*5u+1u],1u);
    selected[id.x]=0xffffffffu;
    ${temporal ? 'visibility[id.x]=2u;' : ''}
    var output=start;
    for (var group=0u; group<geometry[2u]; group++) {
        let page=selectedPage(group,model);
        let clusters=geometry[page]; let first=geometry[page+1u];
        for (var index=0u; index<clusters; index++) {
            let cluster=first+index*16u;
            if (clusterVisible(cluster,object,model)) {
                visible[output*3u]=id.x; visible[output*3u+1u]=cluster; visible[output*3u+2u]=select(0u,1u,historyValid); output++;
            }
        }
    }
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings
    });
}

/** Renderer-local fixed arena and submission transaction for one material bucket. */
export class MeshletRuntime {
    readonly virtualShadows: MeshletVirtualShadowRuntime | null;
    readonly arena: StorageBuffer;
    readonly visible: StorageBuffer;
    readonly indirect: StorageBuffer;
    readonly zeroOffset: StorageBuffer;
    readonly index: StorageBuffer;
    readonly #metadata: Uint32Array;
    readonly #lodOffsets = new Map<number, number>();
    readonly #coarseOffsets = new Map<number, number>();
    readonly #fineStart: number;
    readonly #committed = new Map<number, ResidentPage>();
    #pending: Map<number, ResidentPage> | null = null;
    readonly #clear = new ClearBuffersPass();
    readonly #clearPool = new RenderPassParameterPool(
        () => new ClearBuffersParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #cull: ComputeRenderPass;
    readonly #hizCull: ComputeRenderPass;
    readonly #shadowCull: ComputeRenderPass;
    readonly #cullPool: RenderPassParameterPool<MutableComputeParameters>;
    readonly #hizPool: RenderPassParameterPool<MutableComputeParameters>;
    readonly #shadowPool = new RenderPassParameterPool(() => new MutableComputeParameters(7, 0));
    readonly #choices: readonly [StorageBuffer, StorageBuffer] | null;
    #choiceIndex: 0 | 1 = 0;
    #lastFrame = -1;
    #lastUploadBytes = 0;
    #pendingUploadBytes = 0;
    #uploadedBytes = 0;
    #deferredPageCount = 0;
    #pendingDeferred = 0;
    #revision = -1;
    #pendingRevision = -1;
    #retryAdmission = false;
    #pendingRetryAdmission = false;
    #destroyed = false;
    readonly #owned: readonly StorageBuffer[];

    constructor(
        readonly geometry: MeshletGeometry,
        context: RenderPipelineCreateContext,
        logicalIndex: number,
        fallbackIndex: number,
        maxObjects: number,
        hiZLevels: number,
        temporal: boolean,
        cone: boolean,
        virtualShadowSettings: Readonly<VirtualShadowMapSettings> | null = null
    ) {
        const metadataWords =
            16 + geometry.manifest.groups.length * 8 + geometry.manifest.pages.length * 4;
        this.#metadata = new Uint32Array(metadataWords);
        const floats = new Float32Array(this.#metadata.buffer);
        this.#metadata.set([
            logicalIndex,
            fallbackIndex,
            geometry.manifest.groups.length,
            metadataWords,
            geometry.options.maxVisibleMeshlets
        ]);
        floats[5] = geometry.options.maximumProjectedError;
        this.#metadata[6] = cone ? 1 : 0;
        let lodOffset = 16 + geometry.manifest.groups.length * 8;
        for (let group = 0; group < geometry.manifest.groups.length; group++) {
            const value = geometry.manifest.groups[group];
            if (value === undefined) continue;
            const offset = 16 + group * 8;
            floats.set(value.bounds, offset);
            floats[offset + 3] = outwardFloat(
                value.bounds[3] +
                    Math.hypot(
                        value.bounds[0] - (floats[offset] ?? 0),
                        value.bounds[1] - (floats[offset + 1] ?? 0),
                        value.bounds[2] - (floats[offset + 2] ?? 0)
                    )
            );
            this.#metadata[offset + 4] = lodOffset;
            this.#metadata[offset + 5] = value.lods.length;
            for (const lod of value.lods) {
                floats[lodOffset] = outwardFloat(lod.error);
                this.#lodOffsets.set(lod.pageId, lodOffset + 1);
                lodOffset += 4;
            }
        }
        let coarseEnd = this.#metadata.byteLength;
        for (const group of geometry.manifest.groups) {
            const coarse = group.lods.at(-1);
            const page = geometry.manifest.pages.find(candidate => candidate.id === coarse?.pageId);
            if (page === undefined) throw new Error('Meshlet group has no coarsest page');
            this.#coarseOffsets.set(page.id, coarseEnd);
            coarseEnd += 16 + page.meshletCount * 64 + page.vertexCount * 32 + page.indexCount * 4;
        }
        if (coarseEnd > geometry.options.maxResidentBytes)
            throw new RangeError('Meshlet arena must fit every coarsest group page and page table');
        this.#fineStart = coarseEnd;
        for (const page of geometry.manifest.pages) {
            const bytes = 16 + page.meshletCount * 64 + page.vertexCount * 32 + page.indexCount * 4;
            if (bytes + this.#metadata.byteLength > geometry.options.maxUploadBytesPerFrame)
                throw new RangeError(
                    'Meshlet frame upload budget must fit each complete page and page table'
                );
        }
        if (
            this.#metadata.byteLength >= geometry.options.maxResidentBytes ||
            this.#metadata.byteLength > geometry.options.maxUploadBytesPerFrame
        )
            throw new RangeError(
                'Meshlet page-table metadata exceeds its residency or frame upload budget'
            );
        const create = (
            label: string,
            byteLength: number,
            usage: Parameters<RenderPipelineCreateContext['createStorageBuffer']>[0]['usage'],
            initialData?: Uint32Array
        ): StorageBuffer =>
            context.createStorageBuffer({
                label,
                byteLength,
                usage,
                recovery: initialData === undefined ? 'reinitialize' : 'cpu-shadow',
                ...(initialData === undefined ? {} : { initialData })
            });
        this.arena = create(
            'Meshlet fixed geometry arena',
            geometry.options.maxResidentBytes,
            ['storage', 'copy-destination'],
            this.#metadata
        );
        this.visible = create(
            'Meshlet compact object-cluster table',
            geometry.options.maxVisibleMeshlets * 12,
            ['storage']
        );
        this.indirect = create(
            'Meshlet bounded indirect arguments',
            24,
            ['storage', 'indirect', 'copy-destination', 'copy-source'],
            new Uint32Array([192, 0, 0, 0, 0, 0])
        );
        this.zeroOffset = create('Meshlet visible offset', 4, ['storage'], new Uint32Array(1));
        this.index = create(
            'Meshlet fixed triangle template',
            192 * 4,
            ['storage', 'index'],
            Uint32Array.from({ length: 192 }, (_unused, index) => index)
        );
        const choiceBytes = Math.max(4, maxObjects * geometry.manifest.groups.length * 4);
        this.#choices = temporal
            ? [
                  create(
                      'Meshlet group history A',
                      choiceBytes,
                      ['storage'],
                      new Uint32Array(choiceBytes / 4)
                  ),
                  create(
                      'Meshlet group history B',
                      choiceBytes,
                      ['storage'],
                      new Uint32Array(choiceBytes / 4)
                  )
              ]
            : null;
        this.virtualShadows =
            virtualShadowSettings === null
                ? null
                : new MeshletVirtualShadowRuntime(
                      virtualShadowSettings,
                      context,
                      this.arena,
                      this.index,
                      geometry.options.maxVisibleMeshlets
                  );
        this.#owned = [
            this.arena,
            this.visible,
            this.indirect,
            this.zeroOffset,
            this.index,
            ...(this.#choices ?? []),
            ...(this.virtualShadows?.buffers ?? [])
        ];
        this.#cull = computePass(cullShader(0, temporal, false));
        this.#hizCull =
            hiZLevels === 0 ? this.#cull : computePass(cullShader(hiZLevels, temporal, false));
        this.#shadowCull = computePass(cullShader(0, false, true));
        this.#cullPool = new RenderPassParameterPool(
            () => new MutableComputeParameters(temporal ? 10 : 7, 0)
        );
        this.#hizPool = new RenderPassParameterPool(
            () => new MutableComputeParameters(temporal ? 10 : 7, hiZLevels)
        );
    }

    stage(context: RenderPipelineContext): boolean {
        if (this.#lastFrame === context.frameIndex) return this.#pendingRevision !== this.#revision;
        this.#lastFrame = context.frameIndex;
        if (
            this.geometry.revision === this.#revision &&
            !this.#retryAdmission &&
            this.#metadata[7] === 1
        ) {
            this.#pending = null;
            this.#pendingUploadBytes = 0;
            this.#pendingRevision = this.#revision;
            this.#pendingDeferred = this.#deferredPageCount;
            this.#pendingRetryAdmission = false;
            return false;
        }
        this.#pendingRetryAdmission = false;
        const pending = new Map(this.#committed);
        let changed = false;
        for (const [id, resident] of pending)
            if (this.geometry.getPageData(id) !== resident.page.deref()) {
                pending.delete(id);
                changed = true;
            }
        let uploaded = 0;
        let deferred = 0;
        const priority: number[] = [];
        for (const group of this.geometry.manifest.groups) {
            const coarse = group.lods.at(-1);
            if (coarse !== undefined) priority.push(coarse.pageId);
        }
        for (const page of this.geometry.manifest.pages)
            if (!priority.includes(page.id)) priority.push(page.id);
        for (const id of priority) {
            if (pending.has(id)) continue;
            const page = this.geometry.getPageData(id);
            if (page === null) continue;
            const bytes = pageBytes(page);
            if (
                uploaded + bytes + this.#metadata.byteLength >
                this.geometry.options.maxUploadBytesPerFrame
            ) {
                deferred++;
                this.#pendingRetryAdmission = true;
                continue;
            }
            let offset = this.#coarseOffsets.get(id) ?? this.#fineStart;
            if (!this.#coarseOffsets.has(id))
                for (const resident of [...pending.values()].sort((a, b) => a.offset - b.offset)) {
                    if (resident.offset < this.#fineStart) continue;
                    if (offset + bytes <= resident.offset) break;
                    offset = Math.max(offset, resident.offset + resident.bytes);
                }
            if (offset + bytes > this.arena.byteLength) {
                deferred++;
                continue;
            }
            context.writeStorageBuffer(this.arena, offset, packPage(page, offset));
            pending.set(id, { page: new WeakRef(page), offset, bytes });
            uploaded += bytes;
            changed = true;
        }
        const revisionChanged = this.geometry.revision !== this.#revision;
        if (changed || revisionChanged || this.#metadata[7] === 0) {
            this.#metadata[7] = changed || revisionChanged ? 0 : 1;
            for (const [id, offset] of this.#lodOffsets)
                this.#metadata[offset] = (pending.get(id)?.offset ?? 0) / 4;
            context.writeStorageBuffer(this.arena, 0, this.#metadata);
            uploaded += this.#metadata.byteLength;
        }
        this.#pending = changed ? pending : null;
        this.#pendingUploadBytes = uploaded;
        this.#pendingDeferred = deferred;
        this.#pendingRevision = this.geometry.revision;
        return changed || revisionChanged;
    }

    /** CPU recipe for the active frame's staged residency; callers must not mutate its arrays. */
    getResidentPage(pageId: number): Readonly<MeshletGeometryPage> | null {
        return (this.#pending ?? this.#committed).get(pageId)?.page.deref() ?? null;
    }

    recordVirtualShadowCull(
        context: RenderPipelineContext,
        resources: Readonly<VirtualShadowCasterPreparation>
    ): void {
        if (this.virtualShadows === null)
            throw new Error('Meshlet virtual-shadow outputs are unavailable');
        this.virtualShadows.record(context, resources);
    }

    configureVirtualShadowDraw(
        context: RenderPipelineContext,
        parameters: MutableGPUDrivenParameters,
        physicalPageIndex: number
    ): void {
        if (this.virtualShadows === null)
            throw new Error('Meshlet virtual-shadow outputs are unavailable');
        this.virtualShadows.configureDraw(context, parameters, physicalPageIndex);
    }

    recordCull(context: RenderPipelineContext, input: Readonly<CullInputs>): void {
        const indirect = context.graph.importStorageBuffer(this.indirect);
        const clear = context.acquirePassParameters(this.#clearPool);
        clear.add(indirect, 4, 4);
        clear.add(indirect, 20, 4);
        context.graph.addPass(this.#clear, clear);
        const shadow = input.shadow === true;
        const hiz = !shadow && input.previousHiZ.length > 0;
        const parameters = context.acquirePassParameters(
            shadow ? this.#shadowPool : hiz ? this.#hizPool : this.#cullPool
        );
        if (input.frameOffset !== undefined && input.frameLength !== undefined)
            parameters.setBufferRange(0, input.frame, input.frameOffset, input.frameLength);
        else parameters.setBuffer(0, input.frame);
        parameters.setBuffer(1, input.objects);
        parameters.setBuffer(2, input.selected);
        parameters.setBuffer(3, input.indirect);
        parameters.setBuffer(4, context.graph.importStorageBuffer(this.arena));
        parameters.setBuffer(5, indirect);
        parameters.setBuffer(6, context.graph.importStorageBuffer(this.visible));
        if (!shadow && this.#choices !== null) {
            if (input.visibility === null)
                throw new Error('Meshlet temporal visibility is missing');
            parameters.setBuffer(7, input.visibility);
            parameters.setBuffer(
                8,
                context.graph.importStorageBuffer(this.#choices[this.#choiceIndex])
            );
            parameters.setBuffer(
                9,
                context.graph.importStorageBuffer(this.#choices[this.#choiceIndex === 0 ? 1 : 0])
            );
        }
        if (hiz)
            for (let level = 0; level < input.previousHiZ.length; level++) {
                const texture = input.previousHiZ[level];
                if (texture !== undefined) parameters.setTexture(level, texture);
            }
        parameters.setDispatch(Math.max(1, Math.ceil(input.objectCount / CULL_WORKGROUP_SIZE)));
        context.graph.addPass(
            shadow ? this.#shadowCull : hiz ? this.#hizCull : this.#cull,
            parameters
        );
    }

    configureDraw(
        context: RenderPipelineContext,
        parameters: MutableGPUDrivenParameters,
        offsetBinding: number
    ): void {
        parameters.setBuffer(2, context.graph.importStorageBuffer(this.visible));
        parameters.setBuffer(offsetBinding, context.graph.importStorageBuffer(this.zeroOffset));
        const binding = parameters.buffers.length - 1;
        parameters.setBuffer(binding, context.graph.importStorageBuffer(this.arena));
        parameters.indexBuffer.buffer = context.graph.importStorageBuffer(this.index);
        parameters.draw.buffer = context.graph.importStorageBuffer(this.indirect);
        parameters.draw.byteOffset = 0;
    }

    frameSubmitted(): void {
        if (this.#pending !== null) {
            this.#committed.clear();
            for (const [id, page] of this.#pending) this.#committed.set(id, page);
            this.#pending = null;
        }
        this.#revision = this.#pendingRevision;
        this.#lastUploadBytes = this.#pendingUploadBytes;
        this.#uploadedBytes += this.#pendingUploadBytes;
        this.#deferredPageCount = this.#pendingDeferred;
        this.#retryAdmission = this.#pendingRetryAdmission;
        if (this.#choices !== null) this.#choiceIndex = this.#choiceIndex === 0 ? 1 : 0;
    }
    frameDiscarded(): void {
        this.#lastFrame = -1;
        this.#pending = null;
        this.#pendingRevision = -1;
        this.#metadata[7] = 0;
    }
    async readDiagnostics(): Promise<Readonly<MeshletGeometryDiagnostics>> {
        const data = await this.indirect.read();
        const values = new Uint32Array(
            data.data.buffer,
            data.data.byteOffset,
            data.data.byteLength / 4
        );
        return {
            allocatedBytes: this.#owned.reduce((sum, buffer) => sum + buffer.byteLength, 0),
            maxResidentBytes: this.arena.byteLength,
            residentBytes: [...this.#committed.values()].reduce((sum, page) => sum + page.bytes, 0),
            residentPageCount: this.#committed.size,
            uploadedBytes: this.#uploadedBytes,
            lastUploadBytes: this.#lastUploadBytes,
            deferredPageCount: this.#deferredPageCount,
            visibleMeshletCount: values[1] ?? 0,
            overflowObjectCount: values[5] ?? 0
        };
    }
    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#pending = null;
        this.#committed.clear();
        const failures: unknown[] = [];
        for (const buffer of this.#owned) {
            try {
                buffer.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length !== 0) {
            throw new AggregateError(failures, 'Meshlet resource destruction failed', {
                cause: failures[0]
            });
        }
    }
}
