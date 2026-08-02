import * as Hilo3d from '../src/Hilo3d';

// This deterministic scene combines acceptance-scale Forward+/Gaussian data-flow evidence with a
// showcase-quality Hilo3D particle wordmark. It is not a production light culler, splat sorter, or
// performance baseline.
const TARGET_WIDTH = 1152;
const TARGET_HEIGHT = 384;
const LANE_WIDTH = TARGET_WIDTH / 3;
const FORWARD_TILE_COUNT = 4;
const FORWARD_TILE_WIDTH = LANE_WIDTH / FORWARD_TILE_COUNT;
const PARTICLE_COUNT = 1024;
const PARTICLE_WORKGROUP_SIZE = 64;
const PARTICLE_WORKGROUP_COUNT = PARTICLE_COUNT / PARTICLE_WORKGROUP_SIZE;
const PARTICLE_FLOATS_PER_RECORD = 12;
const PARTICLE_BUFFER_BYTE_LENGTH = PARTICLE_COUNT * PARTICLE_FLOATS_PER_RECORD * 4;
const PARTICLE_INDEX_BUFFER_BYTE_LENGTH = PARTICLE_COUNT * 4;
const REQUIRED_CAPABILITIES: readonly Hilo3d.RenderPipelineCapabilityName[] = Object.freeze([
    'storage-buffer',
    'compute-pass',
    'indirect-draw'
]);
const SMALL_BUFFER_DESCRIPTOR = Object.freeze({ byteLength: 16 });
const PARTICLE_INDEX_BUFFER_DESCRIPTOR = Object.freeze({
    byteLength: PARTICLE_INDEX_BUFFER_BYTE_LENGTH
});
const EMPTY_COLOR_ATTACHMENTS: readonly Hilo3d.RenderPipelineColorAttachment[] = Object.freeze([]);
const BACKGROUND_COLOR = Object.freeze({ r: 0.015, g: 0.025, b: 0.05, a: 1 });
const FORWARD_VIEWPORT = Object.freeze([0, 0, LANE_WIDTH, TARGET_HEIGHT] as const);
const GAUSSIAN_VIEWPORT = Object.freeze([LANE_WIDTH, 0, LANE_WIDTH, TARGET_HEIGHT] as const);
const PARTICLE_VIEWPORT = Object.freeze([LANE_WIDTH * 2, 0, LANE_WIDTH, TARGET_HEIGHT] as const);

interface ClearBufferParameters {
    buffer: Hilo3d.RenderGraphBufferHandle;
}

class ClearBufferPass implements Hilo3d.ScriptableRenderPass<ClearBufferParameters> {
    readonly name = 'Forward+ counter clear';

    setup(builder: Hilo3d.ScriptableRenderPassBuilder, parameters: ClearBufferParameters): void {
        builder.clearBuffer(parameters.buffer);
    }

    execute(context: Hilo3d.ScriptableRenderPassContext, parameters: ClearBufferParameters): void {
        context.commands.clearBuffer(parameters.buffer);
    }
}

const FORWARD_COUNTER_CLEAR_PASS = new ClearBufferPass();

function computePass(shader: Hilo3d.ComputeShader): Hilo3d.ComputeRenderPass {
    return new Hilo3d.ComputeRenderPass(
        new Hilo3d.ComputeKernel({
            label: shader.label,
            shader
        }),
        shader.label
    );
}

const FORWARD_TILE_LIGHT_PASS = computePass(
    new Hilo3d.ComputeShader({
        label: 'Forward+ sampled-depth tile light culling',
        source: `
@group(0) @binding(0) var<storage, read> screenLights: array<vec4<f32>>;
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
@group(0) @binding(2) var<storage, read_write> tileCounter: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> tileLightList: array<u32>;

@compute @workgroup_size(4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let tileIndex = id.x;
    let tileStartX = tileIndex * ${String(FORWARD_TILE_WIDTH)}u;
    let tileEndX = tileStartX + ${String(FORWARD_TILE_WIDTH)}u;
    let depthExtent = textureDimensions(sceneDepth);
    var minimumDepth = 1.0;
    for (var y = 0u; y < depthExtent.y; y += 1u) {
        for (var x = tileStartX; x < tileEndX; x += 1u) {
            minimumDepth = min(
                minimumDepth,
                textureLoad(sceneDepth, vec2<i32>(i32(x), i32(y)), 0)
            );
        }
    }

    var lightMask = 0u;
    if (minimumDepth < 0.9999) {
        let tileCenterX = f32(tileStartX + tileEndX) * 0.5;
        for (var lightIndex = 0u; lightIndex < 4u; lightIndex += 1u) {
            let light = screenLights[lightIndex];
            let overlapsTile = abs(light.x - tileCenterX) <= light.y;
            let overlapsDepth = minimumDepth <= light.z;
            if (overlapsTile && overlapsDepth) {
                lightMask |= 1u << lightIndex;
            }
        }
    }

    let depthBucket = u32(clamp((1.0 - minimumDepth) * 4095.0, 0.0, 255.0));
    tileLightList[tileIndex] = (depthBucket << 8u) | lightMask;
    _ = atomicAdd(&tileCounter[0], countOneBits(lightMask));
}`,
        workgroupSize: [4],
        bindings: [
            {
                name: 'screenLights',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: 64
            },
            {
                name: 'sceneDepth',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'tileCounter',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: 16
            },
            {
                name: 'tileLightList',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: 16
            }
        ]
    })
);

const GAUSSIAN_CULL_PASS = computePass(
    new Hilo3d.ComputeShader({
        label: 'Gaussian project, cull, and compact',
        source: `
struct Splat {
    centerScale: vec4<f32>,
    color: vec4<f32>,
};
@group(0) @binding(0) var<storage, read> splats: array<Splat>;
@group(0) @binding(1) var<storage, read_write> visibleIndices: array<u32>;

@compute @workgroup_size(1)
fn main() {
    var count = 0u;
    for (var index = 0u; index < 3u; index += 1u) {
        let center = splats[index].centerScale.xy;
        if (all(abs(center) < vec2<f32>(1.0))) {
            visibleIndices[count] = index;
            count += 1u;
        }
    }
    for (var index = count; index < 4u; index += 1u) {
        visibleIndices[index] = 0xffffffffu;
    }
}`,
        workgroupSize: [1],
        bindings: [
            {
                name: 'splats',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: 96
            },
            {
                name: 'visibleIndices',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: 16
            }
        ]
    })
);

