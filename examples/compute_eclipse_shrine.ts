import * as Hilo3d from '../src/Hilo3d';
import { applyEnvironmentMaps } from './shared/environment';
import { loadEnvironmentMaps } from './shared/init';

const PARTICLE_COUNT = 65_536;
const PARTICLE_WORKGROUP_SIZE = 64;
const PARTICLE_FLOATS_PER_RECORD = 16;
const PARTICLE_BUFFER_BYTE_LENGTH = PARTICLE_COUNT * PARTICLE_FLOATS_PER_RECORD * 4;
const INDIRECT_BUFFER_BYTE_LENGTH = 16;
const TAU = Math.PI * 2;
const IS_TEST_MODE = new URLSearchParams(window.location.search).get('test') === '1';
const ACTIVE_PARTICLE_COUNT = IS_TEST_MODE ? 4_096 : PARTICLE_COUNT;
const ACTIVE_PARTICLE_WORKGROUP_COUNT = ACTIVE_PARTICLE_COUNT / PARTICLE_WORKGROUP_SIZE;
const FIELD_BLOCK_NAME = 'EclipseFieldBlock';
const REQUIRED_CAPABILITIES: readonly Hilo3d.RenderPipelineCapabilityName[] = Object.freeze([
    'storage-buffer',
    'compute-pass',
    'indirect-draw'
]);

Hilo3d.registerUniformBlockBinding(FIELD_BLOCK_NAME);
const fieldLayout = Hilo3d.createStd140Layout({
    u_viewMatrix: 'mat4',
    u_projectionMatrix: 'mat4',
    u_viewProjectionMatrix: 'mat4',
    u_cameraTime: 'vec4',
    u_pointerWorld: 'vec4',
    u_interaction: 'vec4',
    u_viewport: 'vec4'
});
const fieldBlock = Hilo3d.UniformBuffer.fromSchema(fieldLayout);

