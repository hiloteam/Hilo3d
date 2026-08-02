import * as Hilo3d from '../src/Hilo3d';

const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT;
const WORD_PARTICLE_COUNT = 4096;
const AMBIENT_PARTICLE_COUNT = 61440;
const PARTICLE_COUNT = WORD_PARTICLE_COUNT + AMBIENT_PARTICLE_COUNT;
const PARTICLE_WORKGROUP_SIZE = 64;
const PARTICLE_WORKGROUP_COUNT = PARTICLE_COUNT / PARTICLE_WORKGROUP_SIZE;
const PARTICLE_FLOATS_PER_RECORD = 16;
const PARTICLE_BUFFER_BYTE_LENGTH = PARTICLE_COUNT * PARTICLE_FLOATS_PER_RECORD * 4;
const INDIRECT_ARGUMENT_DESCRIPTOR = Object.freeze({ byteLength: 32 });
const FULL_VIEWPORT = Object.freeze([0, 0, TARGET_WIDTH, TARGET_HEIGHT] as const);
const BACKGROUND_COLOR = Object.freeze({ r: 0.004, g: 0.008, b: 0.024, a: 1 });
const REQUIRED_CAPABILITIES: readonly Hilo3d.RenderPipelineCapabilityName[] = Object.freeze([
    'storage-buffer',
    'compute-pass',
    'indirect-draw'
]);
const portableCoordinateShader = Hilo3d.Shader.shaders['method/portableCoordinates.glsl'];
if (portableCoordinateShader === undefined) {
    throw new Error('Portable coordinate shader helpers are unavailable');
}

const interactionLayout = Hilo3d.createStd140Layout({
    u_pointer: 'vec4',
    u_motion: 'vec4',
    u_time: 'vec4',
    u_tuning: 'vec4'
});

const interactionBlock = Hilo3d.UniformBuffer.fromSchema(interactionLayout, {
    u_pointer: [0, 0, 0, 0],
    u_motion: [0, 0, 0, 0],
    u_time: [0, 1 / 60, TARGET_ASPECT, 0],
    u_tuning: [1, 0.78, 0.14, PARTICLE_COUNT]
});