function gaussianReorderPass(label: string, first: number, second: number, third: number) {
    return computePass(
        new Hilo3d.ComputeShader({
            label,
            source: `
@group(0) @binding(0) var<storage, read> sourceIndices: array<u32>;
@group(0) @binding(1) var<storage, read_write> destinationIndices: array<u32>;

@compute @workgroup_size(1)
fn main() {
    destinationIndices[0] = sourceIndices[${String(first)}];
    destinationIndices[1] = sourceIndices[${String(second)}];
    destinationIndices[2] = sourceIndices[${String(third)}];
    destinationIndices[3] = sourceIndices[3];
}`,
            workgroupSize: [1],
            bindings: [
                {
                    name: 'sourceIndices',
                    group: 0,
                    binding: 0,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: 16
                },
                {
                    name: 'destinationIndices',
                    group: 0,
                    binding: 1,
                    kind: 'storage-buffer',
                    access: 'write-discard',
                    minBindingSize: 16
                }
            ]
        })
    );
}

const GAUSSIAN_REORDER_A_PASS = gaussianReorderPass('Gaussian reorder stage A', 2, 1, 0);
const GAUSSIAN_REORDER_B_PASS = gaussianReorderPass('Gaussian reorder stage B', 1, 2, 0);
const GAUSSIAN_ARGUMENT_PASS = computePass(
    new Hilo3d.ComputeShader({
        label: 'Gaussian indirect argument generation',
        source: `
@group(0) @binding(0) var<storage, read> sortedIndices: array<u32>;
@group(0) @binding(1) var<storage, read_write> drawArguments: array<u32>;

@compute @workgroup_size(1)
fn main() {
    var visibleCount = 0u;
    for (var index = 0u; index < 4u; index += 1u) {
        if (sortedIndices[index] != 0xffffffffu) { visibleCount += 1u; }
    }
    drawArguments[0] = 6u * visibleCount;
    drawArguments[1] = 1u;
    drawArguments[2] = 0u;
    drawArguments[3] = 0u;
}`,
        workgroupSize: [1],
        bindings: [
            {
                name: 'sortedIndices',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: 16
            },
            {
                name: 'drawArguments',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: 16
            }
        ]
    })
);

const PARTICLE_SIMULATE_PASS = computePass(
    new Hilo3d.ComputeShader({
        label: 'Hilo3D curl-noise particle simulation',
        source: `
struct Particle {
    positionLife: vec4<f32>,
    velocitySeed: vec4<f32>,
    targetHome: vec4<f32>,
};
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> aliveFlags: array<u32>;

fn hashValue(point: vec2<f32>) -> f32 {
    return fract(sin(dot(point, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn valueNoise(point: vec2<f32>) -> f32 {
    let cell = floor(point);
    let local = fract(point);
    let curve = local * local * (vec2<f32>(3.0) - 2.0 * local);
    let bottom = mix(hashValue(cell), hashValue(cell + vec2<f32>(1.0, 0.0)), curve.x);
    let top = mix(
        hashValue(cell + vec2<f32>(0.0, 1.0)),
        hashValue(cell + vec2<f32>(1.0, 1.0)),
        curve.x
    );
    return mix(bottom, top, curve.y);
}

fn fractalValueNoise(point: vec2<f32>) -> f32 {
    return valueNoise(point) * 0.5333
        + valueNoise(point * 2.03 + vec2<f32>(7.1, 3.7)) * 0.2667
        + valueNoise(point * 4.11 + vec2<f32>(1.9, 9.2)) * 0.1333
        + valueNoise(point * 8.17 + vec2<f32>(5.4, 2.6)) * 0.0667;
}

fn curlNoise(point: vec2<f32>) -> vec2<f32> {
    let epsilon = 0.075;
    let horizontal = fractalValueNoise(point + vec2<f32>(epsilon, 0.0))
        - fractalValueNoise(point - vec2<f32>(epsilon, 0.0));
    let vertical = fractalValueNoise(point + vec2<f32>(0.0, epsilon))
        - fractalValueNoise(point - vec2<f32>(0.0, epsilon));
    let curl = vec2<f32>(vertical, -horizontal) / (2.0 * epsilon);
    return curl / max(length(curl), 0.001);
}

@compute @workgroup_size(${String(PARTICLE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= ${String(PARTICLE_COUNT)}u) { return; }

    var particle = particles[id.x];
    var position = particle.positionLife.xy;
    var velocity = particle.velocitySeed.xy;
    let phase = particle.positionLife.z;
    let seed = particle.velocitySeed.w;
    let homePosition = particle.targetHome.xy;
    let pulse = sin(phase * 1.75 + seed * 0.017);
    let breathingTarget = homePosition * (1.0 + pulse * 0.018);
    let targetDelta = breathingTarget - position;
    let targetDistance = max(length(targetDelta), 0.0001);
    let tangent = vec2<f32>(-targetDelta.y, targetDelta.x) / targetDistance;
    let seedOffset = vec2<f32>(fract(seed * 0.1031), fract(seed * 0.0973)) * 19.0;
    let noisePoint = position * 3.2 + seedOffset + vec2<f32>(phase * 0.11, -phase * 0.09);
    let wind = curlNoise(noisePoint);
    let restoring = targetDelta * particle.targetHome.z;
    let vortex = tangent * (0.10 + 0.06 * sin(phase * 0.91 + seed * 0.031));
    let acceleration = restoring + wind * 0.34 + vortex;

    velocity = (velocity + acceleration * 0.0166667) * 0.982;
    let speed = length(velocity);
    if (speed > 0.42) { velocity *= 0.42 / speed; }
    position += velocity * 0.0166667;

    particle.positionLife = vec4<f32>(position, phase + 0.0166667, 1.0);
    particle.velocitySeed = vec4<f32>(velocity, particle.velocitySeed.zw);
    particles[id.x] = particle;
    aliveFlags[id.x] = 1u;
}`,
        workgroupSize: [PARTICLE_WORKGROUP_SIZE],
        bindings: [
            {
                name: 'particles',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: PARTICLE_BUFFER_BYTE_LENGTH
            },
            {
                name: 'aliveFlags',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: PARTICLE_INDEX_BUFFER_BYTE_LENGTH
            }
        ]
    })
);