const PARTICLE_COMPUTE_PASS = new Hilo3d.ComputeRenderPass(
    new Hilo3d.ComputeKernel({
        label: 'Eclipse Shrine gravitational particle simulation',
        shader: new Hilo3d.ComputeShader({
            label: 'Eclipse Shrine gravitational particle simulation',
            source: `
struct FieldBlock {
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    viewProjectionMatrix: mat4x4<f32>,
    cameraTime: vec4<f32>,
    pointerWorld: vec4<f32>,
    interaction: vec4<f32>,
    viewport: vec4<f32>,
};

struct Particle {
    positionPhase: vec4<f32>,
    velocitySeed: vec4<f32>,
    orbitMeta: vec4<f32>,
    previousEnergy: vec4<f32>,
};

@group(0) @binding(0) var<uniform> field: FieldBlock;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> drawArguments: array<u32>;

fn safeNormalize(value: vec3<f32>) -> vec3<f32> {
    return value / max(length(value), 0.0001);
}

fn flowField(point: vec3<f32>, time: f32, seed: f32) -> vec3<f32> {
    let samplePoint = point * 1.36;
    let flow = vec3<f32>(
        sin(samplePoint.y * 1.73 + time * 0.41 + seed * 9.1)
            + cos(samplePoint.z * 2.17 - time * 0.23),
        sin(samplePoint.z * 1.91 - time * 0.31 + seed * 5.7)
            + cos(samplePoint.x * 1.37 + time * 0.29),
        sin(samplePoint.x * 2.03 + time * 0.37 + seed * 7.3)
            + cos(samplePoint.y * 1.61 - time * 0.19)
    );
    let detail = vec3<f32>(
        sin((samplePoint.y + samplePoint.z) * 3.7 + seed * 17.0),
        cos((samplePoint.z - samplePoint.x) * 3.3 + seed * 13.0),
        sin((samplePoint.x + samplePoint.y) * 3.9 - seed * 11.0)
    );
    return safeNormalize(flow + detail * 0.28);
}

fn diskTarget(orbit: vec4<f32>, seed: f32, time: f32) -> vec3<f32> {
    let direction = select(-1.0, 1.0, fract(seed * 37.17) > 0.34);
    let angle = seed * 18.8495559 + time * (0.14 + seed * 0.08) * direction;
    let radialBreath = 1.0
        + sin(time * 0.37 + seed * 31.0) * 0.065
        + sin(angle * 3.0 + seed * 19.0) * 0.035;
    let radius = orbit.x * radialBreath;
    let vertical = orbit.y * (0.25 + orbit.x * 0.12)
        + sin(angle * 2.0 + seed * 23.0) * 0.11;
    let warp = sin(angle + time * 0.11) * orbit.y * 0.32;
    return vec3<f32>(
        cos(angle) * radius,
        vertical + warp,
        sin(angle) * radius
    );
}

fn veilTarget(orbit: vec4<f32>, seed: f32, time: f32) -> vec3<f32> {
    let angle = seed * 25.1327412 + time * (0.065 + seed * 0.035);
    let lobe = 1.62 + orbit.x * 0.72 + sin(angle * 3.0 + seed * 15.0) * 0.18;
    let twist = angle * 1.5 + sin(time * 0.17 + seed * 21.0) * 0.45;
    let destination = vec3<f32>(
        cos(angle) * lobe,
        sin(twist) * (0.72 + abs(orbit.y) * 0.75),
        sin(angle) * lobe
    );
    return vec3<f32>(
        destination.x + destination.y * 0.18,
        destination.y,
        destination.z - destination.y * 0.13
    );
}

fn jetTarget(orbit: vec4<f32>, seed: f32, time: f32) -> vec3<f32> {
    let progress = fract(seed * 11.31 + time * (0.045 + seed * 0.018));
    let direction = select(-1.0, 1.0, fract(seed * 71.0) > 0.5);
    let height = direction * (0.52 + progress * 3.5);
    let radius = 0.08 + progress * (0.18 + orbit.x * 0.055);
    let angle = seed * 44.0 + time * (1.2 + seed * 0.8) * direction;
    return vec3<f32>(
        cos(angle) * radius,
        height,
        sin(angle) * radius
    );
}

@compute @workgroup_size(${String(PARTICLE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x == 0u) {
        drawArguments[0] = ${String(ACTIVE_PARTICLE_COUNT * 6)}u;
        drawArguments[1] = 1u;
        drawArguments[2] = 0u;
        drawArguments[3] = 0u;
    }
    if (id.x >= ${String(ACTIVE_PARTICLE_COUNT)}u) { return; }

    var particle = particles[id.x];
    var position = particle.positionPhase.xyz;
    var velocity = particle.velocitySeed.xyz;
    let seed = particle.velocitySeed.w;
    let family = particle.orbitMeta.z;
    let time = field.cameraTime.w;
    let stepTime = min(max(field.interaction.w, 0.0001), 0.025);
    let previousPosition = position;
    let previousEnergy = particle.previousEnergy.w;

    var destination: vec3<f32>;
    var targetStrength: f32;
    if (family < 0.5) {
        destination = diskTarget(particle.orbitMeta, seed, time);
        targetStrength = 1.65;
    } else if (family < 1.5) {
        destination = veilTarget(particle.orbitMeta, seed, time);
        targetStrength = 0.86;
    } else {
        destination = jetTarget(particle.orbitMeta, seed, time);
        targetStrength = 2.25;
    }

    let radialDistance = max(length(position.xz), 0.08);
    let tangent = vec3<f32>(-position.z / radialDistance, 0.0, position.x / radialDistance);
    let orbitDirection = select(-1.0, 1.0, fract(seed * 37.17) > 0.34);
    var force = (destination - position) * targetStrength;
    force += tangent * orbitDirection * select(0.18, 0.62, family < 0.5);
    force += flowField(position, time, seed)
        * select(0.48, 0.2, family > 1.5)
        * (0.7 + particle.orbitMeta.w * 0.3);

    let coreDistance = length(position);
    if (coreDistance < 0.92) {
        force += safeNormalize(position + vec3<f32>(0.001, 0.002, 0.003))
            * (0.92 - coreDistance)
            * 8.0;
    }

    if (field.pointerWorld.w > 0.5) {
        let pointerDelta = field.pointerWorld.xyz - position;
        let pointerDistanceSquared = max(dot(pointerDelta, pointerDelta), 0.035);
        let pointerDistance = sqrt(pointerDistanceSquared);
        let pointerDirection = pointerDelta / pointerDistance;
        let lens = exp(-pointerDistanceSquared * 0.42);
        let familyResponse = select(0.62, 1.0, family < 1.5);
        force += pointerDirection
            * lens
            * (1.2 + field.interaction.y * 0.18)
            * familyResponse;
        let pulse = field.interaction.x;
        force -= pointerDirection
            * pulse
            * (3.8 / (0.16 + pointerDistanceSquared))
            * familyResponse;
        force += cross(pointerDirection, safeNormalize(field.cameraTime.xyz))
            * lens
            * pulse
            * 1.8;
    }

    velocity += force * stepTime;
    velocity *= exp(-stepTime * select(1.05, 1.72, family > 1.5));
    let speed = length(velocity);
    if (speed > 3.8) {
        velocity *= 3.8 / speed;
    }
    position += velocity * stepTime;

    if (length(position) > 7.0) {
        position = destination;
        velocity = vec3<f32>(0.0);
    }

    let energy = clamp(
        length(velocity) * 0.42
            + length(force) * 0.035
            + field.interaction.x * exp(-length(field.pointerWorld.xyz - position)),
        0.0,
        2.5
    );
    particle.positionPhase = vec4<f32>(
        position,
        particle.positionPhase.w + stepTime * (1.0 + seed * 2.0)
    );
    particle.velocitySeed = vec4<f32>(velocity, seed);
    particle.previousEnergy = vec4<f32>(
        previousPosition,
        mix(previousEnergy, energy, 0.16)
    );
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
            workgroupSize: [PARTICLE_WORKGROUP_SIZE, 1, 1]
        })
    })
);

function particleRasterShader(label: string, passMode: 0 | 1 | 2): Hilo3d.StorageGraphicsShader {
    const pixelOffsetSource =
        passMode === 0
            ? `float haloSize = (5.0 + sizeSeed * 4.5 + energy * 3.0) * perspectiveScale;
    vec2 pixelOffset = localPosition * haloSize;`
            : passMode === 1
              ? `float motionPixels = length(screenMotion) * u_viewport.y;
    float ribbonLength = clamp(
        4.0 + motionPixels * 1.45 + energy * 11.0,
        5.0,
        48.0
    ) * perspectiveScale;
    float ribbonWidth = (0.55 + sizeSeed * 0.54 + energy * 0.25) * perspectiveScale;
    vec2 pixelOffset = tangent * localPosition.x * ribbonLength
        + normal * localPosition.y * ribbonWidth;`
              : `float sparkSize = (1.15 + sizeSeed * 1.7 + energy * 1.25) * perspectiveScale;
    vec2 pixelOffset = localPosition * sparkSize;`;
    const fragmentBody =
        passMode === 0
            ? `if (radiusSquared > 1.0) discard;
    float halo = exp(-3.2 * radiusSquared) * (1.0 - smoothstep(0.72, 1.0, radiusSquared));
    float corona = exp(-10.0 * abs(sqrt(radiusSquared) - 0.34));
    float alpha = halo * (0.005 + v_energy * 0.004)
        + corona * max(0.0, v_energy - 0.45) * 0.003;
    vec3 emission = v_color * (0.62 + v_energy * 0.18);
    color = vec4(emission, alpha * v_depthFade);`
            : passMode === 1
              ? `float across = exp(-9.0 * v_local.y * v_local.y);
    float along = 1.0 - smoothstep(0.58, 1.0, abs(v_local.x));
    float hotThread = exp(-46.0 * v_local.y * v_local.y) * along;
    float alpha = across * along * (0.016 + v_energy * 0.058)
        + hotThread * (0.012 + v_energy * 0.038);
    vec3 emission = v_color * (0.72 + hotThread * 0.92);
    color = vec4(emission, alpha * v_depthFade);`
              : `if (radiusSquared > 1.0) discard;
    float core = exp(-18.0 * radiusSquared);
    float rayX = exp(-135.0 * v_local.x * v_local.x)
        * exp(-3.2 * v_local.y * v_local.y);
    float rayY = exp(-135.0 * v_local.y * v_local.y)
        * exp(-3.2 * v_local.x * v_local.x);
    float rare = pow(max(0.0, sin(v_seed * 921.0 + v_family * 4.0)), 28.0);
    float alpha = core * (0.22 + v_energy * 0.16)
        + (rayX + rayY) * (0.016 + rare * 0.32 + v_energy * 0.02);
    vec3 emission = mix(v_color, vec3(2.2, 2.35, 2.6), core * 0.42 + rare * 0.3);
    color = vec4(emission, alpha * v_depthFade);`;
    return new Hilo3d.StorageGraphicsShader({
        label,
        vertexSource: `#version 310 es
precision highp float;
precision highp int;

layout(std140) uniform ${FIELD_BLOCK_NAME} {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
    vec4 u_cameraTime;
    vec4 u_pointerWorld;
    vec4 u_interaction;
    vec4 u_viewport;
};

layout(std430) readonly buffer ParticleState {
    vec4 values[];
} particles;

out vec2 v_local;
out vec3 v_color;
out float v_energy;
out float v_family;
out float v_seed;
out float v_depthFade;

vec3 spectralPalette(float seed, float family, float paletteIndex, float energy) {
    vec3 amber = vec3(2.05, 0.68, 0.14);
    vec3 pearl = vec3(0.82, 1.18, 1.62);
    vec3 cyan = vec3(0.08, 0.88, 1.82);
    vec3 violet = vec3(0.94, 0.12, 1.92);
    vec3 rose = vec3(1.92, 0.13, 0.68);
    vec3 ice = vec3(0.22, 1.14, 1.95);
    float variation = 0.5 + 0.5 * sin(seed * 91.0 + family * 2.4);
    vec3 color;
    if (paletteIndex < 0.5) {
        color = mix(amber, cyan, smoothstep(0.15, 0.92, variation + family * 0.16));
        color = mix(color, pearl, smoothstep(1.35, 2.0, family));
    } else if (paletteIndex < 1.5) {
        color = mix(violet, rose, variation);
        color = mix(color, ice, smoothstep(0.65, 1.8, family) * 0.45);
    } else {
        color = mix(ice, pearl, variation * 0.72);
        color = mix(color, violet, smoothstep(1.4, 2.0, family) * 0.28);
    }
    return color * (0.72 + energy * 0.24);
}

void main() {
    int particleIndex = int(floor(float(gl_VertexID) / 6.0));
    int localVertexIndex = int(mod(float(gl_VertexID), 6.0));
    int recordIndex = particleIndex * 4;
    vec4 positionPhase = particles.values[recordIndex];
    vec4 velocitySeed = particles.values[recordIndex + 1];
    vec4 orbitMeta = particles.values[recordIndex + 2];
    vec4 previousEnergy = particles.values[recordIndex + 3];

    vec2 localPosition = vec2(-1.0, -1.0);
    if (localVertexIndex == 1 || localVertexIndex >= 4) localPosition.x = 1.0;
    if (localVertexIndex == 2 || localVertexIndex == 3 || localVertexIndex == 5) {
        localPosition.y = 1.0;
    }
    v_local = localPosition;

    vec4 centerView = u_viewMatrix * vec4(positionPhase.xyz, 1.0);
    vec4 centerClip = u_projectionMatrix * centerView;
    vec4 previousClip = u_viewProjectionMatrix * vec4(previousEnergy.xyz, 1.0);
    vec2 centerNdc = centerClip.xy / max(centerClip.w, 0.0001);
    vec2 previousNdc = previousClip.xy / max(previousClip.w, 0.0001);
    vec2 screenMotion = (centerNdc - previousNdc) * vec2(u_viewport.x / u_viewport.y, 1.0);
    vec2 tangent = length(screenMotion) > 0.00002
        ? normalize(screenMotion)
        : normalize(vec2(-positionPhase.z, positionPhase.x) + vec2(0.001, 0.0));
    vec2 normal = vec2(-tangent.y, tangent.x);

    float depth = max(-centerView.z, 0.2);
    float perspectiveScale = clamp(6.4 / depth, 0.34, 2.4);
    float energy = clamp(previousEnergy.w, 0.0, 2.5);
    float sizeSeed = 0.66 + orbitMeta.w * 0.72;
    ${pixelOffsetSource}

    vec2 ndcOffset = pixelOffset * vec2(2.0 / u_viewport.x, 2.0 / u_viewport.y);
    centerClip.xy += ndcOffset * centerClip.w;
    if (centerClip.w <= 0.02) {
        centerClip = vec4(2.0, 2.0, 2.0, 1.0);
    }
    gl_Position = centerClip;

    v_energy = energy;
    v_family = orbitMeta.z;
    v_seed = velocitySeed.w;
    v_depthFade = smoothstep(24.0, 2.0, depth);
    v_color = spectralPalette(
        velocitySeed.w,
        orbitMeta.z,
        u_interaction.z,
        energy
    );
}`,
        fragmentSource: `#version 310 es
precision highp float;

in vec2 v_local;
in vec3 v_color;
in float v_energy;
in float v_family;
in float v_seed;
in float v_depthFade;
layout(location = 0) out vec4 color;

void main() {
    float radiusSquared = dot(v_local, v_local);
    ${fragmentBody}
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
    });
}

function particleMaterial(depthTest: boolean): Hilo3d.Material {
    return new Hilo3d.Material({
        transparent: true,
        premultiplyAlpha: false,
        blend: true,
        blendSrc: Hilo3d.constants.SRC_ALPHA,
        blendDst: Hilo3d.constants.ONE,
        blendSrcAlpha: Hilo3d.constants.ONE,
        blendDstAlpha: Hilo3d.constants.ONE,
        depthTest,
        depthMask: false,
        cullFace: false
    });
}

const PARTICLE_HALO_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Eclipse atmospheric particle corona',
    shader: particleRasterShader('Eclipse atmospheric particle corona', 0),
    material: particleMaterial(true)
});
const PARTICLE_RIBBON_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Eclipse velocity filament ribbons',
    shader: particleRasterShader('Eclipse velocity filament ribbons', 1),
    material: particleMaterial(true)
});
const PARTICLE_SPARK_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Eclipse spectral particle sparks',
    shader: particleRasterShader('Eclipse spectral particle sparks', 2),
    material: particleMaterial(true)
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

