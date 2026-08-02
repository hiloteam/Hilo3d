import * as Hilo3d from '../../src/Hilo3d';

const PARTICLE_COUNT = 32_768;
const WORKGROUP_SIZE = 64;
const FLOATS_PER_PARTICLE = 12;
const PARTICLE_BUFFER_BYTE_LENGTH = PARTICLE_COUNT * FLOATS_PER_PARTICLE * 4;
const INDIRECT_BUFFER_BYTE_LENGTH = 16;
const FIELD_BLOCK_NAME = 'BloomNocturneFieldBlock';
const TAU = Math.PI * 2;

Hilo3d.registerUniformBlockBinding(FIELD_BLOCK_NAME);
const fieldLayout = Hilo3d.createStd140Layout({
    u_viewProjectionMatrix: 'mat4',
    u_centerTime: 'vec4',
    u_viewportMotion: 'vec4'
});
const fieldBlock = Hilo3d.UniformBuffer.fromSchema(fieldLayout);

const COMPUTE_PASS = new Hilo3d.ComputeRenderPass(
    new Hilo3d.ComputeKernel({
        label: 'Nocturne firefly current simulation',
        shader: new Hilo3d.ComputeShader({
            label: 'Nocturne firefly current simulation',
            source: `
struct FieldBlock {
    viewProjectionMatrix: mat4x4<f32>,
    centerTime: vec4<f32>,
    viewportMotion: vec4<f32>,
};

struct Particle {
    positionPhase: vec4<f32>,
    velocitySeed: vec4<f32>,
    character: vec4<f32>,
};

@group(0) @binding(0) var<uniform> field: FieldBlock;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> drawArguments: array<u32>;

fn safeNormalize(value: vec3<f32>) -> vec3<f32> {
    return value / max(length(value), 0.0001);
}

fn attractionTarget(character: vec4<f32>, seed: f32, time: f32) -> vec3<f32> {
    let center = field.centerTime.xyz;
    if (character.z < 0.5) {
        let rise = fract(seed * 7.71 + time * (0.018 + seed * 0.012));
        let angle = seed * 31.4159265 + rise * 12.5663706 + time * 0.17;
        let radius = character.x
            * (0.76 + sin(angle * 1.5 + seed * 17.0) * 0.16)
            * (0.72 + rise * 0.28);
        return center + vec3<f32>(
            cos(angle) * radius,
            -1.72 + rise * 3.72 + sin(angle * 0.5) * 0.16,
            sin(angle) * radius * 0.48
        );
    }
    if (character.z < 1.5) {
        let direction = select(-1.0, 1.0, fract(seed * 71.0) > 0.42);
        let angle = seed * 25.1327412 + time * (0.055 + seed * 0.045) * direction;
        let radius = character.x * (0.92 + sin(time * 0.29 + seed * 37.0) * 0.08);
        let tiltedY = sin(angle * 1.75 + seed * 11.0) * character.y;
        return center + vec3<f32>(
            cos(angle) * radius + tiltedY * 0.18,
            tiltedY,
            sin(angle) * radius * 0.58 - tiltedY * 0.11
        );
    }
    let angle = seed * 43.9822972 + time * (0.012 + seed * 0.016);
    let radius = character.x + sin(time * 0.15 + seed * 53.0) * 0.12;
    return center + vec3<f32>(
        cos(angle) * radius,
        -0.85 + character.y + sin(angle * 2.0 + seed * 29.0) * 0.28,
        sin(angle) * radius * 0.5 - 0.65
    );
}

fn flow(point: vec3<f32>, time: f32, seed: f32) -> vec3<f32> {
    let samplePoint = point * 1.43;
    return safeNormalize(vec3<f32>(
        sin(samplePoint.y * 1.61 + time * 0.31 + seed * 7.0)
            + cos(samplePoint.z * 1.93 - time * 0.17),
        sin(samplePoint.z * 1.77 - time * 0.23 + seed * 5.0)
            + cos(samplePoint.x * 1.31 + time * 0.21),
        sin(samplePoint.x * 1.89 + time * 0.27 + seed * 9.0)
            + cos(samplePoint.y * 1.47 - time * 0.13)
    ));
}

@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x == 0u) {
        drawArguments[0] = ${String(PARTICLE_COUNT * 6)}u;
        drawArguments[1] = 1u;
        drawArguments[2] = 0u;
        drawArguments[3] = 0u;
    }
    if (id.x >= ${String(PARTICLE_COUNT)}u) { return; }

    var particle = particles[id.x];
    var position = particle.positionPhase.xyz;
    var velocity = particle.velocitySeed.xyz;
    let seed = particle.velocitySeed.w;
    let destination = attractionTarget(particle.character, seed, field.centerTime.w);
    let stepTime = min(max(field.viewportMotion.z, 0.0), 0.025) * field.viewportMotion.w;
    let centerDelta = position - field.centerTime.xyz;
    let radialDistance = max(length(centerDelta.xz), 0.08);
    let tangent = vec3<f32>(
        -centerDelta.z / radialDistance,
        0.0,
        centerDelta.x / radialDistance
    );
    var force = (destination - position) * select(0.74, 1.38, particle.character.z < 1.5);
    force += tangent * select(0.13, 0.44, particle.character.z < 1.5);
    force += flow(position, field.centerTime.w, seed)
        * select(0.14, 0.31, particle.character.z < 0.5);

    let moonDistance = length(centerDelta / vec3<f32>(1.0, 1.0, 0.7));
    if (moonDistance < 0.88) {
        force += safeNormalize(centerDelta + vec3<f32>(0.001, 0.002, 0.003))
            * (0.88 - moonDistance)
            * 7.0;
    }

    velocity += force * stepTime;
    velocity *= exp(-stepTime * select(0.92, 1.52, particle.character.z > 1.5));
    let speed = length(velocity);
    if (speed > 2.8) { velocity *= 2.8 / speed; }
    position += velocity * stepTime;
    if (length(position - destination) > 5.5) {
        position = destination;
        velocity = vec3<f32>(0.0);
    }

    particle.positionPhase = vec4<f32>(
        position,
        particle.positionPhase.w + stepTime * (0.8 + seed * 1.8)
    );
    particle.velocitySeed = vec4<f32>(velocity, seed);
    particles[id.x] = particle;
}`,
            bindings: [
                {
                    name: 'field',
                    group: 0,
                    binding: 0,
                    kind: 'uniform-buffer',
                    minBindingSize: fieldLayout.byteLength
                },
                {
                    name: 'particles',
                    group: 0,
                    binding: 1,
                    kind: 'storage-buffer',
                    access: 'read-write',
                    minBindingSize: PARTICLE_BUFFER_BYTE_LENGTH
                },
                {
                    name: 'drawArguments',
                    group: 0,
                    binding: 2,
                    kind: 'storage-buffer',
                    access: 'read-write',
                    minBindingSize: INDIRECT_BUFFER_BYTE_LENGTH
                }
            ],
            entryPoint: 'main',
            workgroupSize: [WORKGROUP_SIZE, 1, 1]
        })
    })
);

