import ComputeShader from '../../render/compute/ComputeShader';
import StorageGraphicsShader from '../../render/compute/StorageGraphicsShader';
import type GeometryData from '../../geometry/GeometryData';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import type {
    ParticleMeshRendererDefinition,
    ParticleRibbonRendererDefinition
} from '../ParticleTypes';

const WORKGROUP_SIZE = 64;
const PARTICLE_VIEW_BLOCK = `layout(std140) uniform ParticleViewBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_modelMatrix;
    vec4 u_cameraPosition;
    vec4 u_viewport;
    vec4 u_particleAmbient;
    vec4 u_particleDirectionalColor[4];
    vec4 u_particleDirectionalDirection[4];
};`;

function align(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function f32(value: number): string {
    const rounded = Math.fround(value);
    return Number.isInteger(rounded) ? `${String(rounded)}.0` : String(rounded);
}

function attributeOffset(plan: Readonly<ParticleCompiledEmitterPlan>, name: string): number {
    const attribute = plan.attributes.find(candidate => candidate.name === name);
    if (!attribute) throw new Error(`Particle advanced GPU plan requires ${name}`);
    return attribute.byteOffset / 4;
}

function component(source: GeometryData, index: number, lane: number): number {
    const stride = source.strideSize === 0 ? source.size : source.strideSize;
    return source.data[index * stride + source.offsetSize + lane] ?? 0;
}

function meshVertexData(
    renderer: ParticleMeshRendererDefinition,
    assetIndex: number
): Float32Array {
    const asset = renderer.meshes[assetIndex];
    if (!asset) throw new RangeError('Particle mesh asset is unavailable');
    const geometry = asset.geometry;
    const vertices = geometry.vertices;
    const normals = geometry.normals;
    if (!vertices || !normals) throw new TypeError('Particle mesh geometry is incomplete');
    const indices = geometry.indices;
    const vertexCount = indices?.count ?? vertices.count;
    const result = new Float32Array(vertexCount * 12);
    for (let output = 0; output < vertexCount; output += 1) {
        const sourceIndex = indices ? Math.trunc(component(indices, output, 0)) : output;
        const target = output * 12;
        result[target] = component(vertices, sourceIndex, 0);
        result[target + 1] = component(vertices, sourceIndex, 1);
        result[target + 2] = component(vertices, sourceIndex, 2);
        result[target + 3] = 1;
        result[target + 4] = component(normals, sourceIndex, 0);
        result[target + 5] = component(normals, sourceIndex, 1);
        result[target + 6] = component(normals, sourceIndex, 2);
        result[target + 7] = 0;
        if (geometry.uvs) {
            result[target + 8] = component(geometry.uvs, sourceIndex, 0);
            result[target + 9] = component(geometry.uvs, sourceIndex, 1);
        }
    }
    return result;
}

function lightingSource(lit: boolean): string {
    if (!lit) return '';
    return `vec3 irradiance = u_particleAmbient.rgb;
    for (int lightIndex = 0; lightIndex < 4; lightIndex++) {
        irradiance += u_particleDirectionalColor[lightIndex].rgb * max(dot(normalize(particleNormal), normalize(-u_particleDirectionalDirection[lightIndex].xyz + vec3(0.000001))), 0.0);
    }
    color.rgb *= irradiance;`;
}

function meshShader(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    renderer: ParticleMeshRendererDefinition,
    assetIndex: number,
    rendererDataByteLength: number,
    bucketIndexByteLength: number,
    geometryByteLength: number
): StorageGraphicsShader {
    const asset = renderer.meshes[assetIndex];
    if (!asset) throw new RangeError('Particle mesh asset is unavailable');
    const texture = asset.texture ?? renderer.texture;
    const textured = texture !== undefined && texture !== null;
    const masked = renderer.coverage === 'masked';
    const transparent = (renderer.coverage ?? 'transparent') === 'transparent';
    const assetVertexCount = meshVertexData(renderer, assetIndex).length / 12;
    const premultiply =
        transparent && renderer.blend !== undefined && renderer.blend !== 'alpha'
            ? 'color.rgb *= color.a;'
            : '';
    return new StorageGraphicsShader({
        label: `${plan.definition.name}:particle-storage-mesh:${String(assetIndex)}`,
        bindings: [
            {
                name: 'ParticleViewBlock',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: 368
            },
            {
                name: 'particleRenderData',
                group: 3,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: rendererDataByteLength
            },
            {
                name: 'particleBucketIndices',
                group: 3,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: bucketIndexByteLength
            },
            {
                name: 'particleMeshGeometry',
                group: 3,
                binding: 2,
                kind: 'read-only-storage-buffer',
                minBindingSize: geometryByteLength
            },
            ...(textured
                ? [
                      {
                          name: 'u_particleTexture',
                          group: 3,
                          binding: 3,
                          kind: 'sampled-texture' as const,
                          sampleType: 'float' as const
                      },
                      {
                          name: 'u_particleTexture',
                          group: 3,
                          binding: 4,
                          kind: 'sampler' as const
                      }
                  ]
                : [])
        ],
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
${PARTICLE_VIEW_BLOCK}
layout(std430) readonly buffer ParticleRenderData { vec4 values[]; } particleRenderData;
layout(std430) readonly buffer ParticleBucketIndices { uint values[]; } particleBucketIndices;
layout(std430) readonly buffer ParticleMeshGeometry { vec4 values[]; } particleMeshGeometry;
out vec2 particleUV;
out vec4 particleColor;
out vec3 particleNormal;
void main() {
    int localVertex = int(mod(float(gl_VertexID), ${String(assetVertexCount)}.0));
    int meshInstance = int(floor(float(gl_VertexID) / ${String(assetVertexCount)}.0));
    uint denseIndex = particleBucketIndices.values[${String(assetIndex * plan.definition.capacity)} + meshInstance];
    vec4 positionSize = particleRenderData.values[denseIndex * 4u];
    particleColor = particleRenderData.values[denseIndex * 4u + 1u];
    vec4 rotationFrame = particleRenderData.values[denseIndex * 4u + 2u];
    vec3 velocity = particleRenderData.values[denseIndex * 4u + 3u].xyz;
    vec3 sourcePosition = particleMeshGeometry.values[localVertex * 3].xyz;
    vec3 sourceNormal = particleMeshGeometry.values[localVertex * 3 + 1].xyz;
    particleUV = particleMeshGeometry.values[localVertex * 3 + 2].xy;
    float sine = sin(rotationFrame.x); float cosine = cos(rotationFrame.x);
    mat3 basis = mat3(cosine, sine, 0.0, -sine, cosine, 0.0, 0.0, 0.0, 1.0);
    ${
        renderer.orientation === 'velocity'
            ? `vec3 forward = length(velocity) > 0.000001 ? normalize(velocity) : vec3(0.0, 1.0, 0.0);
    vec3 reference = abs(forward.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(reference, forward));
    basis = mat3(side, forward, cross(forward, side)) * basis;`
            : ''
    }
    vec3 localPosition = positionSize.xyz + basis * sourcePosition * positionSize.w;
    vec4 worldPosition = u_modelMatrix * vec4(localPosition, 1.0);
    gl_Position = u_projectionMatrix * u_viewMatrix * worldPosition;
    particleNormal = normalize(mat3(u_modelMatrix) * basis * sourceNormal);
}`,
        fragmentSource: `#version 310 es
precision highp float;
precision highp int;
${PARTICLE_VIEW_BLOCK}
in vec2 particleUV;
in vec4 particleColor;
in vec3 particleNormal;
${textured ? 'uniform sampler2D u_particleTexture;' : ''}
layout(location = 0) out vec4 fragmentColor;
void main() {
    vec4 color = ${textured ? 'texture(u_particleTexture, particleUV)' : 'vec4(1.0)'} * particleColor;
    if (color.a <= ${f32(masked ? (renderer.alphaCutoff ?? 0.5) : 0.00001)}) discard;
    ${lightingSource(renderer.lighting === 'lambert')}
    ${premultiply}
    fragmentColor = color;
}`
    });
}

/** One expanded triangle-list asset and its fixed storage-raster shader. */
export interface ParticleGPUMeshAssetPlan {
    readonly vertexData: Float32Array;
    readonly vertexCount: number;
    readonly texture: ParticleMeshRendererDefinition['texture'];
    readonly shader: StorageGraphicsShader;
}

/** GPU mesh bucket, scatter, indirect, and asset plans for one renderer definition. */
export interface ParticleGPUMeshRendererPlan {
    readonly kind: 'mesh';
    readonly definition: ParticleMeshRendererDefinition;
    readonly bucketIndexByteLength: number;
    readonly bucketCounterByteLength: number;
    readonly indirectByteLength: number;
    readonly reset: ComputeShader;
    readonly build: ComputeShader;
    readonly finalize: ComputeShader;
    readonly assets: readonly Readonly<ParticleGPUMeshAssetPlan>[];
}

/** Compile one GPU multi-mesh renderer without native handles. */
export function compileParticleGPUMeshRenderer(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    renderer: ParticleMeshRendererDefinition,
    rendererDataByteLength: number
): Readonly<ParticleGPUMeshRendererPlan> {
    const capacity = plan.definition.capacity;
    const meshCount = renderer.meshes.length;
    const stateByteLength = align(plan.attributeByteLength, 16);
    const aliveByteLength = align(capacity * 4, 16);
    const counterByteLength = 32;
    const bucketIndexByteLength = align(capacity * meshCount * 4, 16);
    const bucketCounterByteLength = align(meshCount * 4, 16);
    const indirectByteLength = align(meshCount * 16, 16);
    const meshIndex = attributeOffset(plan, 'mesh-index');
    const reset = new ComputeShader({
        label: `${plan.definition.name}:particle-mesh-bucket-reset`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `
@group(0) @binding(0) var<storage, read_write> bucketCounters: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> indirect: array<u32>;
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    if (invocation.x >= ${String(meshCount)}u) { return; }
    atomicStore(&bucketCounters[invocation.x], 0u);
    indirect[invocation.x * 4u] = 0u;
    indirect[invocation.x * 4u + 1u] = 0u;
    indirect[invocation.x * 4u + 2u] = 0u;
    indirect[invocation.x * 4u + 3u] = 0u;
}`,
        bindings: [
            {
                name: 'bucketCounters',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: bucketCounterByteLength
            },
            {
                name: 'indirect',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: indirectByteLength
            }
        ]
    });
    const build = new ComputeShader({
        label: `${plan.definition.name}:particle-mesh-bucket-build`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `
struct ParticleCounters { aliveCount: atomic<u32>, outputAliveCount: atomic<u32>, deadCount: atomic<u32>, nextIndex: atomic<u32>, droppedSpawnCount: atomic<u32>, };
@group(0) @binding(0) var<storage, read> state: array<u32>;
@group(0) @binding(1) var<storage, read> aliveIndices: array<u32>;
@group(0) @binding(2) var<storage, read> counters: ParticleCounters;
@group(0) @binding(3) var<storage, read_write> bucketIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> bucketCounters: array<atomic<u32>>;
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    let aliveCount = atomicLoad(&counters.aliveCount);
    if (invocation.x >= aliveCount) { return; }
    let particleIndex = aliveIndices[invocation.x];
    let bucket = state[${String(meshIndex)}u + particleIndex] % ${String(meshCount)}u;
    let slot = atomicAdd(&bucketCounters[bucket], 1u);
    bucketIndices[bucket * ${String(capacity)}u + slot] = invocation.x;
}`,
        bindings: [
            {
                name: 'state',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: stateByteLength
            },
            {
                name: 'aliveIndices',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: aliveByteLength
            },
            {
                name: 'counters',
                group: 0,
                binding: 2,
                kind: 'read-only-storage-buffer',
                minBindingSize: counterByteLength
            },
            {
                name: 'bucketIndices',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: bucketIndexByteLength
            },
            {
                name: 'bucketCounters',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: bucketCounterByteLength
            }
        ]
    });
    const vertexCounts = renderer.meshes.map((_asset, assetIndex) => {
        const data = meshVertexData(renderer, assetIndex);
        return data.length / 12;
    });
    const finalize = new ComputeShader({
        label: `${plan.definition.name}:particle-mesh-indirect-finalize`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `
@group(0) @binding(0) var<storage, read> bucketCounters: array<u32>;
@group(0) @binding(1) var<storage, read_write> indirect: array<u32>;
fn vertexCount(index: u32) -> u32 {
    var counts = array<u32, ${String(meshCount)}>(${vertexCounts.map(value => `${String(value)}u`).join(', ')});
    return counts[index];
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    if (invocation.x >= ${String(meshCount)}u) { return; }
    indirect[invocation.x * 4u] = vertexCount(invocation.x) * bucketCounters[invocation.x];
    indirect[invocation.x * 4u + 1u] = 1u;
}`,
        bindings: [
            {
                name: 'bucketCounters',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: bucketCounterByteLength
            },
            {
                name: 'indirect',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: indirectByteLength
            }
        ]
    });
    const assets = renderer.meshes.map((asset, assetIndex) => {
        const vertexData = meshVertexData(renderer, assetIndex);
        const geometryByteLength = align(vertexData.byteLength, 16);
        return Object.freeze({
            vertexData,
            vertexCount: vertexData.length / 12,
            texture: asset.texture ?? renderer.texture,
            shader: meshShader(
                plan,
                renderer,
                assetIndex,
                rendererDataByteLength,
                bucketIndexByteLength,
                geometryByteLength
            )
        });
    });
    return Object.freeze({
        kind: 'mesh',
        definition: renderer,
        bucketIndexByteLength,
        bucketCounterByteLength,
        indirectByteLength,
        reset,
        build,
        finalize,
        assets: Object.freeze(assets)
    });
}

/** GPU topology sort, segment compact, and indirect plan for one ribbon/trail renderer. */
export interface ParticleGPURibbonRendererPlan {
    readonly kind: 'ribbon';
    readonly definition: ParticleRibbonRendererDefinition;
    readonly topologyCapacity: number;
    readonly topologyByteLength: number;
    readonly segmentByteLength: number;
    readonly counterByteLength: number;
    readonly indirectByteLength: number;
    readonly reset: ComputeShader;
    readonly initializeTopology: ComputeShader;
    readonly sortTopology: ComputeShader;
    readonly buildSegments: ComputeShader;
    readonly finalize: ComputeShader;
    readonly shader: StorageGraphicsShader;
}

function ribbonShader(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    renderer: ParticleRibbonRendererDefinition,
    segmentByteLength: number
): StorageGraphicsShader {
    const textured = renderer.texture !== undefined && renderer.texture !== null;
    const soft = renderer.softParticle;
    const depthBinding = textured ? 3 : 1;
    const premultiply =
        renderer.blend === 'premultiplied-alpha' || renderer.blend === 'additive'
            ? 'color.rgb *= color.a;'
            : '';
    return new StorageGraphicsShader({
        label: `${plan.definition.name}:particle-storage-${renderer.type}`,
        bindings: [
            {
                name: 'ParticleViewBlock',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: 368
            },
            {
                name: 'particleSegments',
                group: 3,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: segmentByteLength
            },
            ...(textured
                ? [
                      {
                          name: 'u_particleTexture',
                          group: 3,
                          binding: 1,
                          kind: 'sampled-texture' as const,
                          sampleType: 'float' as const
                      },
                      { name: 'u_particleTexture', group: 3, binding: 2, kind: 'sampler' as const }
                  ]
                : []),
            ...(soft === undefined
                ? []
                : [
                      {
                          name: 'u_particleSceneDepth',
                          group: 3,
                          binding: depthBinding,
                          kind: 'sampled-texture' as const,
                          sampleType: 'depth' as const
                      },
                      {
                          name: 'u_particleSceneDepth',
                          group: 3,
                          binding: depthBinding + 1,
                          kind: 'sampler' as const
                      }
                  ])
        ],
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
${PARTICLE_VIEW_BLOCK}
layout(std430) readonly buffer ParticleSegments { vec4 values[]; } particleSegments;
out vec2 particleUV;
out vec4 particleColor;
out vec3 particleNormal;
${soft === undefined ? '' : 'out float particleDepthMode;'}
void main() {
    int localIndex = int(mod(float(gl_VertexID), 6.0));
    int segmentIndex = int(floor(float(gl_VertexID) / 6.0));
    vec2 corner = vec2((localIndex == 1 || localIndex == 2 || localIndex == 4) ? 0.5 : -0.5, (localIndex == 2 || localIndex == 4 || localIndex == 5) ? 1.0 : 0.0);
    vec4 startWidth = particleSegments.values[segmentIndex * 4];
    vec4 endWidth = particleSegments.values[segmentIndex * 4 + 1];
    vec4 startColor = particleSegments.values[segmentIndex * 4 + 2];
    vec4 endColor = particleSegments.values[segmentIndex * 4 + 3];
    vec4 startWorld = u_modelMatrix * vec4(startWidth.xyz, 1.0);
    vec4 endWorld = u_modelMatrix * vec4(endWidth.xyz, 1.0);
    vec4 startView = u_viewMatrix * startWorld;
    vec4 endView = u_viewMatrix * endWorld;
    vec3 segment = endView.xyz - startView.xyz;
    vec3 side = ${
        renderer.facing === 'world-up'
            ? 'normalize((u_viewMatrix * vec4(normalize(cross(normalize(endWorld.xyz - startWorld.xyz), vec3(0.0, 1.0, 0.0))), 0.0)).xyz + vec3(0.000001, 0.0, 0.0))'
            : 'normalize(cross(normalize(segment + vec3(0.000001)), vec3(0.0, 0.0, 1.0)) + vec3(0.000001, 0.0, 0.0))'
    };
    float width = mix(startWidth.w, endWidth.w, corner.y) * ${f32(renderer.widthScale ?? 1)};
    vec3 viewPosition = mix(startView.xyz, endView.xyz, corner.y) + side * corner.x * width;
    gl_Position = u_projectionMatrix * vec4(viewPosition, 1.0);
    float repeatV = ${renderer.uvMode === 'repeat' ? `length(endWorld.xyz - startWorld.xyz) * ${f32(renderer.tilesPerUnit ?? 1)}` : '1.0'};
    particleUV = vec2(corner.x + 0.5, corner.y * repeatV);
    particleColor = mix(startColor, endColor, corner.y);
    particleNormal = normalize(mat3(transpose(inverse(u_viewMatrix))) * cross(segment, side));
    ${soft === undefined ? '' : 'particleDepthMode = u_cameraPosition.w;'}
}`,
        fragmentSource: `#version 310 es
precision highp float;
precision highp int;
${PARTICLE_VIEW_BLOCK}
in vec2 particleUV;
in vec4 particleColor;
in vec3 particleNormal;
${soft === undefined ? '' : 'in float particleDepthMode;'}
${textured ? 'uniform sampler2D u_particleTexture;' : ''}
${soft === undefined ? '' : 'uniform sampler2D u_particleSceneDepth;'}
layout(location = 0) out vec4 fragmentColor;
void main() {
    vec4 color = ${textured ? 'texture(u_particleTexture, particleUV)' : 'vec4(1.0)'} * particleColor;
    ${
        soft === undefined
            ? ''
            : `float sceneDepth = texelFetch(u_particleSceneDepth, ivec2(gl_FragCoord.xy), 0).r;
    ${(renderer.depthTest ?? true) ? 'if (particleDepthMode > 0.5 ? gl_FragCoord.z < sceneDepth : gl_FragCoord.z > sceneDepth) discard;' : ''}
    color.a *= pow(clamp(abs(sceneDepth - gl_FragCoord.z) / ${f32(soft.distance)}, 0.0, 1.0), ${f32(soft.contrast ?? 1)});`
    }
    if (color.a <= 0.00001) discard;
    ${lightingSource(renderer.lighting === 'lambert')}
    ${premultiply}
    fragmentColor = color;
}`
    });
}