class EclipseComputeParameters implements Hilo3d.ComputeRenderPassParameters {
    readonly uniformBuffers = [fieldBlock];
    readonly buffers = [new MutableBufferBinding(), new MutableBufferBinding()];
    readonly textures = [];
    readonly dispatch = Object.freeze({ x: ACTIVE_PARTICLE_WORKGROUP_COUNT });

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        argumentsBuffer: Hilo3d.RenderGraphBufferHandle
    ): void {
        const particleBinding = this.buffers[0];
        const argumentBinding = this.buffers[1];
        if (!particleBinding || !argumentBinding) {
            throw new Error('Eclipse compute buffer bindings are unavailable');
        }
        particleBinding.buffer = particles;
        argumentBinding.buffer = argumentsBuffer;
    }
}

class EclipseDrawParameters implements Hilo3d.GPUDrivenRenderPassParameters {
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
            throw new Error('Eclipse draw bindings are unavailable');
        }
        particleBinding.buffer = particles;
        this.draw.buffer = argumentsBuffer;
        colorAttachment.texture = color;
        this.depthStencilAttachment.texture = depth;
    }
}

class EclipseFrameParameters {
    readonly compute = new EclipseComputeParameters();
    readonly halo = new EclipseDrawParameters();
    readonly ribbons = new EclipseDrawParameters();
    readonly sparks = new EclipseDrawParameters();

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        argumentsBuffer: Hilo3d.RenderGraphBufferHandle,
        color: Hilo3d.RenderGraphTextureHandle,
        depth: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.compute.configure(particles, argumentsBuffer);
        this.halo.configure(particles, argumentsBuffer, color, depth);
        this.ribbons.configure(particles, argumentsBuffer, color, depth);
        this.sparks.configure(particles, argumentsBuffer, color, depth);
    }
}

interface EclipseOwnedResources {
    readonly particles: Hilo3d.StorageBuffer;
    readonly argumentsBuffer: Hilo3d.StorageBuffer;
}

class EclipseParticleFeatureRuntime implements Hilo3d.ForwardRenderPipelineFeatureRuntime {
    readonly #parameters = new Hilo3d.RenderPassParameterPool(() => new EclipseFrameParameters());
    #resources: EclipseOwnedResources | null = null;

    attach(resources: EclipseOwnedResources): void {
        if (this.#resources !== null) {
            throw new Error('Eclipse particle resources are already attached');
        }
        this.#resources = resources;
    }