const PARTICLE_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Nocturne spectral firefly field',
    shader: new Hilo3d.StorageGraphicsShader({
        label: 'Nocturne spectral firefly field',
        vertexSource: `#version 310 es
precision highp float;
precision highp int;

layout(std140) uniform ${FIELD_BLOCK_NAME} {
    mat4 u_viewProjectionMatrix;
    vec4 u_centerTime;
    vec4 u_viewportMotion;
};
layout(std430) readonly buffer ParticleState {
    vec4 values[];
} particles;

out vec2 v_local;
out vec3 v_color;
out float v_brightness;
out float v_seed;
out float v_family;

vec3 palette(float seed, float family) {
    vec3 amber = vec3(3.4, 0.72, 0.07);
    vec3 pearl = vec3(1.2, 1.55, 2.2);
    vec3 cyan = vec3(0.035, 1.25, 3.8);
    vec3 violet = vec3(1.7, 0.1, 3.0);
    float variation = 0.5 + 0.5 * sin(seed * 97.0 + family * 3.1);
    if (family < 0.5) return mix(amber, cyan, smoothstep(0.18, 0.92, variation));
    if (family < 1.5) return mix(cyan, violet, variation * 0.72);
    return mix(pearl, cyan, variation * 0.38);
}

void main() {
    int particleIndex = int(floor(float(gl_VertexID) / 6.0));
    int localVertexIndex = int(mod(float(gl_VertexID), 6.0));
    int recordIndex = particleIndex * 3;
    vec4 positionPhase = particles.values[recordIndex];
    vec4 velocitySeed = particles.values[recordIndex + 1];
    vec4 character = particles.values[recordIndex + 2];

    vec2 localPosition = vec2(-1.0, -1.0);
    if (localVertexIndex == 1 || localVertexIndex >= 4) localPosition.x = 1.0;
    if (localVertexIndex == 2 || localVertexIndex == 3 || localVertexIndex == 5) {
        localPosition.y = 1.0;
    }
    v_local = localPosition;

    vec4 centerClip = u_viewProjectionMatrix * vec4(positionPhase.xyz, 1.0);
    float speed = length(velocitySeed.xyz);
    float pulse = 0.5 + 0.5 * sin(positionPhase.w * 2.1 + velocitySeed.w * 83.0);
    float rare = pow(max(0.0, sin(velocitySeed.w * 911.0)), 30.0);
    float sizePixels = 0.85
        + character.w * 1.55
        + pulse * 0.45
        + speed * 1.1
        + rare * 3.2;
    vec2 ndcOffset = localPosition
        * sizePixels
        * vec2(2.0 / u_viewportMotion.x, 2.0 / u_viewportMotion.y);
    centerClip.xy += ndcOffset * centerClip.w;
    if (centerClip.w <= 0.02) centerClip = vec4(2.0, 2.0, 2.0, 1.0);
    gl_Position = centerClip;

    v_brightness = character.w * (0.58 + pulse * 0.28 + speed * 0.22 + rare * 0.72);
    v_color = palette(velocitySeed.w, character.z);
    v_seed = velocitySeed.w;
    v_family = character.z;
}`,
        fragmentSource: `#version 310 es
precision highp float;
in vec2 v_local;
in vec3 v_color;
in float v_brightness;
in float v_seed;
in float v_family;
layout(location = 0) out vec4 color;
void main() {
    float radiusSquared = dot(v_local, v_local);
    if (radiusSquared > 1.0) discard;
    float core = exp(-19.0 * radiusSquared);
    float mist = exp(-3.6 * radiusSquared)
        * (1.0 - smoothstep(0.78, 1.0, sqrt(radiusSquared)));
    float rayX = exp(-150.0 * v_local.x * v_local.x)
        * exp(-4.0 * v_local.y * v_local.y);
    float rayY = exp(-150.0 * v_local.y * v_local.y)
        * exp(-4.0 * v_local.x * v_local.x);
    float rare = pow(max(0.0, sin(v_seed * 911.0)), 30.0);
    float familyWeight = v_family < 0.5 ? 0.3 : (v_family < 1.5 ? 0.68 : 0.2);
    float alpha = (
        mist * 0.012
        + core * (0.26 + v_brightness * 0.09)
        + (rayX + rayY) * (0.012 + rare * 0.22)
    ) * familyWeight;
    vec3 emission = mix(v_color, vec3(2.3, 2.15, 1.85), core * (0.18 + rare * 0.3));
    color = vec4(emission * (0.66 + v_brightness * 0.2), alpha);
}`,
        bindings: [
            {
                name: FIELD_BLOCK_NAME,
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: fieldLayout.byteLength
            },
            {
                name: 'particles',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: PARTICLE_BUFFER_BYTE_LENGTH
            }
        ]
    }),
    pipelineState: {
        ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: true,
        depthWrite: false,
        cullMode: 'none',
        blend: Hilo3d.MaterialBlendPreset.STRAIGHT_ALPHA_ADDITIVE
    }
});