const PARTICLE_COMPACT_PASS = computePass(
    new Hilo3d.ComputeShader({
        label: 'Particle alive-list compaction and draw arguments',
        source: `
@group(0) @binding(0) var<storage, read> aliveFlags: array<u32>;
@group(0) @binding(1) var<storage, read_write> aliveIndices: array<u32>;
@group(0) @binding(2) var<storage, read_write> drawArguments: array<u32>;

@compute @workgroup_size(1)
fn main() {
    var aliveCount = 0u;
    for (var index = 0u; index < ${String(PARTICLE_COUNT)}u; index += 1u) {
        if (aliveFlags[index] != 0u) {
            aliveIndices[aliveCount] = index;
            aliveCount += 1u;
        }
    }
    for (var index = aliveCount; index < ${String(PARTICLE_COUNT)}u; index += 1u) {
        aliveIndices[index] = 0u;
    }
    drawArguments[0] = 6u * aliveCount;
    drawArguments[1] = 1u;
    drawArguments[2] = 0u;
    drawArguments[3] = 0u;
}`,
        workgroupSize: [1],
        bindings: [
            {
                name: 'aliveFlags',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: PARTICLE_INDEX_BUFFER_BYTE_LENGTH
            },
            {
                name: 'aliveIndices',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: PARTICLE_INDEX_BUFFER_BYTE_LENGTH
            },
            {
                name: 'drawArguments',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: 16
            }
        ]
    })
);

const FORWARD_SCENE_SHADER = new Hilo3d.StorageGraphicsShader({
    label: 'Forward+ renderer-list tile lighting',
    vertexSource: `#version 310 es
precision highp float;
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
};
layout(std140) uniform ModelBlock {
    mat4 u_modelMatrix;
};
in vec3 a_position;
void main() {
    gl_Position = u_viewProjectionMatrix * u_modelMatrix * vec4(a_position, 1.0);
}`,
    fragmentSource: `#version 310 es
precision highp float;
precision highp int;
layout(std140) uniform MaterialBlock {
    vec4 u_diffuseColor;
    vec4 u_specularColor;
    vec4 u_ambientColor;
    vec4 u_emissionColor;
    vec4 u_baseColor;
};
layout(std430) readonly buffer TileLightList {
    uint values[];
} tileLightList;
layout(location = 0) out vec4 color;
void main() {
    uint tileIndex = min(uint(floor(gl_FragCoord.x / ${String(FORWARD_TILE_WIDTH)}.0)), ${String(FORWARD_TILE_COUNT - 1)}u);
    uint packedTile = tileLightList.values[tileIndex];
    uint lightMask = packedTile & 255u;
    float depthFactor = float(packedTile >> 8u) / 255.0;
    vec3 assignedLight = vec3(0.0);
    if ((lightMask & 1u) != 0u) assignedLight += vec3(1.0, 0.18, 0.08);
    if ((lightMask & 2u) != 0u) assignedLight += vec3(0.08, 1.0, 0.22);
    if ((lightMask & 4u) != 0u) assignedLight += vec3(0.1, 0.32, 1.0);
    if ((lightMask & 8u) != 0u) assignedLight += vec3(0.72, 0.22, 1.0);
    vec3 lighting = vec3(0.12 + depthFactor * 0.35) + assignedLight * 0.48;
    color = vec4(u_baseColor.rgb * lighting, 1.0);
}`,
    bindings: [
        { name: 'CameraBlock', group: 0, binding: 1, kind: 'uniform-buffer' },
        { name: 'MaterialBlock', group: 1, binding: 0, kind: 'uniform-buffer' },
        { name: 'ModelBlock', group: 2, binding: 0, kind: 'uniform-buffer' },
        {
            name: 'tileLightList',
            group: Hilo3d.SCENE_STORAGE_BIND_GROUP,
            binding: 0,
            kind: 'read-only-storage-buffer',
            minBindingSize: 16
        }
    ]
});
const FORWARD_DEPTH_PASS = new Hilo3d.SceneRenderPass('Forward+ sampled depth prepass');
const FORWARD_SCENE_PASS = new Hilo3d.SceneRenderPass('Forward+ renderer-list shading');

const PROCEDURAL_QUAD = `
vec2 proceduralCorner(int vertexIndex) {
    vec2 corner = vec2(-1.0, -1.0);
    if (vertexIndex == 1 || vertexIndex >= 4) corner.x = 1.0;
    if (vertexIndex == 2 || vertexIndex == 3 || vertexIndex == 5) corner.y = 1.0;
    return corner;
}`;