    record(context: Hilo3d.ForwardRenderFeatureContext): void {
        const resources = this.#resources;
        if (resources === null) throw new Error('Eclipse particle resources are unavailable');
        const color = context.resources.color;
        const depth = context.resources.depth;
        if (color === null || depth === null) {
            throw new Error('Eclipse particle feature requires HDR color and scene depth');
        }
        const particles = context.pipeline.graph.importStorageBuffer(resources.particles);
        const argumentsBuffer = context.pipeline.graph.importStorageBuffer(
            resources.argumentsBuffer
        );
        const parameters = context.pipeline.acquirePassParameters(this.#parameters);
        parameters.configure(particles, argumentsBuffer, color, depth);
        context.pipeline.graph.addPass(PARTICLE_COMPUTE_PASS, parameters.compute);
        context.pipeline.graph.addPass(PARTICLE_HALO_PASS, parameters.halo);
        context.pipeline.graph.addPass(PARTICLE_RIBBON_PASS, parameters.ribbons);
        context.pipeline.graph.addPass(PARTICLE_SPARK_PASS, parameters.sparks);
    }

    destroy(): void {
        this.#resources = null;
    }
}

class EclipseParticleFeature implements Hilo3d.ForwardRenderPipelineFeature {
    readonly name = 'Eclipse Shrine compute field';
    readonly injectionPoint = 'before-transparent';
    readonly requirements: Readonly<Hilo3d.ForwardRenderFeatureRequirements> = Object.freeze({
        requiredCapabilities: REQUIRED_CAPABILITIES,
        requiredLimits: Object.freeze({
            maxStorageBuffersPerShaderStage: 2,
            maxComputeInvocationsPerWorkgroup: PARTICLE_WORKGROUP_SIZE
        }),
        sampledSceneColor: false,
        sampledDepth: false
    });
    #runtime: EclipseParticleFeatureRuntime | null = null;

    get runtime(): EclipseParticleFeatureRuntime {
        const runtime = this.#runtime;
        if (runtime === null) throw new Error('Eclipse particle feature is not initialized');
        return runtime;
    }

    create(_context: Hilo3d.RenderPipelineCreateContext): EclipseParticleFeatureRuntime {
        const runtime = new EclipseParticleFeatureRuntime();
        this.#runtime = runtime;
        return runtime;
    }
}

class EclipseTestPipeline implements Hilo3d.RenderPipeline {
    readonly name = 'Eclipse Shrine portable test field';
    readonly #parameters = new Hilo3d.RenderPassParameterPool(() => new EclipseFrameParameters());
    #resources: EclipseOwnedResources | null = null;

    attach(resources: EclipseOwnedResources): void {
        this.#resources = resources;
    }

    record(context: Hilo3d.RenderPipelineContext): void {
        const resources = this.#resources;
        if (resources === null) throw new Error('Eclipse test resources are unavailable');
        const output = context.graph.importOutput();
        const depth = output.depthStencil;
        if (depth === null) throw new Error('Eclipse test field requires scene depth');
        const particles = context.graph.importStorageBuffer(resources.particles);
        const argumentsBuffer = context.graph.importStorageBuffer(resources.argumentsBuffer);
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.configure(particles, argumentsBuffer, output.color(0), depth);
        context.graph.addPass(PARTICLE_COMPUTE_PASS, parameters.compute);
        context.graph.addPass(PARTICLE_SPARK_PASS, parameters.halo);
        context.graph.addPass(PARTICLE_SPARK_PASS, parameters.ribbons);
        context.graph.addPass(PARTICLE_SPARK_PASS, parameters.sparks);
    }

    destroy(): void {
        this.#resources = null;
    }
}

class EclipseTestPipelineFactory implements Hilo3d.RenderPipelineFactory {
    readonly name = 'Eclipse Shrine portable test field';
    readonly requirements: Readonly<Hilo3d.RenderPipelineRequirements> = Object.freeze({
        requiredCapabilities: REQUIRED_CAPABILITIES,
        requiredLimits: Object.freeze({
            maxStorageBuffersPerShaderStage: 2,
            maxComputeInvocationsPerWorkgroup: PARTICLE_WORKGROUP_SIZE
        })
    });
    readonly runtime = new EclipseTestPipeline();