class MutableBufferBinding implements Hilo3d.ComputeBufferBinding {
    buffer!: Hilo3d.RenderGraphBufferHandle;
}

class MutableColorAttachment implements Hilo3d.RenderPipelineColorAttachment {
    texture!: Hilo3d.RenderGraphTextureHandle;
    readonly loadOp = 'load';
    readonly storeOp = 'store';
}

class MutableDepthAttachment implements Hilo3d.RenderPipelineDepthStencilAttachment {
    texture!: Hilo3d.RenderGraphTextureHandle;
    readonly depthLoadOp = 'load';
    readonly depthStoreOp = 'store';
}

class MutableIndirectDraw {
    readonly kind = 'draw-indirect';
    buffer!: Hilo3d.RenderGraphBufferHandle;
}

class ComputeParameters implements Hilo3d.ComputeRenderPassParameters {
    readonly uniformBuffers = [fieldBlock];
    readonly buffers = [new MutableBufferBinding(), new MutableBufferBinding()];
    readonly textures: readonly Hilo3d.ComputeTextureBinding[] = Object.freeze([]);
    readonly dispatch = Object.freeze({ x: PARTICLE_COUNT / WORKGROUP_SIZE });

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        argumentsBuffer: Hilo3d.RenderGraphBufferHandle
    ): void {
        const particleBinding = this.buffers[0];
        const argumentBinding = this.buffers[1];
        if (!particleBinding || !argumentBinding) {
            throw new Error('Nocturne compute bindings are unavailable');
        }
        particleBinding.buffer = particles;
        argumentBinding.buffer = argumentsBuffer;
    }
}