const GAUSSIAN_DRAW_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Gaussian storage vertex pulling and indirect blended draw',
    shader: new Hilo3d.StorageGraphicsShader({
        label: 'Gaussian splat raster',
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
layout(std430) readonly buffer SplatAttributes {
    vec4 values[];
} splatData;
layout(std430) readonly buffer SortedSplatIndices {
    uint values[];
} sortedIndices;
out vec2 localPosition;
out vec4 splatColor;
${PROCEDURAL_QUAD}
void main() {
    int instanceIndex = int(floor(float(gl_VertexID) / 6.0));
    int localVertexIndex = int(mod(float(gl_VertexID), 6.0));
    uint splatIndex = sortedIndices.values[instanceIndex];
    vec4 centerScale = splatData.values[splatIndex * 2u];
    vec4 sourceColor = splatData.values[splatIndex * 2u + 1u];
    localPosition = proceduralCorner(localVertexIndex);
    splatColor = sourceColor;
    gl_Position = vec4(
        centerScale.xy + localPosition * centerScale.z,
        0.0,
        1.0
    );
}`,
        fragmentSource: `#version 310 es
precision highp float;
in vec2 localPosition;
in vec4 splatColor;
layout(location = 0) out vec4 color;
void main() {
    float radiusSquared = dot(localPosition, localPosition);
    if (radiusSquared > 1.0) discard;
    float gaussian = exp(-2.0 * radiusSquared);
    color = vec4(splatColor.rgb, splatColor.a * gaussian);
}`,
        bindings: [
            {
                name: 'splatData',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: 96
            },
            {
                name: 'sortedIndices',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: 16
            }
        ]
    }),
    pipelineState: {
        ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: false,
        depthWrite: false,
        cullMode: 'none',
        blend: Hilo3d.MaterialBlendPreset.STRAIGHT_ALPHA
    }
});

const PARTICLE_DRAW_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Particle storage vertex pulling and indirect draw',
    shader: new Hilo3d.StorageGraphicsShader({
        label: 'GPU particle raster',
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
layout(std430) readonly buffer ParticleState {
    vec4 values[];
} particleState;
layout(std430) readonly buffer AliveParticleIndices {
    uint values[];
} aliveIndices;
out vec2 localPosition;
out vec3 particleColor;
out float particleEnergy;
${PROCEDURAL_QUAD}
void main() {
    int instanceIndex = int(floor(float(gl_VertexID) / 6.0));
    int localVertexIndex = int(mod(float(gl_VertexID), 6.0));
    uint particleIndex = aliveIndices.values[instanceIndex];
    vec4 positionLife = particleState.values[particleIndex * 3u];
    vec4 velocitySeed = particleState.values[particleIndex * 3u + 1u];
    localPosition = proceduralCorner(localVertexIndex);
    float colorCode = velocitySeed.z;
    if (colorCode < 0.5) particleColor = vec3(0.05, 0.82, 1.0);
    else if (colorCode < 1.5) particleColor = vec3(0.12, 0.48, 1.0);
    else if (colorCode < 2.5) particleColor = vec3(0.48, 0.24, 1.0);
    else if (colorCode < 3.5) particleColor = vec3(0.92, 0.18, 0.82);
    else if (colorCode < 4.5) particleColor = vec3(1.0, 0.42, 0.1);
    else particleColor = vec3(0.38, 1.0, 0.58);
    float speed = length(velocitySeed.xy);
    float twinkle = 0.5 + 0.5 * sin(positionLife.z * 2.2 + velocitySeed.w * 0.13);
    float particleScale = 0.018 + twinkle * 0.012 + min(speed, 0.25) * 0.018;
    particleEnergy = 0.66 + twinkle * 0.34;
    gl_Position = vec4(positionLife.xy + localPosition * particleScale, 0.0, 1.0);
}`,
        fragmentSource: `#version 310 es
precision highp float;
in vec2 localPosition;
in vec3 particleColor;
in float particleEnergy;
layout(location = 0) out vec4 color;
void main() {
    float radiusSquared = dot(localPosition, localPosition);
    if (radiusSquared > 1.0) discard;
    float core = exp(-18.0 * radiusSquared);
    float halo = exp(-3.2 * radiusSquared) * (1.0 - smoothstep(0.78, 1.0, sqrt(radiusSquared)));
    vec3 glowColor = mix(particleColor, vec3(1.0), core * 0.72);
    float alpha = particleEnergy * (core * 0.92 + halo * 0.3);
    color = vec4(glowColor, alpha);
}`,
        bindings: [
            {
                name: 'particleState',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: PARTICLE_BUFFER_BYTE_LENGTH
            },
            {
                name: 'aliveIndices',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: PARTICLE_INDEX_BUFFER_BYTE_LENGTH
            }
        ]
    }),
    pipelineState: {
        ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: false,
        depthWrite: false,
        cullMode: 'none',
        blend: Hilo3d.MaterialBlendPreset.STRAIGHT_ALPHA_ADDITIVE
    }
});

interface EffectBuffers {
    readonly forwardLights: Hilo3d.StorageBuffer;
    readonly gaussianSplats: Hilo3d.StorageBuffer;
    readonly particles: Hilo3d.StorageBuffer;
}

class ReusableComputeBufferBinding implements Hilo3d.ComputeBufferBinding {
    buffer!: Hilo3d.RenderGraphBufferHandle;
}

class ReusableComputeTextureBinding implements Hilo3d.ComputeTextureBinding {
    texture!: Hilo3d.RenderGraphTextureHandle;
}

class ReusableComputeParameters implements Hilo3d.ComputeRenderPassParameters {
    readonly buffers: ReusableComputeBufferBinding[] = [];
    readonly textures: ReusableComputeTextureBinding[] = [];
    readonly dispatch: Readonly<{ x: number }>;

    constructor(bufferCount: number, textureCount: number, dispatchX: number) {
        for (let index = 0; index < bufferCount; index += 1) {
            this.buffers.push(new ReusableComputeBufferBinding());
        }
        for (let index = 0; index < textureCount; index += 1) {
            this.textures.push(new ReusableComputeTextureBinding());
        }
        this.dispatch = Object.freeze({ x: dispatchX });
    }

    setBuffer(index: number, buffer: Hilo3d.RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Reusable compute buffer index is invalid');
        binding.buffer = buffer;
    }

    setTexture(index: number, texture: Hilo3d.RenderGraphTextureHandle): void {
        const binding = this.textures[index];
        if (binding === undefined) {
            throw new RangeError('Reusable compute texture index is invalid');
        }
        binding.texture = texture;
    }
}

class ReusableClearBufferParameters implements ClearBufferParameters {
    buffer!: Hilo3d.RenderGraphBufferHandle;
}

class ReusableClearColorAttachment implements Hilo3d.RenderPipelineColorAttachment {
    texture!: Hilo3d.RenderGraphTextureHandle;
    readonly loadOp = 'clear';
    readonly storeOp = 'store';
    readonly clearValue = BACKGROUND_COLOR;
}

class ReusableLoadColorAttachment implements Hilo3d.RenderPipelineColorAttachment {
    texture!: Hilo3d.RenderGraphTextureHandle;
    readonly loadOp = 'load';
    readonly storeOp = 'store';
}