    create(): EclipseTestPipeline {
        return this.runtime;
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

function particleInitialData(): Float32Array {
    const data = new Float32Array(PARTICLE_COUNT * PARTICLE_FLOATS_PER_RECORD);
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        const selector = deterministicUnit(index, 0x45d9f3b);
        const seed = deterministicUnit(index, 0x9e3779b9);
        const band = deterministicUnit(index, 0x7f4a7c15) * 2 - 1;
        const angle = seed * TAU * 3 + deterministicUnit(index, 0x31e0f6a7) * TAU;
        const offset = index * PARTICLE_FLOATS_PER_RECORD;
        let family: 0 | 1 | 2;
        let radius: number;
        let x: number;
        let y: number;
        let z: number;

        if (selector < 0.62) {
            family = 0;
            radius =
                0.92 +
                Math.pow(deterministicUnit(index, 0x68bc21eb), 0.72) * 2.2 +
                Math.sin(seed * 57) * 0.08;
            x = Math.cos(angle) * radius;
            y = band * (0.18 + radius * 0.1);
            z = Math.sin(angle) * radius;
        } else if (selector < 0.96) {
            family = 1;
            radius = 1.45 + deterministicUnit(index, 0xa24baed4) * 1.35;
            const twist = angle * 1.5 + seed * 12;
            x = Math.cos(angle) * radius + Math.sin(twist) * 0.14;
            y = Math.sin(twist) * (0.72 + Math.abs(band) * 0.7);
            z = Math.sin(angle) * radius - Math.sin(twist) * 0.1;
        } else {
            family = 2;
            radius = 0.2 + deterministicUnit(index, 0x4f1bbcdc) * 1.35;
            const heightDirection = deterministicUnit(index, 0x2e2ac13b) > 0.5 ? 1 : -1;
            const height = heightDirection * (0.5 + deterministicUnit(index, 0x967a889b) * 3.4);
            const jetRadius = 0.08 + Math.abs(height) * 0.045;
            x = Math.cos(angle) * jetRadius;
            y = height;
            z = Math.sin(angle) * jetRadius;
        }

        const jitter = 0.035 + deterministicUnit(index, 0x1b56c4e9) * 0.09;
        x += (deterministicUnit(index, 0x6d2b79f5) - 0.5) * jitter;
        y += (deterministicUnit(index, 0x51ed270b) - 0.5) * jitter;
        z += (deterministicUnit(index, 0x23d5f481) - 0.5) * jitter;
        const orbitDirection = deterministicUnit(index, 0x3c6ef372) > 0.34 ? 1 : -1;
        const tangentSpeed = family === 0 ? 0.24 + seed * 0.24 : 0.035 + seed * 0.07;
        const inverseRadius = 1 / Math.max(Math.hypot(x, z), 0.1);

        data[offset] = x;
        data[offset + 1] = y;
        data[offset + 2] = z;
        data[offset + 3] = seed * TAU;
        data[offset + 4] = -z * inverseRadius * tangentSpeed * orbitDirection;
        data[offset + 5] = family === 2 ? (y > 0 ? 0.25 : -0.25) : 0;
        data[offset + 6] = x * inverseRadius * tangentSpeed * orbitDirection;
        data[offset + 7] = seed;
        data[offset + 8] = radius;
        data[offset + 9] = band;
        data[offset + 10] = family;
        data[offset + 11] = 0.55 + deterministicUnit(index, 0x85ebca6b) * 0.95;
        data[offset + 12] = x;
        data[offset + 13] = y;
        data[offset + 14] = z;
        data[offset + 15] = deterministicUnit(index, 0xc2b2ae35) * 0.25;
    }
    return data;
}

function createSkyMaterial(): Hilo3d.ShaderMaterial {
    return new Hilo3d.ShaderMaterial({
        shaderCacheId: 'EclipseShrineProceduralSky',
        attributes: { a_position: 'POSITION' },
        depthTest: false,
        depthMask: false,
        cullFace: true,
        side: Hilo3d.constants.BACK,
        castShadows: false,
        receiveShadows: false,
        renderOrder: -1000,
        vs: `#version 300 es
precision highp float;
in vec3 a_position;
out vec3 v_direction;
layout(std140) uniform CameraBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_viewProjectionMatrix;
};
void main() {
    v_direction = a_position;
    vec4 clip = u_projectionMatrix * vec4(mat3(u_viewMatrix) * a_position, 1.0);
    gl_Position = clip.xyww;
}`,
        fs: `#version 300 es
precision highp float;
in vec3 v_direction;
layout(location = 0) out vec4 color;
layout(std140) uniform FrameBlock {
    vec2 u_rendererSize;
    float u_time;
    float u_frameIndex;
};

float hash31(vec3 point) {
    point = fract(point * 0.1031);
    point += dot(point, point.yzx + 33.33);
    return fract((point.x + point.y) * point.z);
}

float noise3(vec3 point) {
    vec3 cell = floor(point);
    vec3 local = fract(point);
    vec3 curve = local * local * (3.0 - 2.0 * local);
    float x00 = mix(hash31(cell), hash31(cell + vec3(1.0, 0.0, 0.0)), curve.x);
    float x10 = mix(
        hash31(cell + vec3(0.0, 1.0, 0.0)),
        hash31(cell + vec3(1.0, 1.0, 0.0)),
        curve.x
    );
    float x01 = mix(
        hash31(cell + vec3(0.0, 0.0, 1.0)),
        hash31(cell + vec3(1.0, 0.0, 1.0)),
        curve.x
    );
    float x11 = mix(
        hash31(cell + vec3(0.0, 1.0, 1.0)),
        hash31(cell + vec3(1.0, 1.0, 1.0)),
        curve.x
    );
    return mix(mix(x00, x10, curve.y), mix(x01, x11, curve.y), curve.z);
}

float nebula(vec3 direction, float time) {
    vec3 samplePoint = direction * 3.4 + vec3(time * 0.018, -time * 0.012, 0.0);
    float value = noise3(samplePoint) * 0.58;
    samplePoint = samplePoint * 2.07 + vec3(4.1, 7.3, 2.7);
    value += noise3(samplePoint) * 0.28;
    samplePoint = samplePoint * 2.11 + vec3(1.7, 5.9, 8.2);
    value += noise3(samplePoint) * 0.14;
    return value;
}

void main() {
    vec3 direction = normalize(v_direction);
    float time = u_time * 0.001;
    float primary = nebula(direction + vec3(0.08, 0.16, 0.0), time);
    float secondary = nebula(
        direction.yzx * vec3(-1.0, 1.0, 1.0) + vec3(0.18, -0.08, 0.12),
        -time * 0.67
    );
    float ribbon = smoothstep(0.53, 0.83, primary)
        * smoothstep(0.42, 0.78, secondary);
    float dust = smoothstep(0.44, 0.8, primary) * (0.35 + secondary * 0.65);
    vec3 base = vec3(0.0015, 0.0025, 0.008);
    base += vec3(0.018, 0.026, 0.075) * dust;
    base += vec3(0.05, 0.018, 0.075) * ribbon * 0.34;
    base += vec3(0.014, 0.07, 0.095) * smoothstep(0.62, 0.92, secondary) * 0.22;

    vec3 starCell = floor(direction * 520.0);
    float starSeed = hash31(starCell);
    float star = smoothstep(0.9974, 1.0, starSeed);
    float starHeat = hash31(starCell + 17.4);
    float twinkle = 0.76 + 0.24 * sin(time * (0.7 + starHeat * 1.7) + starSeed * 91.0);
    vec3 starColor = mix(
        vec3(0.42, 0.68, 1.35),
        vec3(1.55, 0.94, 0.5),
        starHeat
    );
    base += starColor * star * twinkle * (0.4 + starHeat * 2.4);

    float horizon = pow(max(0.0, 1.0 - abs(direction.y + 0.22)), 12.0);
    base += vec3(0.025, 0.038, 0.09) * horizon;
    color = vec4(base, 1.0);
}`
    });
}

function createRingGeometry(segments = 160): Hilo3d.Geometry {
    const geometry = new Hilo3d.Geometry({ mode: Hilo3d.constants.LINES });
    for (let segment = 0; segment < segments; segment += 1) {
        const angle0 = (segment / segments) * TAU;
        const angle1 = ((segment + 1) / segments) * TAU;
        const radius0 = 1.18 + Math.sin(angle0 * 7) * 0.018;
        const radius1 = 1.18 + Math.sin(angle1 * 7) * 0.018;
        geometry.addPoints(
            [Math.cos(angle0) * radius0, Math.sin(angle0) * radius0, 0],
            [Math.cos(angle1) * radius1, Math.sin(angle1) * radius1, 0]
        );
        geometry.addIndices(segment * 2, segment * 2 + 1);
    }
    return geometry;
}

function createScene(stage: Hilo3d.Stage): Promise<Hilo3d.Node> {
    return loadEnvironmentMaps().then(environment => {
        const root = new Hilo3d.Node({ name: 'Eclipse Shrine sculptural assembly' }).addTo(stage);
        const coreMaterial = new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.008, 0.012, 0.025),
            metallic: 0.98,
            roughness: 0.1,
            castShadows: true,
            receiveShadows: true,
            clearcoatFactor: 1,
            clearcoatRoughnessFactor: 0.055,
            iridescenceFactor: 0.78,
            iridescenceIor: 1.38,
            iridescenceThicknessMinimum: 220,
            iridescenceThicknessMaximum: 520
        });
        const relicMaterial = new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.42, 0.18, 0.045),
            metallic: 1,
            roughness: 0.2,
            castShadows: true,
            receiveShadows: true,
            clearcoatFactor: 0.68,
            clearcoatRoughnessFactor: 0.12
        });
        applyEnvironmentMaps([coreMaterial, relicMaterial], environment);

        const core = new Hilo3d.Mesh({
            name: 'Black iridescent eclipse core',
            geometry: new Hilo3d.SphereGeometry({
                radius: 0.68,
                heightSegments: 48,
                widthSegments: 72
            }),
            material: coreMaterial
        }).addTo(root);

        const wireMaterial = new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: new Hilo3d.Color(2.3, 0.84, 0.18),
            wireframe: true,
            transparent: true,
            transparency: 0.42,
            depthMask: false,
            castShadows: false,
            receiveShadows: false
        });
        const wireShell = new Hilo3d.Mesh({
            name: 'Golden geodesic event horizon',
            geometry: new Hilo3d.SphereGeometry({
                radius: 0.735,
                heightSegments: 14,
                widthSegments: 24
            }),
            material: wireMaterial,
            rotationX: 18,
            rotationY: 32
        }).addTo(root);

        const ringGeometry = createRingGeometry();
        const warmRingMaterial = new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: new Hilo3d.Color(2.8, 0.82, 0.16),
            transparent: true,
            transparency: 0.72,
            depthMask: false,
            castShadows: false,
            receiveShadows: false
        });
        const coolRingMaterial = new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: new Hilo3d.Color(0.12, 1.25, 2.7),
            transparent: true,
            transparency: 0.55,
            depthMask: false,
            castShadows: false,
            receiveShadows: false
        });
        const ringA = new Hilo3d.Mesh({
            geometry: ringGeometry,
            material: warmRingMaterial,
            rotationX: 68,
            rotationY: -18
        }).addTo(root);
        ringA.setScale(1.22);
        const ringB = new Hilo3d.Mesh({
            geometry: ringGeometry,
            material: coolRingMaterial,
            rotationX: -34,
            rotationY: 48,
            rotationZ: 24
        }).addTo(root);
        ringB.setScale(1.48);
        const ringC = new Hilo3d.Mesh({
            geometry: ringGeometry,
            material: warmRingMaterial,
            rotationX: 18,
            rotationY: 12,
            rotationZ: 72
        }).addTo(root);
        ringC.setScale(1.72);

        const shardGeometry = new Hilo3d.BoxGeometry({
            width: 0.055,
            height: 0.42,
            depth: 0.08,
            widthSegments: 2,
            heightSegments: 2,
            depthSegments: 2
        });
        for (let index = 0; index < 28; index += 1) {
            const progress = index / 28;
            const angle = progress * TAU;
            const radius = 1.02 + (index % 3) * 0.1;
            const shard = new Hilo3d.Mesh({
                name: `Orbital relic ${String(index + 1)}`,
                geometry: shardGeometry,
                material: relicMaterial,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle * 3) * 0.18,
                z: Math.sin(angle) * radius,
                rotationX: 18 + Math.sin(angle) * 34,
                rotationY: -progress * 360 + 90,
                rotationZ: index % 2 === 0 ? 14 : -14,
                useInstanced: true,
                pointerEnabled: false
            }).addTo(root);
            shard.setScale(0.72 + (index % 5) * 0.08);
        }

        const satelliteGeometry = new Hilo3d.SphereGeometry({
            radius: 0.026,
            heightSegments: 8,
            widthSegments: 10
        });
        const satelliteMaterial = new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: new Hilo3d.Color(1.9, 1.18, 0.42),
            castShadows: false,
            receiveShadows: false
        });
        for (let index = 0; index < 48; index += 1) {
            const progress = index / 48;
            const angle = progress * TAU;
            const radius = 1.82 + Math.sin(angle * 5) * 0.08;
            new Hilo3d.Mesh({
                geometry: satelliteGeometry,
                material: satelliteMaterial,
                x: Math.cos(angle) * radius,
                y: Math.sin(angle * 2) * 0.42,
                z: Math.sin(angle) * radius,
                useInstanced: true,
                frustumTest: false,
                pointerEnabled: false
            }).addTo(root);
        }

        let elapsed = 0;
        root.onUpdate = deltaTime => {
            elapsed += Math.min(deltaTime, 50) * 0.001;
            root.rotationY = elapsed * 2.4;
            ringA.rotationZ += deltaTime * 0.008;
            ringB.rotationY -= deltaTime * 0.006;
            ringC.rotationX += deltaTime * 0.004;
            wireShell.rotationY -= deltaTime * 0.012;
            wireShell.rotationZ += deltaTime * 0.006;
            core.rotationY += deltaTime * 0.003;
        };
        return root;
    });
}

