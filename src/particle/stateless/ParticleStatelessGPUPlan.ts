import ComputeShader from '../../render/compute/ComputeShader';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import type { ParticleScalarValue, ParticleVector3Value } from '../ParticleTypes';

const WORKGROUP_SIZE = 64;

/** Stateless WebGPU renderer-input layout; it deliberately has no particle-state buffer. */
export interface ParticleStatelessGPUBufferLayout {
    readonly parameterByteLength: number;
    readonly rendererDataByteLength: number;
    readonly indirectArgumentByteLength: number;
    readonly persistentStateByteLength: 0;
}

/** Generated WebGPU data plan that can be recreated from definition, time and seed. */
export interface ParticleStatelessGPUPlan {
    readonly emitter: Readonly<ParticleCompiledEmitterPlan>;
    readonly buffers: Readonly<ParticleStatelessGPUBufferLayout>;
    readonly generate: ComputeShader;
    readonly workgroupCount: number;
    readonly recoveryPolicy: 'regenerate';
}

function align(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function f32(value: number): string {
    const rounded = Math.fround(value);
    return Number.isInteger(rounded) ? `${String(rounded)}.0` : String(rounded);
}

function scalar(value: ParticleScalarValue | undefined, fallback: number, lane: number): string {
    if (value === undefined) return f32(fallback);
    return typeof value === 'number'
        ? f32(value)
        : `mix(${f32(value.min)}, ${f32(value.max)}, particleRandom(stableId, ${String(lane)}u))`;
}

function vector(value: ParticleVector3Value | undefined, lane: number): string {
    if (value === undefined) return 'vec3<f32>(0.0)';
    if ('min' in value) {
        return `mix(vec3<f32>(${value.min.map(f32).join(', ')}), vec3<f32>(${value.max.map(f32).join(', ')}), vec3<f32>(particleRandom(stableId, ${String(lane)}u), particleRandom(stableId, ${String(lane + 1)}u), particleRandom(stableId, ${String(lane + 2)}u)))`;
    }
    return `vec3<f32>(${value.map(f32).join(', ')})`;
}

function motionSource(plan: Readonly<ParticleCompiledEmitterPlan>): string {
    const statements: string[] = [];
    for (const [index, module] of plan.definition.modules.entries()) {
        const lane = 100 + index * 8;
        switch (module.type) {
            case 'velocity-over-lifetime':
                statements.push(`position += ${vector(module.velocity, lane)} * age;`);
                break;
            case 'force-over-lifetime':
            case 'gravity':
            case 'wind': {
                const force = vector(module.force, lane);
                statements.push(
                    `position += 0.5 * ${force} * age * age; velocity += ${force} * age;`
                );
                break;
            }
            case 'drag':
                statements.push(
                    `let damping_${String(index)} = exp(-${f32(module.coefficient)} * age); velocity *= damping_${String(index)};`
                );
                break;
            default:
                break;
        }
    }
    return statements.join('\n');
}

/** Compile a no-state WebGPU generator before Render Graph frame construction. */
export function compileParticleStatelessGPUPlan(
    plan: Readonly<ParticleCompiledEmitterPlan>
): Readonly<ParticleStatelessGPUPlan> {
    if (plan.kind !== 'stateless') {
        throw new TypeError('Particle stateless GPU compiler requires a stateless emitter plan');
    }
    const buffers: ParticleStatelessGPUBufferLayout = Object.freeze({
        parameterByteLength: 64,
        rendererDataByteLength: align(plan.definition.capacity * 64, 16),
        indirectArgumentByteLength: 16,
        persistentStateByteLength: 0
    });
    const authoredRate = plan.definition.emission.rateOverTime;
    const rate =
        typeof authoredRate === 'number'
            ? f32(authoredRate)
            : authoredRate === undefined
              ? '0.0'
              : f32((authoredRate.min + authoredRate.max) * 0.5);
    const lifetime = scalar(plan.definition.initialize.lifetime, 1, 60);
    const size = scalar(plan.definition.initialize.size, 1, 70);
    const speed = scalar(plan.definition.initialize.speed, 0, 50);
    const initialPosition = vector(plan.definition.initialize.position, 30);
    const initialDirection = vector(plan.definition.initialize.direction, 40);
    const motion = motionSource(plan);
    const generate = new ComputeShader({
        label: `${plan.definition.name}:particle-stateless-generate`,
        source: `struct StatelessParameters {
    timing: vec4<f32>,
    identity: vec4<u32>,
    emitterPosition: vec4<f32>,
    output: vec4<u32>,
};
@group(0) @binding(0) var<uniform> params: StatelessParameters;
@group(0) @binding(1) var<storage, read_write> rendererData: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> indirectArguments: array<u32>;

fn mix32(input: u32) -> u32 {
    var value = input;
    value = (value ^ (value >> 16u)) * 0x7feb352du;
    value = (value ^ (value >> 15u)) * 0x846ca68bu;
    return value ^ (value >> 16u);
}

fn particleRandom(stableId: u32, lane: u32) -> f32 {
    var value = mix32(params.identity.x);
    value = mix32(value ^ params.identity.y * 0x9e3779b1u);
    value = mix32(value ^ stableId * 0x85ebca77u);
    value = mix32(value ^ lane * 0x27d4eb2fu);
    return f32(value) / 4294967296.0;
}

@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    let index = invocation.x;
    let rate = max(0.0, ${rate});
    let activeTime = max(0.0, params.timing.x - params.timing.y);
    let emissionTime = select(min(activeTime, params.timing.z), activeTime, params.identity.z != 0u);
    let totalSpawned = u32(floor(rate * emissionTime));
    let count = min(totalSpawned, params.output.x);
    if (index == 0u) {
        indirectArguments[0] = 6u;
        indirectArguments[1] = count;
        indirectArguments[2] = 0u;
        indirectArguments[3] = 0u;
    }
    if (index >= count || rate <= 0.0) { return; }
    let stableId = totalSpawned - count + index;
    let spawnTime = f32(stableId + 1u) / rate;
    let age = max(0.0, activeTime - spawnTime);
    let particleLifetime = max(0.000001, ${lifetime});
    let normalizedAge = clamp(age / particleLifetime, 0.0, 1.0);
    var position = ${initialPosition} + params.emitterPosition.xyz;
    var direction = ${initialDirection};
    if (length(direction) <= 0.000001) { direction = vec3<f32>(0.0, 1.0, 0.0); }
    var velocity = normalize(direction) * ${speed};
    position += velocity * age;
    ${motion}
    let visibleSize = select(${size}, 0.0, age >= particleLifetime);
    rendererData[index * 4u] = vec4<f32>(position, visibleSize);
    rendererData[index * 4u + 1u] = vec4<f32>(1.0);
    rendererData[index * 4u + 2u] = vec4<f32>(0.0, normalizedAge, 0.0, 0.0);
    rendererData[index * 4u + 3u] = vec4<f32>(velocity, 0.0);
}`,
        workgroupSize: [WORKGROUP_SIZE],
        bindings: [
            {
                name: 'params',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: buffers.parameterByteLength
            },
            {
                name: 'rendererData',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.rendererDataByteLength
            },
            {
                name: 'indirectArguments',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.indirectArgumentByteLength
            }
        ]
    });
    return Object.freeze({
        emitter: plan,
        buffers,
        generate,
        workgroupCount: Math.ceil(plan.definition.capacity / WORKGROUP_SIZE),
        recoveryPolicy: 'regenerate'
    });
}