class ReusableClearDepthAttachment implements Hilo3d.RenderPipelineDepthStencilAttachment {
    texture!: Hilo3d.RenderGraphTextureHandle;
    readonly depthLoadOp = 'clear';
    readonly depthStoreOp = 'store';
    readonly depthClearValue = 1;
}

class ReusableLoadDepthAttachment implements Hilo3d.RenderPipelineDepthStencilAttachment {
    texture!: Hilo3d.RenderGraphTextureHandle;
    readonly depthLoadOp = 'load';
    readonly depthStoreOp = 'store';
}

class ReusableIndirectDraw {
    readonly kind = 'draw-indirect';
    buffer!: Hilo3d.RenderGraphBufferHandle;
}

class ReusableIndirectDrawParameters implements Hilo3d.GPUDrivenRenderPassParameters {
    readonly buffers: ReusableComputeBufferBinding[] = [];
    readonly #indirectDraw = new ReusableIndirectDraw();
    readonly #colorAttachment = new ReusableLoadColorAttachment();
    readonly draw = this.#indirectDraw;
    readonly colorAttachments = [this.#colorAttachment];
    readonly viewport: Hilo3d.RendererViewport;
    readonly scissor: Hilo3d.RendererViewport;

    constructor(bufferCount: number, viewport: Hilo3d.RendererViewport) {
        for (let index = 0; index < bufferCount; index += 1) {
            this.buffers.push(new ReusableComputeBufferBinding());
        }
        this.viewport = viewport;
        this.scissor = viewport;
    }

    configureBuffer(index: number, buffer: Hilo3d.RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Reusable draw buffer index is invalid');
        binding.buffer = buffer;
    }

    configureDraw(
        drawArguments: Hilo3d.RenderGraphBufferHandle,
        outputColor: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.#indirectDraw.buffer = drawArguments;
        this.#colorAttachment.texture = outputColor;
    }
}

class ReusableForwardListDescriptor implements Hilo3d.RendererListDescriptor {
    cullingResults!: Hilo3d.CullingResultsHandle;
    readonly queue = 'opaque';
    readonly sorting = 'material-front-to-back';
}

class ForwardDepthParameters implements Hilo3d.SceneRenderPassParameters {
    rendererList!: Hilo3d.RendererListHandle;
    readonly colorAttachments = EMPTY_COLOR_ATTACHMENTS;
    readonly depthStencilAttachment = new ReusableClearDepthAttachment();
    readonly viewport = FORWARD_VIEWPORT;
    readonly scissor = FORWARD_VIEWPORT;
}

class ForwardSceneParameters implements Hilo3d.SceneRenderPassParameters {
    rendererList!: Hilo3d.RendererListHandle;
    readonly #colorAttachment = new ReusableClearColorAttachment();
    readonly #storageBinding = new ReusableComputeBufferBinding();
    readonly colorAttachments = [this.#colorAttachment];
    readonly depthStencilAttachment = new ReusableLoadDepthAttachment();
    readonly viewport = FORWARD_VIEWPORT;
    readonly scissor = FORWARD_VIEWPORT;
    readonly storageShaderVariant: Hilo3d.SceneStorageShaderVariant = {
        shader: FORWARD_SCENE_SHADER,
        buffers: [this.#storageBinding]
    };

    configure(
        rendererList: Hilo3d.RendererListHandle,
        outputColor: Hilo3d.RenderGraphTextureHandle,
        outputDepth: Hilo3d.RenderGraphTextureHandle,
        tileLightList: Hilo3d.RenderGraphBufferHandle
    ): void {
        this.rendererList = rendererList;
        this.#colorAttachment.texture = outputColor;
        this.depthStencilAttachment.texture = outputDepth;
        this.#storageBinding.buffer = tileLightList;
    }
}

class ForwardFrameParameters {
    readonly depth = new ForwardDepthParameters();
    readonly clearCounter = new ReusableClearBufferParameters();
    readonly cullLights = new ReusableComputeParameters(3, 1, 1);
    readonly scene = new ForwardSceneParameters();

    configure(
        rendererList: Hilo3d.RendererListHandle,
        outputColor: Hilo3d.RenderGraphTextureHandle,
        outputDepth: Hilo3d.RenderGraphTextureHandle,
        lights: Hilo3d.RenderGraphBufferHandle,
        tileCounter: Hilo3d.RenderGraphBufferHandle,
        tileLightList: Hilo3d.RenderGraphBufferHandle
    ): void {
        this.depth.rendererList = rendererList;
        this.depth.depthStencilAttachment.texture = outputDepth;
        this.clearCounter.buffer = tileCounter;
        this.cullLights.setBuffer(0, lights);
        this.cullLights.setBuffer(1, tileCounter);
        this.cullLights.setBuffer(2, tileLightList);
        this.cullLights.setTexture(0, outputDepth);
        this.scene.configure(rendererList, outputColor, outputDepth, tileLightList);
    }
}

class GaussianFrameParameters {
    readonly cull = new ReusableComputeParameters(2, 0, 1);
    readonly reorderA = new ReusableComputeParameters(2, 0, 1);
    readonly reorderB = new ReusableComputeParameters(2, 0, 1);
    readonly arguments = new ReusableComputeParameters(2, 0, 1);
    readonly draw = new ReusableIndirectDrawParameters(2, GAUSSIAN_VIEWPORT);

    configure(
        splats: Hilo3d.RenderGraphBufferHandle,
        visible: Hilo3d.RenderGraphBufferHandle,
        reorderA: Hilo3d.RenderGraphBufferHandle,
        sorted: Hilo3d.RenderGraphBufferHandle,
        drawArguments: Hilo3d.RenderGraphBufferHandle,
        outputColor: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.cull.setBuffer(0, splats);
        this.cull.setBuffer(1, visible);
        this.reorderA.setBuffer(0, visible);
        this.reorderA.setBuffer(1, reorderA);
        this.reorderB.setBuffer(0, reorderA);
        this.reorderB.setBuffer(1, sorted);
        this.arguments.setBuffer(0, sorted);
        this.arguments.setBuffer(1, drawArguments);
        this.draw.configureBuffer(0, splats);
        this.draw.configureBuffer(1, sorted);
        this.draw.configureDraw(drawArguments, outputColor);
    }
}

class ParticleFrameParameters {
    readonly simulate = new ReusableComputeParameters(2, 0, PARTICLE_WORKGROUP_COUNT);
    readonly compact = new ReusableComputeParameters(3, 0, 1);
    readonly draw = new ReusableIndirectDrawParameters(2, PARTICLE_VIEWPORT);

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        aliveFlags: Hilo3d.RenderGraphBufferHandle,
        aliveIndices: Hilo3d.RenderGraphBufferHandle,
        drawArguments: Hilo3d.RenderGraphBufferHandle,
        outputColor: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.simulate.setBuffer(0, particles);
        this.simulate.setBuffer(1, aliveFlags);
        this.compact.setBuffer(0, aliveFlags);
        this.compact.setBuffer(1, aliveIndices);
        this.compact.setBuffer(2, drawArguments);
        this.draw.configureBuffer(0, particles);
        this.draw.configureBuffer(1, aliveIndices);
        this.draw.configureDraw(drawArguments, outputColor);
    }
}

class ComputeEffectsPipeline implements Hilo3d.RenderPipeline {
    readonly name = 'Forward+, Gaussian splat, and GPU particle acceptance pipeline';
    readonly #forwardListDescriptor = new ReusableForwardListDescriptor();
    readonly #forwardParameters = new Hilo3d.RenderPassParameterPool(
        () => new ForwardFrameParameters()
    );
    readonly #gaussianParameters = new Hilo3d.RenderPassParameterPool(
        () => new GaussianFrameParameters()
    );
    readonly #particleParameters = new Hilo3d.RenderPassParameterPool(
        () => new ParticleFrameParameters()
    );
    #buffers: EffectBuffers | null = null;

    attachBuffers(buffers: EffectBuffers): void {
        if (this.#buffers !== null) throw new Error('Compute effect buffers are already attached');
        this.#buffers = buffers;
    }

    record(context: Hilo3d.RenderPipelineContext): void {
        const owned = this.#buffers;
        if (owned === null) throw new Error('Compute effect buffers are unavailable');
        const output = context.graph.importOutput();
        const outputColor = output.color(0);
        const outputDepth = output.depthStencil;
        if (outputDepth === null) throw new Error('Forward+ scene requires a depth attachment');

        const tileCounter = context.graph.createBuffer(
            'Forward+ atomic tile counter',
            SMALL_BUFFER_DESCRIPTOR
        );
        const tileLightList = context.graph.createBuffer(
            'Forward+ tile light list',
            SMALL_BUFFER_DESCRIPTOR
        );
        const forwardCulling = context.cull();
        this.#forwardListDescriptor.cullingResults = forwardCulling;
        const forwardList = context.createRendererList(this.#forwardListDescriptor);
        const forwardLights = context.graph.importStorageBuffer(owned.forwardLights);
        const forwardParameters = context.acquirePassParameters(this.#forwardParameters);
        forwardParameters.configure(
            forwardList,
            outputColor,
            outputDepth,
            forwardLights,
            tileCounter,
            tileLightList
        );
        context.graph.addPass(FORWARD_DEPTH_PASS, forwardParameters.depth);
        context.graph.addPass(FORWARD_COUNTER_CLEAR_PASS, forwardParameters.clearCounter);
        context.graph.addPass(FORWARD_TILE_LIGHT_PASS, forwardParameters.cullLights);
        context.graph.addPass(FORWARD_SCENE_PASS, forwardParameters.scene);

        const gaussianSplats = context.graph.importStorageBuffer(owned.gaussianSplats);
        const gaussianVisible = context.graph.createBuffer(
            'Gaussian visible compact list',
            SMALL_BUFFER_DESCRIPTOR
        );
        const gaussianReorderA = context.graph.createBuffer(
            'Gaussian reorder ping',
            SMALL_BUFFER_DESCRIPTOR
        );
        const gaussianSorted = context.graph.createBuffer(
            'Gaussian sorted indices',
            SMALL_BUFFER_DESCRIPTOR
        );
        const gaussianDrawArguments = context.graph.createBuffer(
            'Gaussian indirect draw args',
            SMALL_BUFFER_DESCRIPTOR
        );
        const gaussianParameters = context.acquirePassParameters(this.#gaussianParameters);
        gaussianParameters.configure(
            gaussianSplats,
            gaussianVisible,
            gaussianReorderA,
            gaussianSorted,
            gaussianDrawArguments,
            outputColor
        );
        context.graph.addPass(GAUSSIAN_CULL_PASS, gaussianParameters.cull);
        context.graph.addPass(GAUSSIAN_REORDER_A_PASS, gaussianParameters.reorderA);
        context.graph.addPass(GAUSSIAN_REORDER_B_PASS, gaussianParameters.reorderB);
        context.graph.addPass(GAUSSIAN_ARGUMENT_PASS, gaussianParameters.arguments);
        context.graph.addPass(GAUSSIAN_DRAW_PASS, gaussianParameters.draw);

        const particles = context.graph.importStorageBuffer(owned.particles);
        const particleAliveFlags = context.graph.createBuffer(
            'Particle alive flags',
            PARTICLE_INDEX_BUFFER_DESCRIPTOR
        );
        const particleAliveIndices = context.graph.createBuffer(
            'Particle compact alive list',
            PARTICLE_INDEX_BUFFER_DESCRIPTOR
        );
        const particleDrawArguments = context.graph.createBuffer(
            'Particle indirect draw args',
            SMALL_BUFFER_DESCRIPTOR
        );
        const particleParameters = context.acquirePassParameters(this.#particleParameters);
        particleParameters.configure(
            particles,
            particleAliveFlags,
            particleAliveIndices,
            particleDrawArguments,
            outputColor
        );
        context.graph.addPass(PARTICLE_SIMULATE_PASS, particleParameters.simulate);
        context.graph.addPass(PARTICLE_COMPACT_PASS, particleParameters.compact);
        context.graph.addPass(PARTICLE_DRAW_PASS, particleParameters.draw);
    }

    destroy(): void {
        this.#buffers = null;
    }
}

class ComputeEffectsPipelineFactory implements Hilo3d.RenderPipelineFactory {
    readonly name = 'WebGPU compute effects';
    readonly requirements: Readonly<Hilo3d.RenderPipelineRequirements> = Object.freeze({
        requiredCapabilities: REQUIRED_CAPABILITIES,
        requiredLimits: Object.freeze({
            maxStorageBuffersPerShaderStage: 3,
            maxComputeInvocationsPerWorkgroup: PARTICLE_WORKGROUP_SIZE
        })
    });
    readonly runtime = new ComputeEffectsPipeline();

    create(): Hilo3d.RenderPipeline {
        return this.runtime;
    }
}

function gaussianInitialData(): Float32Array {
    return new Float32Array([
        -0.56, 0.0, 0.28, 0.68, 1.0, 0.16, 0.1, 0.68, 0.0, 0.0, 0.32, 0.68, 0.12, 0.95, 0.38, 0.68,
        0.56, 0.0, 0.28, 0.68, 0.15, 0.42, 1.0, 0.68
    ]);
}

function forwardLightData(): Float32Array {
    // x position and radius are expressed in physical pixels of the Forward+ lane. The z value is
    // the farthest depth accepted by this tiny screen-space light volume.
    const halfTile = FORWARD_TILE_WIDTH * 0.5;
    const radius = FORWARD_TILE_WIDTH * 1.4;
    return new Float32Array([
        halfTile,
        radius,
        1,
        0,
        halfTile + FORWARD_TILE_WIDTH,
        radius,
        1,
        0,
        halfTile + FORWARD_TILE_WIDTH * 2,
        radius,
        1,
        0,
        halfTile + FORWARD_TILE_WIDTH * 3,
        radius,
        1,
        0
    ]);
}

interface WordmarkGlyph {
    readonly rows: readonly string[];
    readonly palette: number;
}

interface WordmarkCell {
    readonly x: number;
    readonly y: number;
    readonly palette: number;
}

const HILO3D_GLYPHS: readonly WordmarkGlyph[] = Object.freeze([
    {
        rows: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
        palette: 0
    },
    { rows: ['111', '010', '010', '010', '010', '010', '111'], palette: 1 },
    {
        rows: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
        palette: 2
    },
    {
        rows: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
        palette: 3
    },
    {
        rows: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
        palette: 4
    },
    {
        rows: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
        palette: 5
    }
]);

function deterministicUnit(index: number, salt: number): number {
    let value = (Math.imul(index + 1, 0x9e3779b1) + salt) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x21f0aaad) >>> 0;
    value ^= value >>> 15;
    value = Math.imul(value, 0x735a2d97) >>> 0;
    value ^= value >>> 15;
    return value / 0x1_0000_0000;
}

function wordmarkCells(): readonly WordmarkCell[] {
    const gapColumns = 1;
    let totalColumns = -gapColumns;
    for (const glyph of HILO3D_GLYPHS) {
        const firstRow = glyph.rows[0];
        if (firstRow === undefined) throw new Error('Hilo3D glyph must have at least one row');
        totalColumns += firstRow.length + gapColumns;
    }
    const xStep = 1.8 / (totalColumns - 1);
    const yStep = 0.14;
    const cells: WordmarkCell[] = [];
    let columnOffset = 0;
    for (const glyph of HILO3D_GLYPHS) {
        const firstRow = glyph.rows[0];
        if (firstRow === undefined) throw new Error('Hilo3D glyph must have at least one row');
        for (let row = 0; row < glyph.rows.length; row += 1) {
            const pattern = glyph.rows[row];
            if (pattern?.length !== firstRow.length) {
                throw new Error('Hilo3D glyph rows must have a stable width');
            }
            for (let column = 0; column < pattern.length; column += 1) {
                if (pattern[column] !== '1') continue;
                cells.push({
                    x: -0.9 + (columnOffset + column) * xStep,
                    y: (3 - row) * yStep,
                    palette: glyph.palette
                });
            }
        }
        columnOffset += firstRow.length + gapColumns;
    }
    return cells;
}

function particleInitialData(): Float32Array {
    // This deterministic target layout is generated exactly once before the persistent GPU state
    // buffer is created. Every subsequent position/velocity update comes from the compute pass.
    const cells = wordmarkCells();
    if (cells.length === 0) throw new Error('Hilo3D particle wordmark has no active cells');
    const data = new Float32Array(PARTICLE_COUNT * PARTICLE_FLOATS_PER_RECORD);
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        const cell = cells[index % cells.length];
        if (cell === undefined) throw new Error('Hilo3D particle target is unavailable');
        const replica = Math.floor(index / cells.length);
        const angle = deterministicUnit(index, 0x68bc21eb) * Math.PI * 2;
        const targetRadius = 0.003 + (replica % 4) * 0.0025;
        const targetX = cell.x + Math.cos(angle) * targetRadius;
        const targetY = cell.y + Math.sin(angle) * targetRadius;
        const orbitAngle = angle + deterministicUnit(index, 0x02e5be93) * 0.9;
        const orbitRadius = 0.018 + deterministicUnit(index, 0x967a889b) * 0.022;
        const positionX = targetX + Math.cos(orbitAngle) * orbitRadius;
        const positionY = targetY + Math.sin(orbitAngle) * orbitRadius;
        const velocityScale = 0.004 + deterministicUnit(index, 0x4f1bbcdc) * 0.003;
        const offset = index * PARTICLE_FLOATS_PER_RECORD;
        data[offset] = positionX;
        data[offset + 1] = positionY;
        data[offset + 2] = deterministicUnit(index, 0x51ed270b) * Math.PI * 2;
        data[offset + 3] = 1;
        data[offset + 4] = -Math.sin(orbitAngle) * velocityScale;
        data[offset + 5] = Math.cos(orbitAngle) * velocityScale;
        data[offset + 6] = cell.palette;
        data[offset + 7] = index + 1;
        data[offset + 8] = targetX;
        data[offset + 9] = targetY;
        data[offset + 10] = 3.15 + deterministicUnit(index, 0x7f4a7c15) * 0.55;
        data[offset + 11] = 0;
    }
    return data;
}

function readPixel(
    data: Uint8Array,
    x: number,
    y: number
): readonly [number, number, number, number] {
    const offset = (y * TARGET_WIDTH + x) * 4;
    return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0];
}

interface LaneEvidence {
    readonly coloredPixels: number;
    readonly partialPixels: number;
    readonly distinctColors: number;
    readonly activeTiles: number;
    readonly hash: number;
}

interface ParticleEvidence extends LaneEvidence {
    readonly simulatedParticles: number;
}

function analyzeLane(data: Uint8Array, lane: number): LaneEvidence {
    const startX = lane * LANE_WIDTH;
    const colors = new Set<number>();
    const activeTiles = new Set<number>();
    let coloredPixels = 0;
    let partialPixels = 0;
    let hash = 0x811c9dc5;
    for (let y = 0; y < TARGET_HEIGHT; y += 1) {
        for (let x = startX; x < startX + LANE_WIDTH; x += 1) {
            const offset = (y * TARGET_WIDTH + x) * 4;
            const red = data[offset] ?? 0;
            const green = data[offset + 1] ?? 0;
            const blue = data[offset + 2] ?? 0;
            const background = red <= 5 && green <= 8 && blue <= 14;
            if (!background) {
                coloredPixels += 1;
                activeTiles.add(Math.floor((x - startX) / FORWARD_TILE_WIDTH));
                if (red < 250 && green < 250 && blue < 250) partialPixels += 1;
            }
            colors.add((red << 16) | (green << 8) | blue);
            for (let channel = 0; channel < 4; channel += 1) {
                hash ^= data[offset + channel] ?? 0;
                hash = Math.imul(hash, 0x01000193) >>> 0;
            }
        }
    }
    return {
        coloredPixels,
        partialPixels,
        distinctColors: colors.size,
        activeTiles: activeTiles.size,
        hash
    };
}

const container = document.querySelector<HTMLElement>('#container');
if (!container) throw new Error('Compute example container is missing');
const factory = new ComputeEffectsPipelineFactory();
const camera = new Hilo3d.PerspectiveCamera({ aspect: 1, near: 0.1, far: 10, z: 2 });
const stage = await Hilo3d.Stage.create({
    backend: 'webgpu',
    container,
    camera,
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    pixelRatio: 1,
    antialias: false,
    alpha: false,
    renderPipeline: factory
});
const forwardGeometry = new Hilo3d.Geometry({
    mode: Hilo3d.constants.TRIANGLES,
    vertices: new Hilo3d.GeometryData(
        new Float32Array([-0.28, -0.32, 0, 0.28, -0.32, 0, 0, 0.34, 0]),
        3
    )
});
const forwardMeshes = [
    new Hilo3d.Mesh({
        geometry: forwardGeometry,
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.92, 0.28, 0.18),
            roughness: 0.55
        }),
        x: -0.68,
        frustumTest: false
    }),
    new Hilo3d.Mesh({
        geometry: forwardGeometry,
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.18, 0.86, 0.42),
            roughness: 0.4
        }),
        frustumTest: false
    }),
    new Hilo3d.Mesh({
        geometry: forwardGeometry,
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.18, 0.45, 0.96),
            metallic: 0.25,
            roughness: 0.32
        }),
        x: 0.68,
        frustumTest: false
    })
];
for (const mesh of forwardMeshes) stage.addChild(mesh);
const target = stage.renderer.createRenderTarget({
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    colorAttachments: [{ clearValue: { r: 0.015, g: 0.025, b: 0.05, a: 1 } }],
    depthStencilAttachment: { format: 'depth24plus', sampled: true }
});
const gaussianSplats = stage.renderer.createStorageBuffer({
    label: 'Persistent Gaussian attributes',
    byteLength: 96,
    usage: ['storage'],
    initialData: gaussianInitialData(),
    recovery: 'cpu-shadow'
});
const forwardLights = stage.renderer.createStorageBuffer({
    label: 'Forward+ screen-space light records',
    byteLength: 64,
    usage: ['storage'],
    initialData: forwardLightData(),
    recovery: 'cpu-shadow'
});
const particles = stage.renderer.createStorageBuffer({
    label: 'Deterministic Hilo3D curl-noise particle state',
    byteLength: PARTICLE_BUFFER_BYTE_LENGTH,
    usage: ['storage'],
    initialData: particleInitialData(),
    // cpu-shadow restores the deterministic CPU seed/checkpoint. GPU simulation writes are not
    // mirrored back to that shadow and therefore are not retained across WebGPU device loss.
    recovery: 'cpu-shadow'
});
factory.runtime.attachBuffers({ forwardLights, gaussianSplats, particles });
stage.renderer.setRenderTarget(target, { present: true, takeOwnership: true });
stage.tick(1 / 60);
await stage.renderer.waitForIdle();

// The only GPU-to-CPU transfer in this acceptance example is the final color attachment. Visible
// counts, reordered indices, particle lists, and indirect arguments remain GPU-only.
const readback = await target.readColorAttachment();
const forward = analyzeLane(readback.data, 0);
const gaussian = analyzeLane(readback.data, 1);
const particle = analyzeLane(readback.data, 2);
window.__HILO3D_COMPUTE_EFFECTS_RESULT__ = {
    backend: stage.renderer.backend,
    forward: {
        centerColor: readPixel(readback.data, LANE_WIDTH / 2, TARGET_HEIGHT / 2),
        ...forward
    },
    gaussian,
    particle: {
        ...particle,
        simulatedParticles: PARTICLE_COUNT
    }
};
document.body.dataset['computeEffectsReady'] = 'true';
const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();

window.addEventListener(
    'pagehide',
    () => {
        ticker.stop();
        forwardLights.destroy();
        gaussianSplats.destroy();
        particles.destroy();
        stage.destroy();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_COMPUTE_EFFECTS_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly forward: LaneEvidence & {
                readonly centerColor: readonly [number, number, number, number];
            };
            readonly gaussian: LaneEvidence;
            readonly particle: ParticleEvidence;
        };
    }
}