/** Compile a per-view ribbon topology and compact segment pipeline. */
export function compileParticleGPURibbonRenderer(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    renderer: ParticleRibbonRendererDefinition,
    rendererDataByteLength: number
): Readonly<ParticleGPURibbonRendererPlan> {
    const capacity = plan.definition.capacity;
    let topologyCapacity = 1;
    while (topologyCapacity < capacity) topologyCapacity <<= 1;
    const topologyByteLength = align(topologyCapacity * 4, 16);
    const segmentByteLength = align(Math.max(1, capacity - 1) * 64, 16);
    const counterByteLength = 16;
    const indirectByteLength = 16;
    const stateByteLength = align(plan.attributeByteLength, 16);
    const aliveByteLength = align(capacity * 4, 16);
    const particleCounterByteLength = 32;
    const ribbonId = attributeOffset(plan, 'ribbon-id');
    const stableId = attributeOffset(plan, 'stable-id');
    const reset = new ComputeShader({
        label: `${plan.definition.name}:particle-ribbon-reset`,
        workgroupSize: [1],
        source: `
@group(0) @binding(0) var<storage, read_write> segmentCounter: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> indirect: array<u32>;
@compute @workgroup_size(1) fn main() {
    atomicStore(&segmentCounter[0], 0u);
    indirect[0] = 0u; indirect[1] = 1u; indirect[2] = 0u; indirect[3] = 0u;
}`,
        bindings: [
            {
                name: 'segmentCounter',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: counterByteLength
            },
            {
                name: 'indirect',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: indirectByteLength
            }
        ]
    });
    const initializeTopology = new ComputeShader({
        label: `${plan.definition.name}:particle-ribbon-topology-initialize`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `
struct ParticleCounters { aliveCount: atomic<u32>, outputAliveCount: atomic<u32>, deadCount: atomic<u32>, nextIndex: atomic<u32>, droppedSpawnCount: atomic<u32>, };
@group(0) @binding(0) var<storage, read> counters: ParticleCounters;
@group(0) @binding(1) var<storage, read_write> topology: array<u32>;
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    if (invocation.x >= ${String(topologyCapacity)}u) { return; }
    topology[invocation.x] = select(invocation.x, 0xffffffffu, invocation.x >= atomicLoad(&counters.aliveCount));
}`,
        bindings: [
            {
                name: 'counters',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: particleCounterByteLength
            },
            {
                name: 'topology',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: topologyByteLength
            }
        ]
    });
    const sortTopology = new ComputeShader({
        label: `${plan.definition.name}:particle-ribbon-topology-sort`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `
struct SortParams { size: u32, stride: u32, capacity: u32, padding: u32, };
@group(0) @binding(0) var<uniform> params: SortParams;
@group(0) @binding(1) var<storage, read> state: array<u32>;
@group(0) @binding(2) var<storage, read> aliveIndices: array<u32>;
@group(0) @binding(3) var<storage, read_write> topology: array<u32>;
fn greater(leftDense: u32, rightDense: u32) -> bool {
    if (leftDense == 0xffffffffu) { return rightDense != 0xffffffffu; }
    if (rightDense == 0xffffffffu) { return false; }
    let left = aliveIndices[leftDense]; let right = aliveIndices[rightDense];
    let leftRibbon = state[${String(ribbonId)}u + left]; let rightRibbon = state[${String(ribbonId)}u + right];
    if (leftRibbon != rightRibbon) { return leftRibbon > rightRibbon; }
    return state[${String(stableId)}u + left] > state[${String(stableId)}u + right];
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    let index = invocation.x; if (index >= params.capacity) { return; }
    let partner = index ^ params.stride; if (partner <= index || partner >= params.capacity) { return; }
    let ascending = (index & params.size) == 0u;
    let left = topology[index]; let right = topology[partner];
    if (greater(left, right) == ascending) { topology[index] = right; topology[partner] = left; }
}`,
        bindings: [
            { name: 'params', group: 0, binding: 0, kind: 'uniform-buffer', minBindingSize: 16 },
            {
                name: 'state',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: stateByteLength
            },
            {
                name: 'aliveIndices',
                group: 0,
                binding: 2,
                kind: 'read-only-storage-buffer',
                minBindingSize: aliveByteLength
            },
            {
                name: 'topology',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: topologyByteLength
            }
        ]
    });
    const buildSegments = new ComputeShader({
        label: `${plan.definition.name}:particle-ribbon-segment-compact`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `
@group(0) @binding(0) var<storage, read> state: array<u32>;
@group(0) @binding(1) var<storage, read> aliveIndices: array<u32>;
@group(0) @binding(2) var<storage, read> rendererData: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> topology: array<u32>;
@group(0) @binding(4) var<storage, read_write> segmentCounter: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> segments: array<vec4<f32>>;
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    let order = invocation.x; if (order + 1u >= ${String(topologyCapacity)}u) { return; }
    let startDense = topology[order]; let endDense = topology[order + 1u];
    if (startDense == 0xffffffffu || endDense == 0xffffffffu) { return; }
    let startParticle = aliveIndices[startDense]; let endParticle = aliveIndices[endDense];
    if (state[${String(ribbonId)}u + startParticle] != state[${String(ribbonId)}u + endParticle]) { return; }
    let segment = atomicAdd(&segmentCounter[0], 1u);
    segments[segment * 4u] = rendererData[startDense * 4u];
    segments[segment * 4u + 1u] = rendererData[endDense * 4u];
    segments[segment * 4u + 2u] = rendererData[startDense * 4u + 1u];
    segments[segment * 4u + 3u] = rendererData[endDense * 4u + 1u];
}`,
        bindings: [
            {
                name: 'state',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: stateByteLength
            },
            {
                name: 'aliveIndices',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: aliveByteLength
            },
            {
                name: 'rendererData',
                group: 0,
                binding: 2,
                kind: 'read-only-storage-buffer',
                minBindingSize: rendererDataByteLength
            },
            {
                name: 'topology',
                group: 0,
                binding: 3,
                kind: 'read-only-storage-buffer',
                minBindingSize: topologyByteLength
            },
            {
                name: 'segmentCounter',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: counterByteLength
            },
            {
                name: 'segments',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: segmentByteLength
            }
        ]
    });
    const finalize = new ComputeShader({
        label: `${plan.definition.name}:particle-ribbon-indirect-finalize`,
        workgroupSize: [1],
        source: `
@group(0) @binding(0) var<storage, read> segmentCounter: array<u32>;
@group(0) @binding(1) var<storage, read_write> indirect: array<u32>;
@compute @workgroup_size(1) fn main() { indirect[0] = 6u * segmentCounter[0]; indirect[1] = 1u; }
`,
        bindings: [
            {
                name: 'segmentCounter',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: counterByteLength
            },
            {
                name: 'indirect',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: indirectByteLength
            }
        ]
    });
    return Object.freeze({
        kind: 'ribbon',
        definition: renderer,
        topologyCapacity,
        topologyByteLength,
        segmentByteLength,
        counterByteLength,
        indirectByteLength,
        reset,
        initializeTopology,
        sortTopology,
        buildSegments,
        finalize,
        shader: ribbonShader(plan, renderer, segmentByteLength)
    });
}

export type ParticleGPUAdvancedRendererPlan =
    ParticleGPUMeshRendererPlan | ParticleGPURibbonRendererPlan;