const PARTICLE_COMPUTE_PASS = new Hilo3d.ComputeRenderPass(
    new Hilo3d.ComputeKernel({
        label: 'Hilo3D quantum particle simulation',
        shader: new Hilo3d.ComputeShader({
            label: 'Hilo3D quantum particle simulation',
            source: `
struct InteractionBlock {
    pointer: vec4<f32>,
    motion: vec4<f32>,
    time: vec4<f32>,
    tuning: vec4<f32>,
};

struct Particle {
    positionPhase: vec4<f32>,
    velocitySeed: vec4<f32>,
    targetMeta: vec4<f32>,
    previousMisc: vec4<f32>,
};

struct CollisionResult {
    position: vec2<f32>,
    velocity: vec2<f32>,
    flash: f32,
};

@group(0) @binding(0) var<uniform> interaction: InteractionBlock;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> drawArguments: array<u32>;

fn hash31(point: vec3<f32>) -> f32 {
    var value = fract(point * vec3<f32>(0.1031, 0.11369, 0.13787));
    value += dot(value, value.yzx + vec3<f32>(19.19));
    return fract((value.x + value.y) * value.z);
}

fn valueNoise3(point: vec3<f32>) -> f32 {
    let cell = floor(point);
    let local = fract(point);
    let curve = local * local * (vec3<f32>(3.0) - 2.0 * local);
    let x00 = mix(hash31(cell), hash31(cell + vec3<f32>(1.0, 0.0, 0.0)), curve.x);
    let x10 = mix(
        hash31(cell + vec3<f32>(0.0, 1.0, 0.0)),
        hash31(cell + vec3<f32>(1.0, 1.0, 0.0)),
        curve.x
    );
    let x01 = mix(
        hash31(cell + vec3<f32>(0.0, 0.0, 1.0)),
        hash31(cell + vec3<f32>(1.0, 0.0, 1.0)),
        curve.x
    );
    let x11 = mix(
        hash31(cell + vec3<f32>(0.0, 1.0, 1.0)),
        hash31(cell + vec3<f32>(1.0, 1.0, 1.0)),
        curve.x
    );
    return mix(mix(x00, x10, curve.y), mix(x01, x11, curve.y), curve.z);
}

fn fractalNoise3(point: vec3<f32>) -> f32 {
    var samplePoint = point;
    var amplitude = 0.54;
    var result = 0.0;
    for (var octave = 0u; octave < 3u; octave += 1u) {
        result += valueNoise3(samplePoint) * amplitude;
        samplePoint = samplePoint * 2.03 + vec3<f32>(7.1, 3.7, 5.9);
        amplitude *= 0.5;
    }
    return result;
}

fn curlNoise(point: vec2<f32>, time: f32) -> vec2<f32> {
    let epsilon = 0.045;
    let samplePoint = vec3<f32>(point * 2.65, time * 0.105);
    let positiveX = fractalNoise3(samplePoint + vec3<f32>(epsilon, 0.0, 0.0));
    let negativeX = fractalNoise3(samplePoint - vec3<f32>(epsilon, 0.0, 0.0));
    let positiveY = fractalNoise3(samplePoint + vec3<f32>(0.0, epsilon, 0.0));
    let negativeY = fractalNoise3(samplePoint - vec3<f32>(0.0, epsilon, 0.0));
    let curl = vec2<f32>(positiveY - negativeY, negativeX - positiveX) / (2.0 * epsilon);
    return curl / max(length(curl), 0.001);
}

fn particleToPhysicalDelta(delta: vec2<f32>, aspect: f32) -> vec2<f32> {
    return vec2<f32>(delta.x * aspect, delta.y);
}

fn physicalToParticleDelta(delta: vec2<f32>, aspect: f32) -> vec2<f32> {
    return vec2<f32>(delta.x / aspect, delta.y);
}

fn collideCircle(
    position: vec2<f32>,
    velocity: vec2<f32>,
    center: vec2<f32>,
    radius: f32,
    aspect: f32
) -> CollisionResult {
    let offset = position - center;
    let physicalOffset = particleToPhysicalDelta(offset, aspect);
    let distance = length(physicalOffset);
    if (distance >= radius || distance <= 0.0001) {
        return CollisionResult(position, velocity, 0.0);
    }
    let normal = physicalOffset / distance;
    let correctedPosition = center + physicalToParticleDelta(normal * radius, aspect);
    let physicalVelocity = particleToPhysicalDelta(velocity, aspect);
    let normalSpeed = dot(physicalVelocity, normal);
    var correctedVelocity = physicalVelocity;
    if (normalSpeed < 0.0) {
        correctedVelocity = physicalVelocity - normal * normalSpeed * 1.72;
        correctedVelocity *= 0.92;
    }
    return CollisionResult(correctedPosition, physicalToParticleDelta(correctedVelocity, aspect), 1.0);
}

fn meteorState(time: f32, period: f32, delay: f32) -> vec2<f32> {
    let shiftedTime = time - delay;
    let cycleTime = shiftedTime - floor(shiftedTime / period) * period;
    let progress = clamp(cycleTime / 1.8, 0.0, 1.0);
    let easedProgress = progress * progress * (3.0 - 2.0 * progress);
    let activity = 1.0 - smoothstep(1.5, 1.8, cycleTime);
    return vec2<f32>(easedProgress, activity);
}

fn meteorWake(
    position: vec2<f32>,
    head: vec2<f32>,
    direction: vec2<f32>,
    activity: f32,
    aspect: f32
) -> vec2<f32> {
    if (activity <= 0.001) { return vec2<f32>(0.0); }
    let physicalPosition = particleToPhysicalDelta(position, aspect);
    let physicalHead = particleToPhysicalDelta(head, aspect);
    let physicalDirection = normalize(particleToPhysicalDelta(direction, aspect));
    let fromHead = physicalPosition - physicalHead;
    let behind = dot(fromHead, -physicalDirection);
    let clampedBehind = clamp(behind, 0.0, 0.5);
    let closestPoint = physicalHead - physicalDirection * clampedBehind;
    let trailOffset = physicalPosition - closestPoint;
    let trailDistanceSquared = dot(trailOffset, trailOffset);
    let segmentMask = select(0.0, 1.0, behind >= 0.0 && behind <= 0.5);
    let trailMask = exp(-trailDistanceSquared * 210.0)
        * exp(-clampedBehind * 3.4)
        * segmentMask;
    let headDistanceSquared = dot(fromHead, fromHead);
    let headMask = exp(-headDistanceSquared * 72.0);
    let radialDirection = trailOffset / max(length(trailOffset), 0.001);
    let physicalForce = physicalDirection * (trailMask * 2.35 + headMask * 1.7)
        + radialDirection * (trailMask * 0.34 + headMask * 2.0);
    return physicalToParticleDelta(physicalForce * activity, aspect);
}

@compute @workgroup_size(${String(PARTICLE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x == 0u) {
        drawArguments[0] = ${String(WORD_PARTICLE_COUNT * 6)}u;
        drawArguments[1] = 1u;
        drawArguments[2] = 0u;
        drawArguments[3] = 0u;
        drawArguments[4] = ${String(AMBIENT_PARTICLE_COUNT * 6)}u;
        drawArguments[5] = 1u;
        drawArguments[6] = ${String(WORD_PARTICLE_COUNT * 6)}u;
        drawArguments[7] = 0u;
    }
    if (id.x >= ${String(PARTICLE_COUNT)}u) { return; }

    var particle = particles[id.x];
    var position = particle.positionPhase.xy;
    var velocity = particle.velocitySeed.xy;
    let homeTarget = particle.targetMeta.xy;
    let seed = particle.velocitySeed.z;
    let homeStrength = particle.targetMeta.w;
    let isWordParticle = id.x < ${String(WORD_PARTICLE_COUNT)}u;
    let ambientKind = particle.previousMisc.w;
    let isDuneParticle = !isWordParticle && ambientKind > 2.5;
    let isNebulaParticle = !isWordParticle && ambientKind > 1.5 && ambientKind < 2.5;
    let frameTime = interaction.time.x;
    let stepTime = min(interaction.time.y, 0.025) * 0.5;
    let aspect = interaction.time.z;
    let pointerCenter = interaction.pointer.xy;
    var collisionFlash = particle.positionPhase.w * exp(-interaction.time.y * 7.0);

    let meteorAState = meteorState(frameTime, 22.0, 2.4);
    let meteorBState = meteorState(frameTime, 31.0, 10.5);
    let meteorCState = meteorState(frameTime, 41.0, 18.0);
    let meteorAStart = vec2<f32>(-0.98, 1.12);
    let meteorAEnd = vec2<f32>(0.62, -0.04);
    let meteorBStart = vec2<f32>(0.92, 1.1);
    let meteorBEnd = vec2<f32>(-0.58, -0.12);
    let meteorCStart = vec2<f32>(-0.25, 1.15);
    let meteorCEnd = vec2<f32>(0.92, -0.08);
    let meteorA = mix(meteorAStart, meteorAEnd, meteorAState.x);
    let meteorB = mix(meteorBStart, meteorBEnd, meteorBState.x);
    let meteorC = mix(meteorCStart, meteorCEnd, meteorCState.x);
    let meteorADirection = meteorAEnd - meteorAStart;
    let meteorBDirection = meteorBEnd - meteorBStart;
    let meteorCDirection = meteorCEnd - meteorCStart;

    particle.previousMisc = vec4<f32>(position, particle.previousMisc.zw);
    let noiseOffset = vec2<f32>(seed * 0.00037, seed * 0.00019);
    let noiseField = curlNoise(
        particleToPhysicalDelta(position, aspect) + noiseOffset,
        frameTime + seed * 0.0007
    );

    for (var substep = 0u; substep < 2u; substep += 1u) {
        let physicalPosition = particleToPhysicalDelta(position, aspect);
        var force = vec2<f32>(0.0);
        let orbitalNormal = vec2<f32>(-physicalPosition.y, physicalPosition.x / aspect);
        if (isWordParticle) {
            let breathingTarget = homeTarget * (1.0 + 0.006 * sin(frameTime * 1.3 + seed));
            let targetDelta = breathingTarget - position;
            force += targetDelta * (10.5 + homeStrength * 2.1) * interaction.tuning.x;
            force += noiseField * (0.055 + interaction.tuning.y * 0.08);
            force += orbitalNormal * (0.018 + 0.012 * sin(frameTime * 0.7 + seed));
        } else if (isDuneParticle) {
            let duneDepth = particle.previousMisc.z;
            let ambientTarget = homeTarget + vec2<f32>(
                sin(frameTime * (0.16 + duneDepth * 0.08) + seed) * (0.006 + duneDepth * 0.012) / aspect,
                cos(frameTime * 0.21 + seed * 0.7) * (0.002 + duneDepth * 0.005)
            );
            force += (ambientTarget - position) * (1.35 + duneDepth * 1.2);
            force += noiseField * (0.035 + duneDepth * 0.075);
            force += vec2<f32>(noiseField.x * (0.05 + duneDepth * 0.06), 0.0);
        } else if (ambientKind > 1.5) {
            let ambientTarget = homeTarget + vec2<f32>(
                sin(frameTime * 0.07 + seed) * 0.008 / aspect,
                cos(frameTime * 0.055 + seed * 0.7) * 0.006
            );
            force += (ambientTarget - position) * 1.05;
            force += noiseField * 0.018;
            force += orbitalNormal * 0.002;
        } else {
            let ambientTarget = homeTarget + vec2<f32>(
                sin(frameTime * 0.11 + seed) * 0.018 / aspect,
                cos(frameTime * 0.09 + seed * 0.7) * 0.012
            );
            force += (ambientTarget - position) * 0.7;
            force += noiseField * 0.035;
        }

        let ambientMeteorResponse = select(1.22, 0.42, isNebulaParticle);
        let meteorLayerResponse = select(ambientMeteorResponse, 0.76, isWordParticle);
        force += meteorWake(
            position,
            meteorA,
            meteorADirection,
            meteorAState.y,
            aspect
        ) * meteorLayerResponse;
        force += meteorWake(
            position,
            meteorB,
            meteorBDirection,
            meteorBState.y,
            aspect
        ) * meteorLayerResponse;
        force += meteorWake(
            position,
            meteorC,
            meteorCDirection,
            meteorCState.y,
            aspect
        ) * meteorLayerResponse;

        if (interaction.pointer.z > 0.5) {
            let pointerDelta = pointerCenter - position;
            let pointerPhysical = particleToPhysicalDelta(pointerDelta, aspect);
            let distanceSquared = max(dot(pointerPhysical, pointerPhysical), 0.0035);
            let distance = sqrt(distanceSquared);
            let physicalDirection = pointerPhysical / max(distance, 0.001);
            let direction = physicalToParticleDelta(physicalDirection, aspect);
            var pointerVelocityPhysical = particleToPhysicalDelta(interaction.motion.xy, aspect);
            let pointerSpeed = length(pointerVelocityPhysical);
            if (pointerSpeed > 1.8) {
                pointerVelocityPhysical *= 1.8 / pointerSpeed;
            }
            let pointerVelocity = physicalToParticleDelta(pointerVelocityPhysical, aspect);
            let ambientLayerResponse = select(1.25, 0.72, isDuneParticle);
            let layerResponse = select(ambientLayerResponse, 1.0, isWordParticle);

            if (interaction.pointer.w > 0.5) {
                let shockStrength = (2.0 + interaction.motion.z * 8.5) / (0.075 + distanceSquared * 4.0);
                force -= direction * shockStrength * layerResponse;
                force += pointerVelocity * (1.2 * layerResponse / (0.12 + distance));
            } else if (interaction.pointer.w < -0.5) {
                let tangent = physicalToParticleDelta(
                    vec2<f32>(-physicalDirection.y, physicalDirection.x),
                    aspect
                );
                force += tangent * (4.4 * layerResponse / (0.08 + distance));
                force += direction * (0.48 / (0.1 + distance) - distance * 0.65) * layerResponse;
                force += pointerVelocity * 0.8 * layerResponse;
            } else {
                let lens = exp(-distanceSquared * 8.5);
                force += pointerDelta * lens * 2.5 * layerResponse;
                force += pointerVelocity * lens * 0.38 * layerResponse;
            }
        }

        velocity += force * stepTime;
        let driftingDamping = select(0.72, 1.65, isNebulaParticle);
        let ambientDamping = select(driftingDamping, 1.7, isDuneParticle);
        let damping = select(ambientDamping, 2.35, isWordParticle);
        velocity *= exp(-stepTime * damping);
        let speed = length(vec2<f32>(velocity.x * aspect, velocity.y));
        let ambientMaximumSpeed = select(0.82, 0.46, isDuneParticle);
        let maximumSpeed = select(ambientMaximumSpeed, 1.45, isWordParticle);
        if (speed > maximumSpeed) { velocity *= maximumSpeed / speed; }
        position += velocity * stepTime;

        if (meteorAState.y > 0.01) {
            let meteorCollision = collideCircle(position, velocity, meteorA, 0.026, aspect);
            position = meteorCollision.position;
            velocity = meteorCollision.velocity;
            collisionFlash = max(collisionFlash, meteorCollision.flash * meteorAState.y);
        }
        if (meteorBState.y > 0.01) {
            let meteorCollision = collideCircle(position, velocity, meteorB, 0.024, aspect);
            position = meteorCollision.position;
            velocity = meteorCollision.velocity;
            collisionFlash = max(collisionFlash, meteorCollision.flash * meteorBState.y);
        }
        if (meteorCState.y > 0.01) {
            let meteorCollision = collideCircle(position, velocity, meteorC, 0.022, aspect);
            position = meteorCollision.position;
            velocity = meteorCollision.velocity;
            collisionFlash = max(collisionFlash, meteorCollision.flash * meteorCState.y);
        }

        if (interaction.pointer.z > 0.5) {
            let collision = collideCircle(
                position,
                velocity,
                pointerCenter,
                interaction.tuning.z,
                aspect
            );
            position = collision.position;
            velocity = collision.velocity;
            collisionFlash = max(collisionFlash, collision.flash);
        }

        let horizontalLimit = select(1.08, 0.965, isWordParticle);
        if (position.x < -horizontalLimit) {
            position.x = -horizontalLimit;
            velocity.x = abs(velocity.x) * 0.78;
            collisionFlash = 1.0;
        } else if (position.x > horizontalLimit) {
            position.x = horizontalLimit;
            velocity.x = -abs(velocity.x) * 0.78;
            collisionFlash = 1.0;
        }
        let verticalLimit = select(1.08, 0.91, isWordParticle);
        if (position.y < -verticalLimit) {
            position.y = -verticalLimit;
            velocity.y = abs(velocity.y) * 0.78;
            collisionFlash = 1.0;
        } else if (position.y > verticalLimit) {
            position.y = verticalLimit;
            velocity.y = -abs(velocity.y) * 0.78;
            collisionFlash = 1.0;
        }
    }

    particle.positionPhase = vec4<f32>(
        position,
        particle.positionPhase.z + interaction.time.y * (0.7 + fract(seed) * 1.3),
        collisionFlash
    );
    particle.velocitySeed = vec4<f32>(
        velocity,
        particle.velocitySeed.z,
        mix(
        particle.velocitySeed.w,
        clamp(length(velocity) * 1.8 + collisionFlash, 0.0, 1.0),
        0.18
        )
    );
    particles[id.x] = particle;
}`,
            workgroupSize: [PARTICLE_WORKGROUP_SIZE],
            bindings: [
                {
                    name: 'interaction',
                    group: 0,
                    binding: 0,
                    kind: 'uniform-buffer',
                    minBindingSize: 64
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
                    access: 'write-discard',
                    minBindingSize: 32
                }
            ]
        })
    })
);