class DrawParameters implements Hilo3d.GPUDrivenRenderPassParameters {
    readonly uniformBuffers = [fieldBlock];
    readonly buffers = [new MutableBufferBinding()];
    readonly draw = new MutableIndirectDraw();
    readonly colorAttachments = [new MutableColorAttachment()];
    readonly depthStencilAttachment = new MutableDepthAttachment();

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        argumentsBuffer: Hilo3d.RenderGraphBufferHandle,
        color: Hilo3d.RenderGraphTextureHandle,
        depth: Hilo3d.RenderGraphTextureHandle
    ): void {
        const particleBinding = this.buffers[0];
        const colorAttachment = this.colorAttachments[0];
        if (!particleBinding || !colorAttachment) {
            throw new Error('Nocturne draw bindings are unavailable');
        }
        particleBinding.buffer = particles;
        this.draw.buffer = argumentsBuffer;
        colorAttachment.texture = color;
        this.depthStencilAttachment.texture = depth;
    }
}

class FrameParameters {
    readonly compute = new ComputeParameters();
    readonly draw = new DrawParameters();

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        argumentsBuffer: Hilo3d.RenderGraphBufferHandle,
        color: Hilo3d.RenderGraphTextureHandle,
        depth: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.compute.configure(particles, argumentsBuffer);
        this.draw.configure(particles, argumentsBuffer, color, depth);
    }
}

interface ParticleResources {
    readonly particles: Hilo3d.StorageBuffer;
    readonly argumentsBuffer: Hilo3d.StorageBuffer;
}

class ParticleFeatureRuntime implements Hilo3d.ForwardRenderPipelineFeatureRuntime {
    readonly #parameters = new Hilo3d.RenderPassParameterPool(() => new FrameParameters());
    #resources: ParticleResources | null = null;

    attach(resources: ParticleResources): void {
        if (this.#resources !== null)
            throw new Error('Nocturne particle field is already attached');
        this.#resources = resources;
    }

    record(context: Hilo3d.ForwardRenderFeatureContext): void {
        const resources = this.#resources;
        if (resources === null) throw new Error('Nocturne particle resources are unavailable');
        const color = context.resources.color;
        const depth = context.resources.depth;
        if (color === null || depth === null) {
            throw new Error('Nocturne particles require HDR color and scene depth');
        }
        const particles = context.pipeline.graph.importStorageBuffer(resources.particles);
        const argumentsBuffer = context.pipeline.graph.importStorageBuffer(
            resources.argumentsBuffer
        );
        const parameters = context.pipeline.acquirePassParameters(this.#parameters);
        parameters.configure(particles, argumentsBuffer, color, depth);
        context.pipeline.graph.addPass(COMPUTE_PASS, parameters.compute);
        context.pipeline.graph.addPass(PARTICLE_PASS, parameters.draw);
    }

    destroy(): void {
        this.#resources = null;
    }
}

class ParticleFeature implements Hilo3d.ForwardRenderPipelineFeature {
    readonly name = 'Nocturne compute particle currents';
    readonly injectionPoint = 'before-transparent' as const;
    readonly requirements: Readonly<Hilo3d.ForwardRenderFeatureRequirements> = Object.freeze({
        requiredCapabilities: Object.freeze(['storage-buffer', 'compute-pass', 'indirect-draw']),
        requiredLimits: Object.freeze({
            maxStorageBuffersPerShaderStage: 2,
            maxComputeInvocationsPerWorkgroup: WORKGROUP_SIZE
        }),
        sampledSceneColor: false,
        sampledDepth: false
    } satisfies Hilo3d.ForwardRenderFeatureRequirements);
    #runtime: ParticleFeatureRuntime | null = null;

    get runtime(): ParticleFeatureRuntime {
        const runtime = this.#runtime;
        if (runtime === null) throw new Error('Nocturne particle feature is not initialized');
        return runtime;
    }

    create(_context: Hilo3d.RenderPipelineCreateContext): ParticleFeatureRuntime {
        const runtime = new ParticleFeatureRuntime();
        this.#runtime = runtime;
        return runtime;
    }
}

function deterministicUnit(index: number, salt: number): number {
    let value = (index + salt) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x1_0000_0000;
}

function initialData(centerX: number, centerY: number): Float32Array {
    const data = new Float32Array(PARTICLE_COUNT * FLOATS_PER_PARTICLE);
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        const selector = deterministicUnit(index, 0x45d9f3b);
        const seed = deterministicUnit(index, 0x9e3779b9);
        const progress = deterministicUnit(index, 0x7f4a7c15);
        const angle = seed * TAU * 4 + deterministicUnit(index, 0x31e0f6a7) * TAU;
        const offset = index * FLOATS_PER_PARTICLE;
        const family: 0 | 1 | 2 = selector < 0.58 ? 0 : selector < 0.87 ? 1 : 2;
        const radius =
            family === 0
                ? 0.68 + Math.pow(progress, 0.7) * 1.52
                : family === 1
                  ? 1.02 + progress * 1.38
                  : 2.35 + progress * 2.2;
        const height =
            family === 0
                ? -1.72 + progress * 3.72
                : family === 1
                  ? 0.28 + deterministicUnit(index, 0x68bc21eb) * 0.95
                  : deterministicUnit(index, 0xa24baed4) * 3.4;
        let x: number;
        let y: number;
        let z: number;
        if (family === 0) {
            x = centerX + Math.cos(angle) * radius * (0.72 + progress * 0.28);
            y = centerY + height + Math.sin(angle * 0.5) * 0.16;
            z = Math.sin(angle) * radius * 0.48;
        } else if (family === 1) {
            const tiltedY = Math.sin(angle * 1.75 + seed * 11) * height;
            x = centerX + Math.cos(angle) * radius + tiltedY * 0.18;
            y = centerY + tiltedY;
            z = Math.sin(angle) * radius * 0.58 - tiltedY * 0.11;
        } else {
            x = centerX + Math.cos(angle) * radius;
            y = centerY - 0.85 + height + Math.sin(angle * 2) * 0.28;
            z = Math.sin(angle) * radius * 0.5 - 0.65;
        }
        const brightness = 0.35 + deterministicUnit(index, 0x85ebca6b) * 0.65;
        data[offset] = x;
        data[offset + 1] = y;
        data[offset + 2] = z;
        data[offset + 3] = seed * TAU;
        data[offset + 4] = 0;
        data[offset + 5] = 0;
        data[offset + 6] = 0;
        data[offset + 7] = seed;
        data[offset + 8] = radius;
        data[offset + 9] = height;
        data[offset + 10] = family;
        data[offset + 11] = brightness;
    }
    return data;
}

export class BloomParticleField {
    readonly feature = new ParticleFeature();
    readonly #centerTime = new Float32Array(4);
    readonly #viewportMotion = new Float32Array(4);
    #particles: Hilo3d.StorageBuffer | null = null;
    #argumentsBuffer: Hilo3d.StorageBuffer | null = null;