class EclipseController implements Hilo3d.Tickable {
    readonly #camera: Hilo3d.PerspectiveCamera;
    readonly #stage: Hilo3d.Stage;
    readonly #canvas: HTMLCanvasElement;
    readonly #target = new Hilo3d.Vector3(0, -0.08, 0);
    readonly #cameraTime = new Float32Array(4);
    readonly #pointerWorld = new Float32Array(4);
    readonly #interaction = new Float32Array([0, 0, 0, 1 / 60]);
    readonly #viewport = new Float32Array(4);
    readonly #paletteBindings: readonly (readonly [
        HTMLButtonElement,
        (event: MouseEvent) => void
    ])[];
    #elapsed = 0;
    #yaw = 0.32;
    #pitch = 0.25;
    #distance = 7.25;
    #targetYaw = 0.32;
    #targetPitch = 0.25;
    #targetDistance = 7.25;
    #pointerX = 0;
    #pointerY = 0;
    #pointerMotion = 0;
    #pulse = 0;
    #pointerActive = false;
    #dragging = false;
    #lastClientX = 0;
    #lastClientY = 0;

    constructor(
        camera: Hilo3d.PerspectiveCamera,
        stage: Hilo3d.Stage,
        paletteButtons: readonly HTMLButtonElement[]
    ) {
        this.#camera = camera;
        this.#stage = stage;
        this.#canvas = stage.canvas;
        this.#paletteBindings = paletteButtons.map(button => {
            const handler = (event: MouseEvent): void => {
                event.preventDefault();
                const value = Number(button.dataset['palette']);
                if (!Number.isInteger(value) || value < 0 || value > 2) return;
                this.#interaction[2] = value;
                this.#pulse = Math.max(this.#pulse, 0.42);
                for (const candidate of paletteButtons) {
                    candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false');
                }
            };
            button.addEventListener('click', handler);
            return [button, handler] as const;
        });
        this.#canvas.addEventListener('pointerenter', this.#onPointerEnter);
        this.#canvas.addEventListener('pointermove', this.#onPointerMove);
        this.#canvas.addEventListener('pointerdown', this.#onPointerDown);
        this.#canvas.addEventListener('pointerup', this.#onPointerUp);
        this.#canvas.addEventListener('pointercancel', this.#onPointerCancel);
        this.#canvas.addEventListener('pointerleave', this.#onPointerLeave);
        this.#canvas.addEventListener('wheel', this.#onWheel, { passive: false });
        this.#canvas.addEventListener('contextmenu', this.#onContextMenu);
        window.addEventListener('keydown', this.#onKeyDown);
        window.addEventListener('keyup', this.#onKeyUp);
        window.addEventListener('resize', this.#onResize);
        this.resize();
        this.updateCamera(1);
    }

    readonly #onPointerEnter = (event: PointerEvent): void => {
        this.#pointerActive = true;
        this.updatePointer(event);
    };

    readonly #onPointerMove = (event: PointerEvent): void => {
        const previousX = this.#lastClientX;
        const previousY = this.#lastClientY;
        this.updatePointer(event);
        const deltaX = event.clientX - previousX;
        const deltaY = event.clientY - previousY;
        this.#pointerMotion = Math.min(6, this.#pointerMotion + Math.hypot(deltaX, deltaY) * 0.025);
        if (!this.#dragging) return;
        this.#targetYaw -= deltaX * 0.0042;
        this.#targetPitch = Math.max(-0.38, Math.min(0.52, this.#targetPitch + deltaY * 0.0032));
    };

    readonly #onPointerDown = (event: PointerEvent): void => {
        this.updatePointer(event);
        this.#dragging = true;
        this.#pulse = 1;
        this.#canvas.setPointerCapture(event.pointerId);
    };

    readonly #onPointerUp = (event: PointerEvent): void => {
        this.updatePointer(event);
        this.#dragging = false;
        if (this.#canvas.hasPointerCapture(event.pointerId)) {
            this.#canvas.releasePointerCapture(event.pointerId);
        }
    };

    readonly #onPointerCancel = (): void => {
        this.#dragging = false;
        this.#pointerActive = false;
    };

    readonly #onPointerLeave = (event: PointerEvent): void => {
        if (event.buttons !== 0) return;
        this.#dragging = false;
        this.#pointerActive = false;
    };

    readonly #onWheel = (event: WheelEvent): void => {
        event.preventDefault();
        this.#targetDistance = Math.max(
            5.35,
            Math.min(9.4, this.#targetDistance + event.deltaY * 0.0038)
        );
    };

    readonly #onContextMenu = (event: MouseEvent): void => {
        event.preventDefault();
    };

    readonly #onKeyDown = (event: KeyboardEvent): void => {
        if (event.code !== 'Space') return;
        event.preventDefault();
        this.#pulse = 1;
    };

    readonly #onKeyUp = (event: KeyboardEvent): void => {
        if (event.code === 'Space') this.#pulse = Math.max(this.#pulse, 0.36);
    };

    readonly #onResize = (): void => {
        this.resize();
    };

    private updatePointer(event: PointerEvent): void {
        const bounds = this.#canvas.getBoundingClientRect();
        this.#pointerX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1;
        this.#pointerY = 1 - ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2;
        this.#lastClientX = event.clientX;
        this.#lastClientY = event.clientY;
        this.#pointerActive = true;
    }

    private resize(): void {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        const pixelRatio = IS_TEST_MODE ? 1 : Math.min(window.devicePixelRatio || 1, 1.25);
        this.#camera.aspect = width / height;
        this.#stage.resize(width, height, pixelRatio);
        this.#viewport[0] = this.#stage.renderer.width;
        this.#viewport[1] = this.#stage.renderer.height;
        this.#viewport[2] = width / height;
        this.#viewport[3] = pixelRatio;
    }

    private updateCamera(blend: number): void {
        this.#yaw += (this.#targetYaw - this.#yaw) * blend;
        this.#pitch += (this.#targetPitch - this.#pitch) * blend;
        this.#distance += (this.#targetDistance - this.#distance) * blend;
        const horizontalDistance = Math.cos(this.#pitch) * this.#distance;
        this.#camera.x = Math.sin(this.#yaw) * horizontalDistance;
        this.#camera.y = Math.sin(this.#pitch) * this.#distance + 0.12;
        this.#camera.z = Math.cos(this.#yaw) * horizontalDistance;
        this.#camera.lookAt(this.#target);
        this.#camera.updateViewProjectionMatrix();
    }

    tick(deltaTime: number): void {
        const seconds = Math.min(Math.max(deltaTime * 0.001, 1 / 240), 0.025);
        this.#elapsed += seconds;
        if (!this.#dragging) this.#targetYaw += seconds * 0.034;
        const blend = 1 - Math.exp(-seconds * 7.5);
        this.updateCamera(blend);
        this.#pulse *= Math.exp(-seconds * 2.7);
        this.#pointerMotion *= Math.exp(-seconds * 4.4);

        const worldElements = this.#camera.worldMatrix.elements;
        const rightX = worldElements[0];
        const rightY = worldElements[1];
        const rightZ = worldElements[2];
        const upX = worldElements[4];
        const upY = worldElements[5];
        const upZ = worldElements[6];
        const pointerScaleX = 2.7 * Math.min(this.#viewport[2] ?? 1, 1.8);
        const pointerScaleY = 1.65;
        this.#pointerWorld[0] =
            rightX * this.#pointerX * pointerScaleX + upX * this.#pointerY * pointerScaleY;
        this.#pointerWorld[1] =
            rightY * this.#pointerX * pointerScaleX + upY * this.#pointerY * pointerScaleY - 0.08;
        this.#pointerWorld[2] =
            rightZ * this.#pointerX * pointerScaleX + upZ * this.#pointerY * pointerScaleY;
        this.#pointerWorld[3] = this.#pointerActive ? 1 : 0;
        this.#cameraTime[0] = this.#camera.x;
        this.#cameraTime[1] = this.#camera.y;
        this.#cameraTime[2] = this.#camera.z;
        this.#cameraTime[3] = this.#elapsed;
        this.#interaction[0] = this.#pulse;
        this.#interaction[1] = this.#pointerMotion;
        this.#interaction[3] = seconds;

        fieldBlock.set('u_viewMatrix', this.#camera.viewMatrix.elements);
        fieldBlock.set('u_projectionMatrix', this.#camera.projectionMatrix.elements);
        fieldBlock.set('u_viewProjectionMatrix', this.#camera.viewProjectionMatrix.elements);
        fieldBlock.set('u_cameraTime', this.#cameraTime);
        fieldBlock.set('u_pointerWorld', this.#pointerWorld);
        fieldBlock.set('u_interaction', this.#interaction);
        fieldBlock.set('u_viewport', this.#viewport);
    }

    dispose(): void {
        this.#canvas.removeEventListener('pointerenter', this.#onPointerEnter);
        this.#canvas.removeEventListener('pointermove', this.#onPointerMove);
        this.#canvas.removeEventListener('pointerdown', this.#onPointerDown);
        this.#canvas.removeEventListener('pointerup', this.#onPointerUp);
        this.#canvas.removeEventListener('pointercancel', this.#onPointerCancel);
        this.#canvas.removeEventListener('pointerleave', this.#onPointerLeave);
        this.#canvas.removeEventListener('wheel', this.#onWheel);
        this.#canvas.removeEventListener('contextmenu', this.#onContextMenu);
        window.removeEventListener('keydown', this.#onKeyDown);
        window.removeEventListener('keyup', this.#onKeyUp);
        window.removeEventListener('resize', this.#onResize);
        for (const [button, handler] of this.#paletteBindings) {
            button.removeEventListener('click', handler);
        }
    }
}

function requireElement<ElementType extends Element>(
    selector: string,
    constructor: new () => ElementType
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof constructor)) {
        throw new Error(`Eclipse Shrine requires ${selector}`);
    }
    return element;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function showFailure(error: unknown): void {
    const loading = document.querySelector<HTMLElement>('#loading');
    const failure = document.querySelector<HTMLElement>('#failure');
    const message = failure?.querySelector<HTMLParagraphElement>('p');
    if (loading) loading.hidden = true;
    if (failure) failure.hidden = false;
    if (message) {
        message.textContent = `${errorMessage(error)} This installation requires a WebGPU-capable browser and GPU.`;
    }
}

async function main(): Promise<void> {
    const container = requireElement('#container', HTMLElement);
    const loading = requireElement('#loading', HTMLElement);
    document.body.dataset['eclipseShrinePhase'] = 'creating-stage';
    const paletteButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-palette]')
    );
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const camera = new Hilo3d.PerspectiveCamera({
        fov: 43,
        aspect: width / height,
        near: 0.06,
        far: 80,
        x: 2.2,
        y: 1.1,
        z: 6.8
    });
    camera.lookAt(new Hilo3d.Vector3(0, -0.08, 0));

    const computeFeature = new EclipseParticleFeature();
    const testPipelineFactory = IS_TEST_MODE ? new EclipseTestPipelineFactory() : null;
    const renderPipeline =
        testPipelineFactory ??
        new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: {
                threshold: 0.94,
                knee: 0.48,
                intensity: 0.56,
                scatter: 0.66,
                clamp: 24,
                maxLevels: 7,
                minResolution: 4,
                tint: new Hilo3d.Color(1.02, 0.96, 1.08)
            },
            colorUber: {
                exposure: -0.72,
                contrast: 0.15,
                saturation: 0.08,
                temperature: 0.035,
                tint: -0.015,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.78,
                vignetteSmoothness: 0.6,
                vignetteColor: new Hilo3d.Color(0.001, 0.002, 0.008, 0.7)
            },
            opaqueTexture: false,
            features: [computeFeature]
        });
    const stage = await Hilo3d.Stage.create({
        backend: 'webgpu',
        container,
        camera,
        width,
        height,
        pixelRatio: IS_TEST_MODE ? 1 : Math.min(window.devicePixelRatio || 1, 1.25),
        antialias: false,
        alpha: false,
        depth: true,
        stencil: false,
        useInstanced: !IS_TEST_MODE,
        clearColor: new Hilo3d.Color(0.0015, 0.0025, 0.008),
        renderPipeline
    });
    if (IS_TEST_MODE) document.documentElement.classList.remove('test-mode');
    document.body.dataset['eclipseShrinePhase'] = 'creating-resources';

    const particles = stage.renderer.createStorageBuffer({
        label: 'Eclipse Shrine persistent gravitational particle state',
        byteLength: PARTICLE_BUFFER_BYTE_LENGTH,
        usage: ['storage'],
        initialData: particleInitialData(),
        recovery: 'cpu-shadow'
    });
    const argumentsBuffer = stage.renderer.createStorageBuffer({
        label: 'Eclipse Shrine GPU-authored indirect draw arguments',
        byteLength: INDIRECT_BUFFER_BYTE_LENGTH,
        usage: ['storage', 'indirect'],
        initialData: new Uint32Array([ACTIVE_PARTICLE_COUNT * 6, 1, 0, 0]),
        recovery: 'cpu-shadow'
    });
    const particleResources = { particles, argumentsBuffer };
    if (testPipelineFactory === null) {
        computeFeature.runtime.attach(particleResources);
    } else {
        testPipelineFactory.runtime.attach(particleResources);
    }

    if (!IS_TEST_MODE) {
        new Hilo3d.Mesh({
            name: 'Procedural deep-space vault',
            geometry: new Hilo3d.BoxGeometry(),
            material: createSkyMaterial(),
            frustumTest: false,
            pointerEnabled: false
        })
            .setScale(42)
            .addTo(stage);
        await createScene(stage);
    }

    new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(0.25, 0.32, 0.58),
        amount: 0.16
    }).addTo(stage);
    new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.72, 0.43),
        amount: 2.2,
        direction: new Hilo3d.Vector3(-0.65, -1, -0.3),
        shadow: {
            width: 1024,
            height: 1024,
            minBias: 0.00045,
            maxBias: 0.0024
        }
    }).addTo(stage);
    const cyanLight = new Hilo3d.PointLight({
        color: new Hilo3d.Color(0.12, 0.72, 1),
        amount: 18,
        range: 10,
        x: 2.7,
        y: 1.8,
        z: 2.2
    }).addTo(stage);
    const amberLight = new Hilo3d.PointLight({
        color: new Hilo3d.Color(1, 0.34, 0.08),
        amount: 14,
        range: 9,
        x: -2.4,
        y: 0.5,
        z: 1.6
    }).addTo(stage);

    let lightTime = 0;
    cyanLight.onUpdate = deltaTime => {
        lightTime += Math.min(deltaTime, 50) * 0.001;
        cyanLight.x = Math.cos(lightTime * 0.43) * 2.8;
        cyanLight.z = Math.sin(lightTime * 0.43) * 2.8;
        amberLight.x = Math.cos(-lightTime * 0.31 + 2.2) * 2.6;
        amberLight.z = Math.sin(-lightTime * 0.31 + 2.2) * 2.6;
    };

    const controller = new EclipseController(camera, stage, paletteButtons);
    controller.tick(1000 / 60);
    document.body.dataset['eclipseShrinePhase'] = 'submitting-first-frame';
    stage.tick(1000 / 60);
    document.body.dataset['eclipseShrinePhase'] = 'running';

    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(controller);
    ticker.addTick(stage);
    ticker.start();
    loading.hidden = true;
    document.body.dataset['eclipseShrineReady'] = 'true';

    window.__HILO3D_ECLIPSE_RESULT__ = {
        backend: stage.renderer.backend,
        particleCount: PARTICLE_COUNT,
        activeParticleCount: ACTIVE_PARTICLE_COUNT,
        indirectLayers: 3,
        drawCount: stage.renderer.renderInfo.drawCount
    };

    window.addEventListener(
        'pagehide',
        () => {
            ticker.stop();
            controller.dispose();
            particles.destroy();
            argumentsBuffer.destroy();
            stage.destroy();
        },
        { once: true }
    );
}

void main().catch((error: unknown) => {
    showFailure(error);
    queueMicrotask(() => {
        throw error;
    });
});

declare global {
    interface Window {
        __HILO3D_ECLIPSE_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly particleCount: number;
            readonly activeParticleCount: number;
            readonly indirectLayers: number;
            readonly drawCount: number;
        };
    }
}