const BACKGROUND_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Quantum field procedural background',
    shader: new Hilo3d.StorageGraphicsShader({
        label: 'Quantum field grid and meteor wake visualization',
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
layout(std140) uniform InteractionBlock {
    vec4 u_pointer;
    vec4 u_motion;
    vec4 u_time;
    vec4 u_tuning;
};
layout(std430) readonly buffer ParticleState {
    vec4 values[];
} particleState;
out float fieldEnergy;
void main() {
    vec2 corner = vec2(-1.0, -1.0);
    if (gl_VertexID == 1 || gl_VertexID >= 4) corner.x = 1.0;
    if (gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 5) corner.y = 1.0;
    fieldEnergy = particleState.values[1].w;
    gl_Position = vec4(corner, 0.0, 1.0);
}`,
        fragmentSource: `#version 310 es
precision highp float;
precision highp int;
layout(std140) uniform InteractionBlock {
    vec4 u_pointer;
    vec4 u_motion;
    vec4 u_time;
    vec4 u_tuning;
};
in float fieldEnergy;
layout(location = 0) out vec4 color;
${portableCoordinateShader}

float lineGrid(vec2 point, float scale, float width) {
    vec2 cell = abs(fract(point * scale - 0.5) - 0.5) / fwidth(point * scale);
    return 1.0 - min(min(cell.x, cell.y) / width, 1.0);
}

float ring(vec2 point, vec2 center, float radius, float width) {
    return 1.0 - smoothstep(width, width * 2.0, abs(length(point - center) - radius));
}

float nebulaField(vec2 point, float time, float phase) {
    vec2 drifted = point + vec2(time * 0.012, -time * 0.004);
    float broadWarp = sin(drifted.x * 1.7 + phase)
        + sin(drifted.x * 3.2 - drifted.y * 1.2 - phase * 0.7) * 0.34;
    float ribbonCenter = 0.5 + broadWarp * 0.068;
    float ribbon = exp(-4.8 * pow(drifted.y - ribbonCenter, 2.0));
    float cloudNoise = 0.54
        + sin(drifted.x * 3.2 + drifted.y * 1.6 + phase + time * 0.018) * 0.2
        + sin(drifted.x * 6.1 - drifted.y * 3.4 - phase * 1.3) * 0.13;
    return ribbon * smoothstep(0.3, 0.78, cloudNoise);
}

float auroraCurtain(vec2 point, float time, float phase) {
    float flowTime = time * 0.018;
    float lowerEdge = 0.18
        + sin(point.x * 1.55 + flowTime + phase) * 0.11
        + sin(point.x * 3.7 - flowTime * 0.72 - phase * 0.8) * 0.035;
    float lowerFade = smoothstep(lowerEdge - 0.08, lowerEdge + 0.16, point.y);
    float upperFade = 1.0 - smoothstep(0.72, 1.0, point.y);
    float curtainCoordinate = point.x * 5.6
        + sin(point.y * 2.4 + flowTime * 0.65 + phase) * 0.62
        - flowTime * 0.46;
    float strands = pow(0.5 + 0.5 * sin(curtainCoordinate), 3.0);
    float softVeil = 0.5 + strands * 0.5;
    float connectedEdge = exp(-72.0 * pow(point.y - lowerEdge, 2.0));
    float sideFade = exp(-0.24 * pow(point.x + sin(phase) * 0.2, 2.0));
    float shimmer = 0.86
        + sin(point.x * 2.3 - point.y * 3.1 + flowTime + phase) * 0.14;
    return (lowerFade * upperFade * softVeil + connectedEdge * 0.32)
        * sideFade
        * shimmer;
}

vec2 meteorState(float time, float period, float delay) {
    float shiftedTime = time - delay;
    float cycleTime = shiftedTime - floor(shiftedTime / period) * period;
    float progress = clamp(cycleTime / 1.8, 0.0, 1.0);
    float easedProgress = progress * progress * (3.0 - 2.0 * progress);
    float activity = 1.0 - smoothstep(1.5, 1.8, cycleTime);
    return vec2(easedProgress, activity);
}

vec3 meteorLight(
    vec2 point,
    vec2 start,
    vec2 end,
    vec2 state,
    float time,
    float seed
) {
    vec2 head = mix(start, end, state.x);
    vec2 direction = normalize(end - start);
    vec2 normal = vec2(-direction.y, direction.x);
    vec2 relative = point - head;
    float behind = dot(relative, -direction);
    float trailBehind = clamp(behind, 0.0, 0.72);
    float lateralDrift = sin(trailBehind * 13.0 + seed) * trailBehind * 0.006;
    float side = abs(dot(relative, normal) - lateralDrift);
    float trailWindow = step(0.0, behind) * (1.0 - smoothstep(0.03, 0.72, behind));
    float trailFlicker = 0.96 + 0.04 * sin(trailBehind * 46.0 - time * 17.0 + seed);
    float trailWidth = 1.0 + trailBehind * 0.58;
    float outerTrail = exp(-980.0 * side * side / (trailWidth * trailWidth))
        * trailWindow
        * trailFlicker
        * state.y;
    float coreTrail = exp(-6800.0 * side * side / trailWidth) * trailWindow * state.y;
    float headDistanceSquared = dot(relative, relative);
    float headCore = exp(-2100.0 * headDistanceSquared) * state.y;
    float headBloom = exp(-175.0 * headDistanceSquared) * state.y;
    float headRay = (
        exp(-6800.0 * pow(dot(relative, normal), 2.0))
        + exp(-9600.0 * pow(dot(relative, direction), 2.0))
    ) * exp(-38.0 * length(relative)) * state.y;
    return vec3(0.08, 0.34, 1.0) * outerTrail * 0.18
        + vec3(0.58, 0.84, 1.0) * coreTrail * 0.62
        + vec3(0.18, 0.52, 1.0) * headBloom * 0.24
        + vec3(0.84, 0.94, 1.0) * headRay * 0.34
        + vec3(1.0) * headCore * 1.05;
}

void main() {
    vec2 fragCoord = hiloBottomLeftFragCoord(
        gl_FragCoord.xy,
        vec2(${String(TARGET_WIDTH)}.0, ${String(TARGET_HEIGHT)}.0)
    );
    vec2 uv = fragCoord / vec2(${String(TARGET_WIDTH)}.0, ${String(TARGET_HEIGHT)}.0);
    vec2 point = (uv * 2.0 - 1.0) * vec2(u_time.z, 1.0);
    float vignette = 1.0 - smoothstep(0.25, 1.28, length(point * vec2(0.58, 0.92)));
    float fineGrid = lineGrid(point, 13.0, 0.8) * 0.035;
    float majorGrid = lineGrid(point, 3.25, 1.15) * 0.075;
    float scan = pow(0.5 + 0.5 * sin(fragCoord.y * 0.21 + u_time.x * 2.3), 18.0) * 0.045;
    float radial = 1.0 - smoothstep(0.0, 1.22, length(point));
    float horizon = exp(-72.0 * pow(point.y + 0.09, 2.0));
    vec3 base = vec3(0.004, 0.011, 0.032);
    base += vec3(0.012, 0.055, 0.11) * radial;
    base += vec3(0.02, 0.16, 0.23) * (fineGrid + majorGrid) * (0.35 + vignette);
    base += vec3(0.05, 0.12, 0.2) * scan;
    base += vec3(0.06, 0.3, 0.48) * horizon * (0.26 + vignette * 0.44);

    float blueNebula = nebulaField(point + vec2(0.28, 0.03), u_time.x, 0.7);
    float violetNebula = nebulaField(
        vec2(-point.x, point.y) + vec2(0.18, -0.08),
        u_time.x * 0.82,
        2.8
    );
    base += vec3(0.025, 0.15, 0.48) * blueNebula * (0.075 + vignette * 0.055);
    base += vec3(0.3, 0.035, 0.44) * violetNebula * (0.065 + vignette * 0.045);

    float cyanAurora = auroraCurtain(point + vec2(0.14, 0.0), u_time.x, 0.5);
    float violetAurora = auroraCurtain(
        vec2(-point.x * 0.86, point.y + 0.025),
        u_time.x * 0.78,
        2.7
    );
    base += vec3(0.018, 0.58, 0.48) * cyanAurora * (0.075 + vignette * 0.055);
    base += vec3(0.32, 0.055, 0.56) * violetAurora * (0.065 + vignette * 0.045);

    vec2 afterglowCenter = vec2(0.58, 0.14);
    float afterglowDistance = length(point - afterglowCenter);
    float afterglow = exp(-5.2 * afterglowDistance * afterglowDistance);
    vec3 afterglowColor = mix(
        vec3(0.42, 0.025, 0.28),
        vec3(0.72, 0.16, 0.12),
        smoothstep(-0.08, 0.26, point.y)
    );
    base += afterglowColor * afterglow * (0.065 + vignette * 0.035);

    float distantHillY = -0.055
        + sin(point.x * 1.65 + 0.7) * 0.072
        + sin(point.x * 4.2 - 1.3) * 0.018;
    float distantHill = 1.0 - smoothstep(
        distantHillY - 0.012,
        distantHillY + 0.012,
        point.y
    );
    float hillRim = exp(-260.0 * pow(point.y - distantHillY, 2.0));
    base = mix(base, vec3(0.003, 0.009, 0.027), distantHill * 0.78);
    base += vec3(0.16, 0.08, 0.34) * hillRim * 0.16;

    float midgroundHillY = -0.34
        + sin(point.x * 1.18 - 0.6) * 0.085
        + sin(point.x * 3.25 + 1.1) * 0.022;
    float midgroundHill = 1.0 - smoothstep(
        midgroundHillY - 0.018,
        midgroundHillY + 0.018,
        point.y
    );
    float midgroundRim = exp(-170.0 * pow(point.y - midgroundHillY, 2.0));
    float valleyFog = exp(-22.0 * pow(point.y + 0.22, 2.0))
        * (0.78 + sin(point.x * 1.7 + u_time.x * 0.035) * 0.22);
    base = mix(base, vec3(0.002, 0.012, 0.032), midgroundHill * 0.34);
    base += vec3(0.025, 0.22, 0.34) * midgroundRim * (0.11 + vignette * 0.06);
    base += vec3(0.02, 0.095, 0.18) * valleyFog * (0.1 + vignette * 0.07);
    float wordBacklight = exp(-0.75 * point.x * point.x)
        * exp(-8.5 * pow(point.y - 0.19, 2.0));
    base += vec3(0.018, 0.12, 0.3) * wordBacklight * (0.12 + vignette * 0.1);

    vec2 meteorAState = meteorState(u_time.x, 22.0, 2.4);
    vec2 meteorBState = meteorState(u_time.x, 31.0, 10.5);
    vec2 meteorCState = meteorState(u_time.x, 41.0, 18.0);
    float meteorIntensity = 0.9 + min(fieldEnergy, 1.0) * 0.1;
    base += meteorLight(
        point,
        vec2(-0.98 * u_time.z, 1.12),
        vec2(0.62 * u_time.z, -0.04),
        meteorAState,
        u_time.x,
        1.7
    ) * meteorIntensity;
    base += meteorLight(
        point,
        vec2(0.92 * u_time.z, 1.1),
        vec2(-0.58 * u_time.z, -0.12),
        meteorBState,
        u_time.x,
        4.3
    ) * meteorIntensity;
    base += meteorLight(
        point,
        vec2(-0.25 * u_time.z, 1.15),
        vec2(0.92 * u_time.z, -0.08),
        meteorCState,
        u_time.x,
        7.1
    ) * meteorIntensity;

    if (u_pointer.z > 0.5) {
        vec2 pointer = vec2(u_pointer.x * u_time.z, u_pointer.y);
        float pointerRing = ring(point, pointer, u_tuning.z, 0.0027);
        float waveRadius = fract(u_time.x * 0.72) * 0.66;
        float wave = ring(point, pointer, waveRadius, 0.012) * max(u_motion.z, 0.08);
        vec3 modeColor = u_pointer.w < -0.5
            ? vec3(0.55, 0.18, 1.0)
            : vec3(0.0, 0.82, 1.0);
        float pointerEmphasis = 0.035 + min(u_motion.z, 0.8) * 0.12;
        base += modeColor * (pointerRing * pointerEmphasis + wave * 0.055);
    }

    float frame = smoothstep(0.012, 0.0, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
    base += vec3(0.03, 0.34, 0.46) * frame * 0.22;
    color = vec4(base * (0.72 + vignette * 0.36), 1.0);
}`,
        bindings: [
            {
                name: 'InteractionBlock',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: 64
            },
            {
                name: 'particleState',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: PARTICLE_BUFFER_BYTE_LENGTH
            }
        ]
    }),
    pipelineState: {
        ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: false,
        depthWrite: false,
        cullMode: 'none'
    }
});

const AMBIENT_PARTICLE_PASS = new Hilo3d.GPUDrivenRenderPass({
    name: 'Cyber dune and deep-field particle layer',
    shader: new Hilo3d.StorageGraphicsShader({
        label: 'Perspective particle dunes, atmospheric dust, and stars',
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
layout(std140) uniform InteractionBlock {
    vec4 u_pointer;
    vec4 u_motion;
    vec4 u_time;
    vec4 u_tuning;
};
layout(std430) readonly buffer ParticleState {
    vec4 values[];
} particleState;
out vec2 localPosition;
out vec3 ambientColor;
out float ambientEnergy;
out float ambientKind;
out float ambientDepth;
out float ambientRidge;
out float ambientSparkle;
void main() {
    int particleIndex = int(floor(float(gl_VertexID) / 6.0));
    int localVertexIndex = int(mod(float(gl_VertexID), 6.0));
    int recordIndex = particleIndex * 4;
    vec4 positionPhase = particleState.values[recordIndex];
    vec4 velocitySeed = particleState.values[recordIndex + 1];
    vec4 targetMeta = particleState.values[recordIndex + 2];
    vec4 previousMisc = particleState.values[recordIndex + 3];

    localPosition = vec2(-1.0, -1.0);
    if (localVertexIndex == 1 || localVertexIndex >= 4) localPosition.x = 1.0;
    if (localVertexIndex == 2 || localVertexIndex == 3 || localVertexIndex == 5) localPosition.y = 1.0;

    float layer = previousMisc.w;
    float palette = targetMeta.z;
    float ridgeLight = clamp(targetMeta.w, 0.0, 1.0);
    float twinkle = 0.5 + 0.5 * sin(positionPhase.z * 0.73 + velocitySeed.z * 0.021);
    float mediumStar = smoothstep(0.48, 0.76, ridgeLight);
    float largeStar = smoothstep(0.84, 0.96, ridgeLight);
    float sharpTwinkle = mediumStar * 0.12
        + largeStar * (0.58 + pow(twinkle, 5.0) * 0.42);
    float depthCrest = pow(
        0.5 + 0.5 * cos((previousMisc.z - 0.12) * 18.8495559),
        6.0
    );
    float scale;
    if (layer > 2.5) {
        scale = 0.0016 + previousMisc.z * 0.0098 + depthCrest * 0.002;
    } else if (layer > 1.5) {
        scale = 0.028 + previousMisc.z * 0.038;
    } else {
        scale = 0.0017
            + previousMisc.z * 0.0021
            + mediumStar * 0.0025
            + largeStar * 0.0065;
    }
    vec2 physicalOffset = localPosition * scale;
    gl_Position = vec4(
        positionPhase.xy + vec2(physicalOffset.x / u_time.z, physicalOffset.y),
        0.0,
        1.0
    );

    if (layer > 2.5) {
        float effectiveRidge = max(ridgeLight, depthCrest * 0.96);
        vec3 duneShadow = mix(
            vec3(0.003, 0.014, 0.052),
            vec3(0.008, 0.052, 0.12),
            previousMisc.z
        );
        vec3 duneRidge = mix(
            vec3(0.022, 0.26, 0.56),
            vec3(0.075, 0.68, 0.88),
            previousMisc.z
        );
        ambientColor = mix(duneShadow, duneRidge, effectiveRidge);
        ambientColor = mix(
            ambientColor,
            vec3(0.24, 0.07, 0.48),
            smoothstep(0.88, 1.0, palette) * effectiveRidge * 0.36
        );
        float sunsetInfluence = exp(-7.5 * pow(positionPhase.x - 0.326, 2.0))
            * (1.0 - previousMisc.z);
        ambientColor = mix(
            ambientColor,
            vec3(0.72, 0.12, 0.24),
            sunsetInfluence * effectiveRidge * 0.38
        );
        ambientEnergy = (0.42 + twinkle * 0.56)
            * (0.22 + previousMisc.z * 0.82)
            * (0.28 + effectiveRidge * 1.02)
            * (0.58 + depthCrest * 0.72);
    } else if (layer > 1.5) {
        ambientColor = mix(vec3(0.02, 0.3, 0.48), vec3(0.36, 0.055, 0.58), palette);
        ambientColor = mix(ambientColor, vec3(0.055, 0.48, 0.52), ridgeLight * 0.3);
        ambientEnergy = (0.3 + twinkle * 0.3) * (0.48 + ridgeLight * 0.62);
    } else {
        ambientColor = mix(vec3(0.38, 0.7, 1.0), vec3(0.72, 0.42, 0.94), palette);
        ambientColor = mix(ambientColor, vec3(0.78, 0.9, 1.0), 0.28);
        ambientColor = mix(
            ambientColor,
            vec3(0.94, 0.985, 1.0),
            mediumStar * 0.34 + largeStar * 0.58
        );
        ambientEnergy = 0.58
            + twinkle * 0.28
            + mediumStar * 0.5
            + largeStar * 1.55;
        float wordClearance = exp(
            -1.7 * positionPhase.x * positionPhase.x
            -9.0 * pow(positionPhase.y + 0.19, 2.0)
        );
        ambientEnergy *= 1.0 - wordClearance * 0.72;
    }
    ambientKind = layer;
    ambientDepth = previousMisc.z;
    ambientRidge = layer > 2.5 ? max(ridgeLight, depthCrest * 0.96) : ridgeLight;
    ambientSparkle = sharpTwinkle;
}`,
        fragmentSource: `#version 310 es
precision highp float;
in vec2 localPosition;
in vec3 ambientColor;
in float ambientEnergy;
in float ambientKind;
in float ambientDepth;
in float ambientRidge;
in float ambientSparkle;
layout(location = 0) out vec4 color;
void main() {
    float radius = length(localPosition);
    if (radius > 1.0) discard;
    float radiusSquared = radius * radius;
    if (ambientKind > 2.5) {
        float grain = exp(-7.5 * radiusSquared);
        float hotCore = exp(-34.0 * radiusSquared);
        float windGlint = exp(-46.0 * localPosition.y * localPosition.y)
            * exp(-4.0 * localPosition.x * localPosition.x);
        vec3 spectral = mix(
            ambientColor,
            vec3(0.24, 0.86, 1.0),
            hotCore * ambientRidge * (0.14 + ambientDepth * 0.18)
        );
        float shape = grain * 0.58 + hotCore * 0.86 + windGlint * 0.18;
        color = vec4(
            spectral,
            shape * ambientEnergy * (0.07 + ambientDepth * 0.4)
        );
    } else if (ambientKind > 1.5) {
        float cloud = exp(-2.35 * radiusSquared)
            * (1.0 - smoothstep(0.72, 1.0, radius));
        color = vec4(ambientColor, cloud * ambientEnergy * 0.032);
    } else {
        float diamond = max(abs(localPosition.x), abs(localPosition.y));
        float star = exp(-38.0 * diamond * diamond);
        float flare = exp(-210.0 * localPosition.x * localPosition.x)
            + exp(-210.0 * localPosition.y * localPosition.y);
        vec3 spectral = mix(ambientColor, vec3(0.86, 0.95, 1.0), star * 0.4);
        spectral = mix(spectral, vec3(1.0), ambientSparkle * 0.72);
        float starShape = star * (0.78 + ambientSparkle * 0.88)
            + flare * (0.006 + ambientSparkle * 0.26);
        color = vec4(spectral, starShape * ambientEnergy);
    }
}`,
        bindings: [
            {
                name: 'InteractionBlock',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: 64
            },
            {
                name: 'particleState',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: PARTICLE_BUFFER_BYTE_LENGTH
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

function particleDrawPass(
    name: string,
    scaleMultiplier: number,
    halo: boolean
): Hilo3d.GPUDrivenRenderPass {
    return new Hilo3d.GPUDrivenRenderPass({
        name,
        shader: new Hilo3d.StorageGraphicsShader({
            label: `${name} storage vertex pulling`,
            vertexSource: `#version 310 es
precision highp float;
precision highp int;
layout(std140) uniform InteractionBlock {
    vec4 u_pointer;
    vec4 u_motion;
    vec4 u_time;
    vec4 u_tuning;
};
layout(std430) readonly buffer ParticleState {
    vec4 values[];
} particleState;
out vec2 localPosition;
out vec3 particleColor;
out float particleEnergy;
out float collisionFlash;
out float sparkle;
out float scanEnergy;
out float wordEdge;
out vec2 crystalAxis;

void main() {
    int particleIndex = int(floor(float(gl_VertexID) / 6.0));
    int localVertexIndex = int(mod(float(gl_VertexID), 6.0));
    int recordIndex = particleIndex * 4;
    vec4 positionPhase = particleState.values[recordIndex];
    vec4 velocitySeed = particleState.values[recordIndex + 1];
    vec4 targetMeta = particleState.values[recordIndex + 2];
    vec4 previousMisc = particleState.values[recordIndex + 3];
    localPosition = vec2(-1.0, -1.0);
    if (localVertexIndex == 1 || localVertexIndex >= 4) localPosition.x = 1.0;
    if (localVertexIndex == 2 || localVertexIndex == 3 || localVertexIndex == 5) localPosition.y = 1.0;

    float twinkle = 0.5 + 0.5 * sin(positionPhase.z * 1.12 + velocitySeed.z * 0.013);
    float rareSparkle = pow(
        max(0.0, sin(positionPhase.z * 2.17 + velocitySeed.z * 0.019)),
        34.0
    );
    float scanCoordinate = positionPhase.x + positionPhase.y * 0.26;
    float scanCycle = mod(u_time.x, 10.0);
    float scanProgress = clamp(scanCycle / 5.0, 0.0, 1.0);
    float scanActivity = 1.0 - smoothstep(4.85, 5.0, scanCycle);
    float scanPosition = -1.08 + scanProgress * 2.16;
    scanEnergy = exp(-340.0 * pow(scanCoordinate - scanPosition, 2.0)) * scanActivity;
    wordEdge = clamp(targetMeta.z, 0.0, 1.0);
    collisionFlash = positionPhase.w;
    sparkle = clamp(rareSparkle * 0.82 + scanEnergy * 0.34 + collisionFlash * 0.72, 0.0, 1.5);

    float width = ${String(scaleMultiplier)}
        * (0.0018 + previousMisc.z * 0.0021 + wordEdge * 0.0003 + twinkle * 0.00025);
    float crystalAngle = velocitySeed.z * 0.031 + positionPhase.z * 0.045;
    crystalAxis = vec2(cos(crystalAngle), sin(crystalAngle));
    vec2 physicalOffset = localPosition * width;
    vec2 clipOffset = vec2(physicalOffset.x / u_time.z, physicalOffset.y);

    float colorPhase = fract(velocitySeed.z * 0.0073);
    vec3 electricBlue = vec3(0.065, 0.5, 1.0);
    vec3 ultraviolet = vec3(0.46, 0.1, 0.98);
    particleColor = mix(electricBlue, ultraviolet, smoothstep(0.28, 0.9, colorPhase));
    particleColor = mix(
        particleColor,
        vec3(0.12, 1.0, 1.0),
        wordEdge * 0.82
    );
    particleColor = mix(
        particleColor,
        vec3(0.72, 0.98, 1.0),
        scanEnergy * 0.55 + collisionFlash * 0.34
    );
    particleEnergy = 0.86
        + twinkle * 0.2
        + wordEdge * 0.18
        + velocitySeed.w * 0.14
        + sparkle * 0.34
        + scanEnergy * 0.28;
    gl_Position = vec4(positionPhase.xy + clipOffset, 0.0, 1.0);
}`,
            fragmentSource: halo
                ? `#version 310 es
precision highp float;
in vec2 localPosition;
in vec3 particleColor;
in float particleEnergy;
in float collisionFlash;
in float sparkle;
in float scanEnergy;
in float wordEdge;
in vec2 crystalAxis;
layout(location = 0) out vec4 color;
void main() {
    float radiusSquared = dot(localPosition, localPosition);
    if (radiusSquared > 1.0) discard;
    float radius = sqrt(radiusSquared);
    vec2 axisNormal = vec2(-crystalAxis.y, crystalAxis.x);
    float softBloom = exp(-4.0 * radiusSquared)
        * (1.0 - smoothstep(0.82, 1.0, radius));
    float longRay = exp(-420.0 * pow(dot(localPosition, axisNormal), 2.0))
        * exp(-4.2 * radiusSquared);
    float shortRay = exp(-620.0 * pow(dot(localPosition, crystalAxis), 2.0))
        * exp(-7.0 * radiusSquared);
    float glint = (longRay + shortRay * 0.62) * sparkle;
    vec3 spectral = mix(particleColor, vec3(0.08, 0.72, 1.0), 0.36 + wordEdge * 0.4);
    spectral = mix(spectral, vec3(0.76, 0.98, 1.0), scanEnergy * 0.62);
    float alpha = softBloom
            * (0.038 + wordEdge * 0.042 + scanEnergy * 0.075 + collisionFlash * 0.06)
        + glint * (0.5 + scanEnergy * 0.12)
        + exp(-16.0 * radiusSquared) * sparkle * 0.11;
    color = vec4(spectral, alpha * particleEnergy);
}`
                : `#version 310 es
precision highp float;
in vec2 localPosition;
in vec3 particleColor;
in float particleEnergy;
in float collisionFlash;
in float sparkle;
in float scanEnergy;
in float wordEdge;
in vec2 crystalAxis;
layout(location = 0) out vec4 color;
void main() {
    float radiusSquared = dot(localPosition, localPosition);
    float radius = sqrt(radiusSquared);
    if (radius > 1.0) discard;
    float pointMask = 1.0 - smoothstep(0.62, 1.0, radius);
    float hotCore = exp(-11.0 * radiusSquared);
    float microRing = smoothstep(0.32, 0.58, radius)
        * (1.0 - smoothstep(0.58, 0.86, radius));
    float dataPulse = 0.82 + sparkle * 0.28 + collisionFlash * 0.34;
    vec3 spectral = particleColor * (0.94 + hotCore * 0.52);
    spectral += vec3(0.04, 0.42, 0.78) * microRing * (0.2 + wordEdge * 0.24);
    spectral = mix(
        spectral,
        vec3(0.88, 0.99, 1.0),
        hotCore * (0.12 + sparkle * 0.58) + scanEnergy * 0.48
    );
    spectral = mix(spectral, vec3(0.86, 0.97, 1.0), collisionFlash * 0.42);
    float opacity = pointMask
        * (0.68 + hotCore * 0.32 + wordEdge * 0.12 + scanEnergy * 0.08);
    color = vec4(spectral * particleEnergy * dataPulse, min(opacity, 1.0));
}`,
            bindings: [
                {
                    name: 'InteractionBlock',
                    group: 0,
                    binding: 0,
                    kind: 'uniform-buffer',
                    minBindingSize: 64
                },
                {
                    name: 'particleState',
                    group: 0,
                    binding: 1,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: PARTICLE_BUFFER_BYTE_LENGTH
                }
            ]
        }),
        pipelineState: {
            ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none',
            blend: halo
                ? Hilo3d.MaterialBlendPreset.STRAIGHT_ALPHA_ADDITIVE
                : Hilo3d.MaterialBlendPreset.STRAIGHT_ALPHA
        }
    });
}

const PARTICLE_HALO_PASS = particleDrawPass('Holographic Hilo3D micro-particle aura', 5.4, true);
const PARTICLE_CORE_PASS = particleDrawPass('Hilo3D constellation data points', 1.27, false);

interface ParticleResources {
    readonly particles: Hilo3d.StorageBuffer;
}

class ReusableBufferBinding implements Hilo3d.ComputeBufferBinding {
    buffer!: Hilo3d.RenderGraphBufferHandle;
}

class ReusableColorAttachment implements Hilo3d.RenderPipelineColorAttachment {
    texture!: Hilo3d.RenderGraphTextureHandle;
    readonly loadOp: 'clear' | 'load';
    readonly storeOp = 'store';
    readonly clearValue = BACKGROUND_COLOR;

    constructor(loadOp: 'clear' | 'load') {
        this.loadOp = loadOp;
    }
}

class ReusableIndirectDraw {
    readonly kind = 'draw-indirect';
    buffer!: Hilo3d.RenderGraphBufferHandle;
    byteOffset = 0;
}

class ParticleComputeParameters implements Hilo3d.ComputeRenderPassParameters {
    readonly uniformBuffers = [interactionBlock];
    readonly #particleBinding = new ReusableBufferBinding();
    readonly #argumentBinding = new ReusableBufferBinding();
    readonly buffers = [this.#particleBinding, this.#argumentBinding];
    readonly textures: readonly Hilo3d.ComputeTextureBinding[] = Object.freeze([]);
    readonly dispatch = Object.freeze({ x: PARTICLE_WORKGROUP_COUNT });

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        argumentsBuffer: Hilo3d.RenderGraphBufferHandle
    ): void {
        this.#particleBinding.buffer = particles;
        this.#argumentBinding.buffer = argumentsBuffer;
    }
}

class BackgroundParameters implements Hilo3d.GPUDrivenRenderPassParameters {
    readonly uniformBuffers = [interactionBlock];
    readonly #particleBinding = new ReusableBufferBinding();
    readonly #colorAttachment = new ReusableColorAttachment('clear');
    readonly buffers = [this.#particleBinding];
    readonly draw = Object.freeze({ kind: 'draw' as const, vertexCount: 6 });
    readonly colorAttachments = [this.#colorAttachment];
    readonly viewport = FULL_VIEWPORT;
    readonly scissor = FULL_VIEWPORT;

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        outputColor: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.#particleBinding.buffer = particles;
        this.#colorAttachment.texture = outputColor;
    }
}

class ParticleDrawParameters implements Hilo3d.GPUDrivenRenderPassParameters {
    readonly uniformBuffers = [interactionBlock];
    readonly #particleBinding = new ReusableBufferBinding();
    readonly #colorAttachment = new ReusableColorAttachment('load');
    readonly #indirectDraw = new ReusableIndirectDraw();
    readonly buffers = [this.#particleBinding];
    readonly draw = this.#indirectDraw;
    readonly colorAttachments = [this.#colorAttachment];
    readonly viewport = FULL_VIEWPORT;
    readonly scissor = FULL_VIEWPORT;

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        argumentsBuffer: Hilo3d.RenderGraphBufferHandle,
        outputColor: Hilo3d.RenderGraphTextureHandle,
        byteOffset = 0
    ): void {
        this.#particleBinding.buffer = particles;
        this.#indirectDraw.buffer = argumentsBuffer;
        this.#indirectDraw.byteOffset = byteOffset;
        this.#colorAttachment.texture = outputColor;
    }
}

class ParticleFrameParameters {
    readonly compute = new ParticleComputeParameters();
    readonly background = new BackgroundParameters();
    readonly ambient = new ParticleDrawParameters();
    readonly halo = new ParticleDrawParameters();
    readonly core = new ParticleDrawParameters();

    configure(
        particles: Hilo3d.RenderGraphBufferHandle,
        argumentsBuffer: Hilo3d.RenderGraphBufferHandle,
        outputColor: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.compute.configure(particles, argumentsBuffer);
        this.background.configure(particles, outputColor);
        this.ambient.configure(particles, argumentsBuffer, outputColor, 16);
        this.halo.configure(particles, argumentsBuffer, outputColor);
        this.core.configure(particles, argumentsBuffer, outputColor);
    }
}

class QuantumParticlePipeline implements Hilo3d.RenderPipeline {
    readonly name = 'Interactive Hilo3D WebGPU particle field';
    readonly #parameters = new Hilo3d.RenderPassParameterPool(() => new ParticleFrameParameters());
    #resources: ParticleResources | null = null;

    attachResources(resources: ParticleResources): void {
        if (this.#resources !== null) throw new Error('Particle resources are already attached');
        this.#resources = resources;
    }

    record(context: Hilo3d.RenderPipelineContext): void {
        const resources = this.#resources;
        if (resources === null) throw new Error('Particle resources are unavailable');
        const outputColor = context.graph.importOutput().color(0);
        const particles = context.graph.importStorageBuffer(resources.particles);
        const argumentsBuffer = context.graph.createBuffer(
            'Quantum particle indirect draw arguments',
            INDIRECT_ARGUMENT_DESCRIPTOR
        );
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.configure(particles, argumentsBuffer, outputColor);
        context.graph.addPass(PARTICLE_COMPUTE_PASS, parameters.compute);
        context.graph.addPass(BACKGROUND_PASS, parameters.background);
        context.graph.addPass(AMBIENT_PARTICLE_PASS, parameters.ambient);
        context.graph.addPass(PARTICLE_HALO_PASS, parameters.halo);
        context.graph.addPass(PARTICLE_CORE_PASS, parameters.core);
    }

    destroy(): void {
        this.#resources = null;
    }
}

class QuantumParticlePipelineFactory implements Hilo3d.RenderPipelineFactory {
    readonly name = 'Interactive Hilo3D WebGPU particle field';
    readonly requirements: Readonly<Hilo3d.RenderPipelineRequirements> = Object.freeze({
        requiredCapabilities: REQUIRED_CAPABILITIES,
        requiredLimits: Object.freeze({
            maxStorageBuffersPerShaderStage: 2,
            maxComputeInvocationsPerWorkgroup: PARTICLE_WORKGROUP_SIZE
        })
    });
    readonly runtime = new QuantumParticlePipeline();

    create(): Hilo3d.RenderPipeline {
        return this.runtime;
    }
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

const WORDMARK_TEXT = 'Hilo3d';
const WORDMARK_RASTER_WIDTH = 1536;
const WORDMARK_RASTER_HEIGHT = 384;

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
    return (value >>> 0) / 0x1_0000_0000;
}

function wordmarkCells(): readonly WordmarkCell[] {
    const gapColumns = 1;
    let totalColumns = -gapColumns;
    for (const glyph of HILO3D_GLYPHS) {
        const firstRow = glyph.rows[0];
        if (firstRow === undefined) throw new Error('Hilo3D glyph must have at least one row');
        totalColumns += firstRow.length + gapColumns;
    }
    const xStep = 1.2 / (totalColumns - 1);
    const yStep = 0.077;
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
                    x: -0.6 + (columnOffset + column) * xStep,
                    y: (3 - row) * yStep + 0.19,
                    palette: glyph.palette
                });
            }
        }
        columnOffset += firstRow.length + gapColumns;
    }
    return cells;
}

function rasterizedWordmarkCells(): readonly WordmarkCell[] {
    const canvas = document.createElement('canvas');
    canvas.width = WORDMARK_RASTER_WIDTH;
    canvas.height = WORDMARK_RASTER_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return wordmarkCells();

    context.clearRect(0, 0, WORDMARK_RASTER_WIDTH, WORDMARK_RASTER_HEIGHT);
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '900 318px "Arial Rounded MT Bold", "Avenir Next", "Trebuchet MS", sans-serif';
    context.fillText(
        WORDMARK_TEXT,
        WORDMARK_RASTER_WIDTH * 0.5,
        WORDMARK_RASTER_HEIGHT * 0.51,
        WORDMARK_RASTER_WIDTH - 72
    );

    const image = context.getImageData(0, 0, WORDMARK_RASTER_WIDTH, WORDMARK_RASTER_HEIGHT);
    let minimumX = WORDMARK_RASTER_WIDTH;
    let minimumY = WORDMARK_RASTER_HEIGHT;
    let maximumX = -1;
    let maximumY = -1;
    for (let y = 0; y < WORDMARK_RASTER_HEIGHT; y += 1) {
        for (let x = 0; x < WORDMARK_RASTER_WIDTH; x += 1) {
            const alpha = image.data[(y * WORDMARK_RASTER_WIDTH + x) * 4 + 3] ?? 0;
            if (alpha < 72) continue;
            minimumX = Math.min(minimumX, x);
            minimumY = Math.min(minimumY, y);
            maximumX = Math.max(maximumX, x);
            maximumY = Math.max(maximumY, y);
        }
    }
    if (maximumX <= minimumX || maximumY <= minimumY) return wordmarkCells();

    const centerX = (minimumX + maximumX) * 0.5;
    const centerY = (minimumY + maximumY) * 0.5;
    const visualWidth = 1.2;
    const rasterWidth = maximumX - minimumX;
    const rasterHeight = maximumY - minimumY;
    const visualHeight = Math.min(0.88, (visualWidth * TARGET_ASPECT * rasterHeight) / rasterWidth);
    const cells: WordmarkCell[] = [];
    const edgeSampleRadius = 6;
    for (let y = minimumY; y <= maximumY; y += 2) {
        for (let x = minimumX; x <= maximumX; x += 2) {
            const alpha = image.data[(y * WORDMARK_RASTER_WIDTH + x) * 4 + 3] ?? 0;
            if (alpha < 72) continue;
            const leftX = Math.max(0, x - edgeSampleRadius);
            const rightX = Math.min(WORDMARK_RASTER_WIDTH - 1, x + edgeSampleRadius);
            const upperY = Math.max(0, y - edgeSampleRadius);
            const lowerY = Math.min(WORDMARK_RASTER_HEIGHT - 1, y + edgeSampleRadius);
            const leftAlpha = image.data[(y * WORDMARK_RASTER_WIDTH + leftX) * 4 + 3] ?? 0;
            const rightAlpha = image.data[(y * WORDMARK_RASTER_WIDTH + rightX) * 4 + 3] ?? 0;
            const upperAlpha = image.data[(upperY * WORDMARK_RASTER_WIDTH + x) * 4 + 3] ?? 0;
            const lowerAlpha = image.data[(lowerY * WORDMARK_RASTER_WIDTH + x) * 4 + 3] ?? 0;
            const edge = Math.min(leftAlpha, rightAlpha, upperAlpha, lowerAlpha) < 72 ? 1 : 0;
            const cell: WordmarkCell = {
                x: ((x - centerX) / rasterWidth) * visualWidth,
                y: ((centerY - y) / rasterHeight) * visualHeight + 0.19,
                palette: edge
            };
            cells.push(cell);
            if (edge === 1) cells.push(cell, cell, cell);
        }
    }
    return cells.length === 0 ? wordmarkCells() : cells;
}

let cachedWordmarkCells: readonly WordmarkCell[] | undefined;

function wordmarkTargetCells(): readonly WordmarkCell[] {
    cachedWordmarkCells ??= rasterizedWordmarkCells();
    return cachedWordmarkCells;
}

function particleInitialData(): Float32Array {
    const cells = wordmarkTargetCells();
    if (cells.length === 0) throw new Error('Hilo3D particle wordmark has no active cells');
    const data = new Float32Array(PARTICLE_COUNT * PARTICLE_FLOATS_PER_RECORD);
    for (let index = 0; index < WORD_PARTICLE_COUNT; index += 1) {
        const cellIndex = Math.min(
            cells.length - 1,
            Math.floor(deterministicUnit(index, 0x2e2ac13b) * cells.length)
        );
        const cell = cells[cellIndex];
        if (cell === undefined) throw new Error('Hilo3D particle target is unavailable');
        const edgeFactor = cell.palette;
        const angle = deterministicUnit(index, 0x68bc21eb) * Math.PI * 2;
        const targetX =
            cell.x + (deterministicUnit(index, 0x7f4a7c15) - 0.5) * (0.006 - edgeFactor * 0.004);
        const visualTargetY =
            cell.y + (deterministicUnit(index, 0x31e0f6a7) - 0.5) * (0.007 - edgeFactor * 0.0045);
        const targetY = visualTargetY;
        const cloudRadius =
            0.001 + deterministicUnit(index, 0x967a889b) * (0.004 - edgeFactor * 0.0025);
        const cloudAngle = angle + deterministicUnit(index, 0x02e5be93) * 1.7;
        const positionX = targetX + Math.cos(cloudAngle) * cloudRadius;
        const visualPositionY = visualTargetY + Math.sin(cloudAngle) * cloudRadius;
        const positionY = visualPositionY;
        const velocityScale = 0.018 + deterministicUnit(index, 0x4f1bbcdc) * 0.02;
        const offset = index * PARTICLE_FLOATS_PER_RECORD;
        data[offset] = positionX;
        data[offset + 1] = positionY;
        data[offset + 2] = deterministicUnit(index, 0x51ed270b) * Math.PI * 2;
        data[offset + 3] = 0;
        data[offset + 4] = -Math.sin(cloudAngle) * velocityScale;
        data[offset + 5] = Math.cos(cloudAngle) * velocityScale;
        data[offset + 6] = deterministicUnit(index, 0x6d2b79f5) * 2048 + index;
        data[offset + 7] = deterministicUnit(index, 0x1b56c4e9) * 0.5;
        data[offset + 8] = targetX;
        data[offset + 9] = targetY;
        data[offset + 10] = cell.palette;
        data[offset + 11] = 1.2 + deterministicUnit(index, 0x7f4a7c15) * 0.6 + edgeFactor * 0.45;
        data[offset + 12] = positionX;
        data[offset + 13] = positionY;
        data[offset + 14] = deterministicUnit(index, 0x31e0f6a7) * 0.42;
        data[offset + 15] = 0;
    }
    for (let ambientIndex = 0; ambientIndex < AMBIENT_PARTICLE_COUNT; ambientIndex += 1) {
        const index = WORD_PARTICLE_COUNT + ambientIndex;
        const angle = deterministicUnit(ambientIndex, 0x51ed270b) * Math.PI * 2;
        const layerSelector = deterministicUnit(ambientIndex, 0x23d5f481);
        let layer: number;
        let depth = deterministicUnit(ambientIndex, 0x31e0f6a7);
        let palette = deterministicUnit(ambientIndex, 0x1b56c4e9);
        let ridgeLight: number;
        let anchorX: number;
        let anchorY: number;
        let positionX: number;
        let positionY: number;
        let velocityX: number;
        let velocityY: number;

        if (layerSelector < 0.9) {
            layer = 3;
            const bandCount = 64;
            const band = ambientIndex % bandCount;
            depth = Math.pow(
                (band + 0.24 + deterministicUnit(ambientIndex, 0x9e8c21a7) * 0.52) / bandCount,
                0.82
            );
            anchorX = -1.08 + deterministicUnit(ambientIndex, 0x68bc21eb) * 2.16;
            const macroFrequency = 2.05 + depth * 1.35;
            const macroAmplitude = 0.055 + depth * 0.045;
            const macroWave = Math.sin(anchorX * macroFrequency + depth * 5.4) * macroAmplitude;
            const primaryWave =
                Math.sin(anchorX * (3.4 + depth * 5.2) + depth * 12.0) * (0.035 + depth * 0.038);
            const detailWave = Math.sin(anchorX * 12.5 - depth * 19.0) * (0.008 + depth * 0.013);
            const duneSlope =
                Math.cos(anchorX * macroFrequency + depth * 5.4) * macroFrequency * macroAmplitude +
                Math.cos(anchorX * (3.4 + depth * 5.2) + depth * 12.0) *
                    (3.4 + depth * 5.2) *
                    (0.035 + depth * 0.038);
            const slopeLight = Math.max(0, Math.min(1, 0.48 - duneSlope * 1.7));
            const crestLight = Math.max(0, Math.min(1, 0.44 + (macroWave + primaryWave) * 4.6));
            const contourLight = band % 8 === 0 ? 1 : band % 4 === 0 ? 0.58 : 0.16;
            ridgeLight = Math.max(
                0.08,
                Math.min(1, 0.08 + slopeLight * 0.4 + crestLight * 0.28 + contourLight * 0.24)
            );
            const grainJitter =
                (deterministicUnit(ambientIndex, 0x967a889b) - 0.5) * (0.004 + depth * 0.015);
            const visualAnchorY = Math.max(
                -1.08,
                Math.min(
                    -0.07,
                    -0.09 - depth * 0.99 + macroWave + primaryWave + detailWave + grainJitter
                )
            );
            anchorY = visualAnchorY;
            const cloudRadius =
                0.0015 + deterministicUnit(ambientIndex, 0x02e5be93) * (0.004 + depth * 0.01);
            positionX = anchorX + Math.cos(angle) * cloudRadius;
            positionY = visualAnchorY + Math.sin(angle) * cloudRadius;
            const velocityScale =
                0.002 + deterministicUnit(ambientIndex, 0x4f1bbcdc) * (0.006 + depth * 0.012);
            velocityX = Math.cos(angle) * velocityScale;
            velocityY = Math.sin(angle) * velocityScale * 0.35;
            palette = deterministicUnit(ambientIndex, 0x6d2b79f5);
        } else if (layerSelector < 0.95) {
            layer = 2;
            anchorX = -1.08 + deterministicUnit(ambientIndex, 0x68bc21eb) * 2.16;
            const leftCloud = Math.exp(-Math.pow((anchorX + 0.52) / 0.46, 2));
            const rightCloud = Math.exp(-Math.pow((anchorX - 0.38) / 0.58, 2));
            ridgeLight = Math.min(
                1,
                0.12 +
                    Math.max(leftCloud, rightCloud) *
                        (0.48 + deterministicUnit(ambientIndex, 0xa24baed4) * 0.4)
            );
            const nebulaWave =
                Math.sin(anchorX * 1.75 + 0.8) * 0.11 + Math.sin(anchorX * 4.1 - 1.2) * 0.035;
            const visualAnchorY = Math.max(
                0.06,
                Math.min(
                    0.95,
                    0.49 + nebulaWave + (deterministicUnit(ambientIndex, 0x9e8c21a7) - 0.5) * 0.52
                )
            );
            anchorY = visualAnchorY;
            const cloudRadius = 0.018 + deterministicUnit(ambientIndex, 0x967a889b) * 0.07;
            positionX = anchorX + Math.cos(angle) * cloudRadius;
            positionY = visualAnchorY + Math.sin(angle) * cloudRadius;
            const velocityScale = 0.0003 + deterministicUnit(ambientIndex, 0x4f1bbcdc) * 0.001;
            velocityX = -Math.sin(angle) * velocityScale;
            velocityY = Math.cos(angle) * velocityScale;
        } else {
            layer = 1;
            anchorX = -1.08 + deterministicUnit(ambientIndex, 0x68bc21eb) * 2.16;
            const visualAnchorY = 0.03 + deterministicUnit(ambientIndex, 0x9e8c21a7) * 0.88;
            const brightPlacement = Math.max(
                0,
                Math.min(
                    1,
                    Math.max((visualAnchorY - 0.22) / 0.68, (Math.abs(anchorX) - 0.42) / 0.53)
                )
            );
            ridgeLight =
                deterministicUnit(ambientIndex, 0xa24baed4) * (0.52 + brightPlacement * 0.48);
            anchorY = visualAnchorY;
            const cloudRadius = 0.004 + deterministicUnit(ambientIndex, 0x967a889b) * 0.02;
            positionX = anchorX + Math.cos(angle) * cloudRadius;
            positionY = visualAnchorY + Math.sin(angle) * cloudRadius;
            const velocityScale = 0.002 + deterministicUnit(ambientIndex, 0x4f1bbcdc) * 0.007;
            velocityX = -Math.sin(angle) * velocityScale;
            velocityY = Math.cos(angle) * velocityScale;
        }

        const offset = index * PARTICLE_FLOATS_PER_RECORD;
        data[offset] = positionX;
        data[offset + 1] = positionY;
        data[offset + 2] = deterministicUnit(ambientIndex, 0x2e2ac13b) * Math.PI * 2;
        data[offset + 3] = 0;
        data[offset + 4] = velocityX;
        data[offset + 5] = velocityY;
        data[offset + 6] = deterministicUnit(ambientIndex, 0x6d2b79f5) * 4096 + index;
        data[offset + 7] = deterministicUnit(ambientIndex, 0x1b56c4e9) * 0.35;
        data[offset + 8] = anchorX;
        data[offset + 9] = anchorY;
        data[offset + 10] = palette;
        data[offset + 11] = ridgeLight;
        data[offset + 12] = positionX;
        data[offset + 13] = positionY;
        data[offset + 14] = depth;
        data[offset + 15] = layer;
    }
    return data;
}

class InteractionController implements Hilo3d.Tickable {
    readonly #pointer = new Float32Array(4);
    readonly #motion = new Float32Array(4);
    readonly #time = new Float32Array([0, 1 / 60, TARGET_ASPECT, 0]);
    readonly #tuning = new Float32Array([1, 0.78, 0.092, PARTICLE_COUNT]);
    #lastPointerX = 0;
    #lastPointerY = 0;
    #targetVelocityX = 0;
    #targetVelocityY = 0;
    #pulse = 0;
    #elapsed = 0;
    #frame = 0;
    #revision = 0;

    get revision(): number {
        return this.#revision;
    }

    get pointerX(): number {
        return this.#pointer[0] ?? 0;
    }

    get pointerY(): number {
        return this.#pointer[1] ?? 0;
    }

    get pointerActive(): boolean {
        return this.#pointer[2] === 1;
    }

    attach(canvas: HTMLCanvasElement): void {
        const updatePointer = (event: PointerEvent): void => {
            const bounds = canvas.getBoundingClientRect();
            const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
            // DOM pointer Y grows downward; simulation and raster clip-space Y grow upward.
            const y = 1 - ((event.clientY - bounds.top) / bounds.height) * 2;
            const alreadyActive = this.#pointer[2] === 1;
            this.#targetVelocityX = alreadyActive ? x - this.#lastPointerX : 0;
            this.#targetVelocityY = alreadyActive ? y - this.#lastPointerY : 0;
            this.#lastPointerX = x;
            this.#lastPointerY = y;
            this.#pointer[0] = x;
            this.#pointer[1] = y;
            this.#pointer[2] = 1;
            this.#pointer[3] = (event.buttons & 2) !== 0 ? -1 : (event.buttons & 1) !== 0 ? 1 : 0;
            this.#revision += 1;
        };

        canvas.addEventListener('pointerenter', updatePointer);
        canvas.addEventListener('pointermove', updatePointer);
        canvas.addEventListener('pointerdown', event => {
            updatePointer(event);
            this.#pulse = 1;
            canvas.setPointerCapture(event.pointerId);
        });
        canvas.addEventListener('pointerup', event => {
            updatePointer(event);
            this.#pointer[3] = 0;
            if (canvas.hasPointerCapture(event.pointerId))
                canvas.releasePointerCapture(event.pointerId);
        });
        canvas.addEventListener('pointercancel', () => {
            this.#pointer[2] = 0;
            this.#pointer[3] = 0;
            this.#revision += 1;
        });
        canvas.addEventListener('pointerleave', event => {
            if (event.buttons !== 0) return;
            this.#pointer[2] = 0;
            this.#pointer[3] = 0;
            this.#revision += 1;
        });
        canvas.addEventListener('contextmenu', event => {
            event.preventDefault();
        });
    }

    tick(deltaTime: number): void {
        const seconds = Math.min(Math.max(deltaTime * 0.001, 1 / 240), 0.025);
        this.#elapsed += seconds;
        this.#frame += 1;
        this.#pulse *= Math.exp(-seconds * 3.6);
        const currentMotionX = this.#motion[0] ?? 0;
        const currentMotionY = this.#motion[1] ?? 0;
        this.#motion[0] =
            currentMotionX + (this.#targetVelocityX / seconds - currentMotionX) * 0.22;
        this.#motion[1] =
            currentMotionY + (this.#targetVelocityY / seconds - currentMotionY) * 0.22;
        this.#motion[2] = this.#pulse;
        this.#motion[3] = 1;
        this.#targetVelocityX *= 0.35;
        this.#targetVelocityY *= 0.35;
        this.#time[0] = this.#elapsed;
        this.#time[1] = seconds;
        this.#time[3] = this.#frame;
        interactionBlock.set('u_pointer', this.#pointer);
        interactionBlock.set('u_motion', this.#motion);
        interactionBlock.set('u_time', this.#time);
        interactionBlock.set('u_tuning', this.#tuning);
    }
}

interface ParticleEvidence {
    readonly backend: Hilo3d.RendererBackend;
    readonly particleCount: number;
    readonly coloredPixels: number;
    readonly luminousPixels: number;
    readonly luminousCenterX: number;
    readonly luminousCenterY: number;
    readonly distinctColors: number;
    readonly activeTiles: number;
    readonly wordSampleCoverage: number;
    readonly mirroredWordSampleCoverage: number;
    readonly ambientLuminousPixels: number;
    readonly hash: number;
    readonly interactionRevision: number;
    readonly pointerX: number;
    readonly pointerY: number;
    readonly pointerRingEnergy: number;
    readonly mirroredPointerRingEnergy: number;
}

function peakLuminance(data: Uint8Array, centerX: number, centerY: number): number {
    let peak = 0;
    const radius = 8;
    const minimumX = Math.max(0, Math.floor(centerX) - radius);
    const maximumX = Math.min(TARGET_WIDTH - 1, Math.ceil(centerX) + radius);
    const minimumY = Math.max(0, Math.floor(centerY) - radius);
    const maximumY = Math.min(TARGET_HEIGHT - 1, Math.ceil(centerY) + radius);
    for (let y = minimumY; y <= maximumY; y += 1) {
        for (let x = minimumX; x <= maximumX; x += 1) {
            const offset = (y * TARGET_WIDTH + x) * 4;
            peak = Math.max(
                peak,
                (data[offset] ?? 0) + (data[offset + 1] ?? 0) + (data[offset + 2] ?? 0)
            );
        }
    }
    return peak;
}

function wordSampleCoverage(data: Uint8Array, flipY: boolean): number {
    const cells = wordmarkTargetCells();
    const sampleStride = Math.max(1, Math.floor(cells.length / 96));
    let visibleCells = 0;
    let sampledCells = 0;
    for (let index = 0; index < cells.length; index += sampleStride) {
        const cell = cells[index];
        if (cell === undefined) continue;
        sampledCells += 1;
        const x = (cell.x * 0.5 + 0.5) * TARGET_WIDTH;
        const clipY = flipY ? -cell.y : cell.y;
        const y = (1 - clipY) * 0.5 * TARGET_HEIGHT;
        if (peakLuminance(data, x, y) > 190) visibleCells += 1;
    }
    return visibleCells / Math.max(sampledCells, 1);
}

function pointerRingEnergy(data: Uint8Array, centerX: number, centerY: number): number {
    const radius = 0.14 * TARGET_HEIGHT * 0.5;
    const sampleCount = 72;
    let energy = 0;
    for (let sample = 0; sample < sampleCount; sample += 1) {
        const angle = (sample / sampleCount) * Math.PI * 2;
        const x = Math.round(centerX + Math.cos(angle) * radius);
        const y = Math.round(centerY + Math.sin(angle) * radius);
        if (x < 0 || x >= TARGET_WIDTH || y < 0 || y >= TARGET_HEIGHT) continue;
        const offset = (y * TARGET_WIDTH + x) * 4;
        const red = data[offset] ?? 0;
        const green = data[offset + 1] ?? 0;
        const blue = data[offset + 2] ?? 0;
        energy += Math.max(0, green + blue - red);
    }
    return energy / sampleCount;
}

function analyzeFrame(
    data: Uint8Array,
    backend: Hilo3d.RendererBackend,
    controller: InteractionController
): ParticleEvidence {
    const colors = new Set<number>();
    const tiles = new Set<number>();
    let coloredPixels = 0;
    let luminousPixels = 0;
    let ambientLuminousPixels = 0;
    let luminousX = 0;
    let luminousY = 0;
    let hash = 0x811c9dc5;
    for (let y = 0; y < TARGET_HEIGHT; y += 1) {
        for (let x = 0; x < TARGET_WIDTH; x += 1) {
            const offset = (y * TARGET_WIDTH + x) * 4;
            const red = data[offset] ?? 0;
            const green = data[offset + 1] ?? 0;
            const blue = data[offset + 2] ?? 0;
            if (red > 7 || green > 15 || blue > 31) {
                coloredPixels += 1;
                tiles.add(Math.floor(x / 80) + Math.floor(y / 80) * 16);
            }
            if (red + green + blue > 230) {
                luminousPixels += 1;
                luminousX += x;
                luminousY += y;
                if (x < 100 || x >= TARGET_WIDTH - 100 || y < 150 || y >= TARGET_HEIGHT - 150) {
                    ambientLuminousPixels += 1;
                }
            }
            colors.add((red << 16) | (green << 8) | blue);
            for (let channel = 0; channel < 4; channel += 1) {
                hash ^= data[offset + channel] ?? 0;
                hash = Math.imul(hash, 0x01000193) >>> 0;
            }
        }
    }
    const pointerCenterX = (controller.pointerX * 0.5 + 0.5) * TARGET_WIDTH;
    // Public readback rows and DOM coordinates both originate at the top. Simulation clip-space
    // Y grows upward, so perform that single boundary conversion here.
    const pointerCenterY = (1 - controller.pointerY) * 0.5 * TARGET_HEIGHT;
    const mirroredPointerCenterY = (controller.pointerY * 0.5 + 0.5) * TARGET_HEIGHT;
    return {
        backend,
        particleCount: PARTICLE_COUNT,
        coloredPixels,
        luminousPixels,
        luminousCenterX: luminousX / Math.max(luminousPixels, 1),
        luminousCenterY: luminousY / Math.max(luminousPixels, 1),
        distinctColors: colors.size,
        activeTiles: tiles.size,
        wordSampleCoverage: wordSampleCoverage(data, false),
        mirroredWordSampleCoverage: wordSampleCoverage(data, true),
        ambientLuminousPixels,
        hash,
        interactionRevision: controller.revision,
        pointerX: controller.pointerX,
        pointerY: controller.pointerY,
        pointerRingEnergy: controller.pointerActive
            ? pointerRingEnergy(data, pointerCenterX, pointerCenterY)
            : 0,
        mirroredPointerRingEnergy: controller.pointerActive
            ? pointerRingEnergy(data, pointerCenterX, mirroredPointerCenterY)
            : 0
    };
}

const container = document.querySelector<HTMLElement>('#container');
if (!container) throw new Error('Particle example container is missing');
const factory = new QuantumParticlePipelineFactory();
const camera = new Hilo3d.PerspectiveCamera({ aspect: TARGET_ASPECT, near: 0.1, far: 10, z: 2 });
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
const target = stage.renderer.createRenderTarget({
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    colorAttachments: [{ clearValue: BACKGROUND_COLOR }]
});
const particles = stage.renderer.createStorageBuffer({
    label: 'Persistent interactive Hilo3D particle state',
    byteLength: PARTICLE_BUFFER_BYTE_LENGTH,
    usage: ['storage'],
    initialData: particleInitialData(),
    // Device loss deliberately restarts from the deterministic seed; per-frame GPU state is never
    // mirrored back to the CPU shadow.
    recovery: 'cpu-shadow'
});
factory.runtime.attachResources({ particles });
stage.renderer.setRenderTarget(target, {
    present: true,
    takeOwnership: true,
    // The custom pipeline authors and blends its final field in display-referred space.
    colorEncoding: 'srgb'
});

const controller = new InteractionController();
controller.attach(stage.canvas);

async function stepAndRead(frames: number): Promise<ParticleEvidence> {
    if (!Number.isSafeInteger(frames) || frames < 1 || frames > 240) {
        throw new RangeError('Particle test steps must be an integer in [1, 240]');
    }
    for (let frame = 0; frame < frames; frame += 1) {
        controller.tick(1000 / 60);
        stage.tick(1000 / 60);
    }
    await stage.renderer.waitForIdle();
    const readback = await target.readColorAttachment();
    return analyzeFrame(readback.data, stage.renderer.backend, controller);
}

const testMode = new URLSearchParams(window.location.search).has('test');
if (testMode) {
    window.__HILO3D_PARTICLE_TEST_API__ = { step: stepAndRead };
    window.__HILO3D_PARTICLE_RESULT__ = await stepAndRead(1);
    document.body.dataset['particleFieldReady'] = 'true';
} else {
    controller.tick(1000 / 60);
    stage.tick(1000 / 60);
    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(controller);
    ticker.addTick(stage);
    ticker.start();
    window.addEventListener(
        'pagehide',
        () => {
            ticker.stop();
        },
        { once: true }
    );
}

window.addEventListener(
    'pagehide',
    () => {
        particles.destroy();
        stage.destroy();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_PARTICLE_RESULT__?: ParticleEvidence;
        __HILO3D_PARTICLE_TEST_API__?: {
            readonly step: (frames: number) => Promise<ParticleEvidence>;
        };
    }
}