    attach(renderer: Hilo3d.Renderer<'webgpu'>, centerX: number, centerY: number): void {
        if (this.#particles !== null || this.#argumentsBuffer !== null) {
            throw new Error('Nocturne particle field is already attached');
        }
        const particles = renderer.createStorageBuffer({
            label: 'Nocturne persistent compute particle state',
            byteLength: PARTICLE_BUFFER_BYTE_LENGTH,
            usage: ['storage'],
            initialData: initialData(centerX, centerY),
            recovery: 'cpu-shadow'
        });
        const argumentsBuffer = renderer.createStorageBuffer({
            label: 'Nocturne GPU-authored particle draw arguments',
            byteLength: INDIRECT_BUFFER_BYTE_LENGTH,
            usage: ['storage', 'indirect'],
            initialData: new Uint32Array([PARTICLE_COUNT * 6, 1, 0, 0]),
            recovery: 'cpu-shadow'
        });
        this.#particles = particles;
        this.#argumentsBuffer = argumentsBuffer;
        this.feature.runtime.attach({ particles, argumentsBuffer });
    }

    update(
        camera: Hilo3d.PerspectiveCamera,
        renderer: Hilo3d.Renderer<'webgpu'>,
        centerX: number,
        centerY: number,
        elapsed: number,
        deltaTime: number,
        moving: boolean
    ): void {
        camera.updateViewProjectionMatrix();
        this.#centerTime[0] = centerX;
        this.#centerTime[1] = centerY;
        this.#centerTime[2] = 0;
        this.#centerTime[3] = elapsed;
        this.#viewportMotion[0] = renderer.width;
        this.#viewportMotion[1] = renderer.height;
        this.#viewportMotion[2] = Math.min(Math.max(deltaTime * 0.001, 0), 0.025);
        this.#viewportMotion[3] = moving ? 1 : 0;
        fieldBlock.set('u_viewProjectionMatrix', camera.viewProjectionMatrix.elements);
        fieldBlock.set('u_centerTime', this.#centerTime);
        fieldBlock.set('u_viewportMotion', this.#viewportMotion);
    }

    destroy(): void {
        this.#particles?.destroy();
        this.#argumentsBuffer?.destroy();
        this.#particles = null;
        this.#argumentsBuffer = null;
    }
}
