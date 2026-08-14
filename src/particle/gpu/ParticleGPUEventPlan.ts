import ComputeShader from '../../render/compute/ComputeShader';
import type { ParticleCompiledEmitterPlan, ParticleCompiledPlan } from '../ParticleCompiledPlan';
import type { ParticleSubEmitterModule } from '../ParticleTypes';

/** One GPU-resident event-to-spawn route. No counter or particle data is read by the CPU. */
export interface ParticleGPUSubEmitterRoutePlan {
    readonly event: string;
    readonly targetEmitter: string;
    readonly eventType: number;
    readonly count: number;
    readonly inheritVelocity: boolean;
    readonly eventByteLength: number;
    readonly targetStateByteLength: number;
    readonly shader: ComputeShader;
}

function align(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function offset(plan: Readonly<ParticleCompiledEmitterPlan>, name: string): number | null {
    const attribute = plan.attributes.find(candidate => candidate.name === name);
    return attribute ? attribute.byteOffset / 4 : null;
}

function scalar(
    value: number | Readonly<{ min: number; max: number }> | undefined,
    fallback: number
): number {
    return typeof value === 'number' ? value : (value?.min ?? fallback);
}

function wgslFloat(value: number): string {
    const rounded = Math.fround(value);
    return Number.isInteger(rounded) ? `${String(rounded)}.0` : String(rounded);
}

/** Stable 32-bit event identifier shared by capture and route kernels. @internal */
export function particleGPUEventType(name: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < name.length; index += 1) {
        hash ^= name.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** Compile bounded GPU event compaction directly into another emitter's active state. */
export function compileParticleGPUSubEmitterRoute(
    source: Readonly<ParticleCompiledEmitterPlan>,
    target: Readonly<ParticleCompiledEmitterPlan>,
    module: Readonly<ParticleSubEmitterModule>
): Readonly<ParticleGPUSubEmitterRoutePlan> {
    if (source.kind !== 'gpu-stateful' || target.kind !== 'gpu-stateful') {
        throw new TypeError('GPU sub-emitter routes require GPU-owned source and target emitters');
    }
    const count = module.count ?? 1;
    const type = particleGPUEventType(module.event);
    const eventByteLength = Math.max(16, align(source.definition.eventCapacity * 48, 16));
    const targetStateByteLength = align(target.attributeByteLength, 16);
    const clearState = target.attributes
        .flatMap(attribute =>
            Array.from(
                { length: attribute.components },
                (_, component) =>
                    `targetState[${String(attribute.byteOffset / 4)}u + particleIndex * ${String(attribute.components)}u + ${String(component)}u] = 0u;`
            )
        )
        .join('\n');
    const position = offset(target, 'position');
    const previousPosition = offset(target, 'previous-position');
    const velocity = offset(target, 'velocity');
    const age = offset(target, 'age');
    const normalizedAge = offset(target, 'normalized-age');
    const lifetime = offset(target, 'lifetime');
    const stableId = offset(target, 'stable-id');
    const generation = offset(target, 'generation');
    const alive = offset(target, 'alive');
    if (
        position === null ||
        previousPosition === null ||
        velocity === null ||
        age === null ||
        normalizedAge === null ||
        lifetime === null ||
        stableId === null ||
        generation === null ||
        alive === null
    ) {
        throw new Error('GPU sub-emitter target lost its core state layout');
    }
    const optionalScalarAssignment = (name: string, value: number): string => {
        const attribute = offset(target, name);
        return attribute === null
            ? ''
            : `targetState[${String(attribute)}u + particleIndex] = bitcast<u32>(${wgslFloat(value)});`;
    };
    const size = scalar(target.definition.initialize.size, 1);
    const rotation = scalar(target.definition.initialize.rotation, 0);
    const mass = scalar(target.definition.initialize.mass, 1);
    const directionValue = target.definition.initialize.direction;
    const direction =
        directionValue === undefined
            ? ([0, 1, 0] as const)
            : 'min' in directionValue
              ? directionValue.min
              : directionValue;
    const directionLength = Math.max(1e-8, Math.hypot(...direction));
    const speed = scalar(target.definition.initialize.speed, 0);
    const initialVelocity = direction.map(component => (component / directionLength) * speed);
    const velocitySource = module.inheritVelocity
        ? 'source.velocity[component]'
        : `vec3<f32>(${initialVelocity.map(wgslFloat).join(', ')})[component]`;
    const colorValue = target.definition.initialize.color;
    const color =
        colorValue === undefined
            ? ([1, 1, 1, 1] as const)
            : 'min' in colorValue
              ? colorValue.min
              : colorValue;
    const colorAssignments = ['color', 'base-color']
        .flatMap(name => {
            const attribute = offset(target, name);
            if (attribute === null) return [];
            return Array.from(
                { length: 4 },
                (_, component) =>
                    `targetState[${String(attribute)}u + particleIndex * 4u + ${String(component)}u] = bitcast<u32>(${wgslFloat(color[component] ?? 1)});`
            );
        })
        .join('\n');
    return Object.freeze({
        event: module.event,
        targetEmitter: module.emitter,
        eventType: type,
        count,
        inheritVelocity: module.inheritVelocity ?? false,
        eventByteLength,
        targetStateByteLength,
        shader: new ComputeShader({
            label: `${source.definition.name}:${module.event}->${module.emitter}:particle-event-route`,
            workgroupSize: [64],
            source: `
struct ParticleEventRecord {
    metadata: vec4<u32>,
    position: vec4<f32>,
    velocity: vec4<f32>,
};
struct TargetCounters {
    aliveCount: atomic<u32>,
    outputAliveCount: atomic<u32>,
    deadCount: atomic<u32>,
    nextIndex: atomic<u32>,
    droppedSpawnCount: atomic<u32>,
};
@group(0) @binding(0) var<storage, read> sourceEvents: array<ParticleEventRecord>;
@group(0) @binding(1) var<storage, read> sourceEventCount: array<u32>;
@group(0) @binding(2) var<storage, read_write> targetState: array<u32>;
@group(0) @binding(3) var<storage, read_write> targetAlive: array<u32>;
@group(0) @binding(4) var<storage, read_write> targetDead: array<u32>;
@group(0) @binding(5) var<storage, read_write> targetCounters: TargetCounters;
fn acquireParticleIndex() -> u32 {
    let available = atomicLoad(&targetCounters.deadCount);
    if (available > 0u) {
        let exchange = atomicCompareExchangeWeak(&targetCounters.deadCount, available, available - 1u);
        if (exchange.exchanged) { return targetDead[available - 1u]; }
    }
    let next = atomicAdd(&targetCounters.nextIndex, 1u);
    return select(next, 0xffffffffu, next >= ${String(target.definition.capacity)}u);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    if (invocation.x >= min(sourceEventCount[0], ${String(source.definition.eventCapacity)}u)) { return; }
    let source = sourceEvents[invocation.x];
    if (source.metadata.x != ${String(type)}u) { return; }
    for (var index = 0u; index < ${String(count)}u; index += 1u) {
        let particleIndex = acquireParticleIndex();
        if (particleIndex == 0xffffffffu) { atomicAdd(&targetCounters.droppedSpawnCount, 1u); continue; }
        ${clearState}
        for (var component = 0u; component < 3u; component += 1u) {
            targetState[${String(position)}u + particleIndex * 3u + component] = bitcast<u32>(source.position[component]);
            targetState[${String(previousPosition)}u + particleIndex * 3u + component] = bitcast<u32>(source.position[component]);
            targetState[${String(velocity)}u + particleIndex * 3u + component] = bitcast<u32>(${velocitySource});
        }
        targetState[${String(age)}u + particleIndex] = bitcast<u32>(0.0);
        targetState[${String(normalizedAge)}u + particleIndex] = bitcast<u32>(0.0);
        targetState[${String(lifetime)}u + particleIndex] = bitcast<u32>(${wgslFloat(scalar(target.definition.initialize.lifetime, 1))});
        targetState[${String(stableId)}u + particleIndex] = source.metadata.y ^ (index * 0x9e3779b1u);
        targetState[${String(generation)}u + particleIndex] = 0u;
        targetState[${String(alive)}u + particleIndex] = 1u;
        ${optionalScalarAssignment('size', size)}
        ${optionalScalarAssignment('base-size', size)}
        ${optionalScalarAssignment('rotation', rotation)}
        ${optionalScalarAssignment('base-rotation', rotation)}
        ${optionalScalarAssignment('mass', mass)}
        ${colorAssignments}
        let aliveIndex = atomicAdd(&targetCounters.aliveCount, 1u);
        targetAlive[aliveIndex] = particleIndex;
    }
}`,
            bindings: [
                {
                    name: 'sourceEvents',
                    group: 0,
                    binding: 0,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: eventByteLength
                },
                {
                    name: 'sourceEventCount',
                    group: 0,
                    binding: 1,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: 16
                },
                {
                    name: 'targetState',
                    group: 0,
                    binding: 2,
                    kind: 'storage-buffer',
                    access: 'read-write',
                    minBindingSize: targetStateByteLength
                },
                {
                    name: 'targetAlive',
                    group: 0,
                    binding: 3,
                    kind: 'storage-buffer',
                    access: 'read-write',
                    minBindingSize: align(target.definition.capacity * 4, 16)
                },
                {
                    name: 'targetDead',
                    group: 0,
                    binding: 4,
                    kind: 'storage-buffer',
                    access: 'read-write',
                    minBindingSize: align(target.definition.capacity * 4, 16)
                },
                {
                    name: 'targetCounters',
                    group: 0,
                    binding: 5,
                    kind: 'storage-buffer',
                    access: 'read-write',
                    minBindingSize: 32
                }
            ]
        })
    });
}

/** Compile every GPU-to-GPU route in one system without allocating runtime buffers. */
export function compileParticleGPUSubEmitterRoutes(
    plan: Readonly<ParticleCompiledPlan>
): readonly Readonly<ParticleGPUSubEmitterRoutePlan>[] {
    const routes: Readonly<ParticleGPUSubEmitterRoutePlan>[] = [];
    for (const source of plan.emitters) {
        for (const module of source.definition.modules) {
            if (module.type !== 'sub-emitter') continue;
            const target = plan.emitters.find(
                candidate => candidate.definition.name === module.emitter
            );
            if (!target) throw new Error(`Particle sub-emitter ${module.emitter} is unavailable`);
            if (source.kind !== 'gpu-stateful') continue;
            routes.push(compileParticleGPUSubEmitterRoute(source, target, module));
        }
    }
    return Object.freeze(routes);
}
