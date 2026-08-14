import ComputeShader from '../../render/compute/ComputeShader';
import StorageGraphicsShader from '../../render/compute/StorageGraphicsShader';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import type {
    ParticleModule,
    ParticleScalarValue,
    ParticleSpriteRendererDefinition,
    ParticleVector3,
    ParticleVector3Value
} from '../ParticleTypes';

const WORKGROUP_SIZE = 64;

export interface ParticleGPUBufferLayout {
    readonly stateByteLength: number;
    readonly aliveIndexByteLength: number;
    readonly deadIndexByteLength: number;
    readonly counterByteLength: number;
    readonly parameterByteLength: number;
    readonly spawnCommandByteLength: number;
    readonly rendererDataByteLength: number;
    readonly indirectArgumentByteLength: number;
}

export interface ParticleGPUShaderPlan {
    readonly recovery: ComputeShader;
    readonly resetCounters: ComputeShader;
    readonly simulate: ComputeShader;
    readonly initialize: ComputeShader;
    readonly finalize: ComputeShader;
    readonly buildRenderer: ComputeShader;
    readonly sort: ComputeShader | null;
}

export interface ParticleGPUStorageRendererPlan {
    readonly definition: ParticleSpriteRendererDefinition;
    readonly shader: StorageGraphicsShader;
}

/** Renderer-internal WebGPU plan with no native handles. */
export interface ParticleGPUCompiledPlan {
    readonly emitter: Readonly<ParticleCompiledEmitterPlan>;
    readonly buffers: Readonly<ParticleGPUBufferLayout>;
    readonly shaders: Readonly<ParticleGPUShaderPlan>;
    readonly renderers: readonly Readonly<ParticleGPUStorageRendererPlan>[];
    readonly workgroupCount: number;
    readonly sortStrategy: 'none' | 'bitonic' | 'radix-buckets';
    readonly recoveryPolicy: 'reinitialize';
}

function align(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function f32(value: number): string {
    const rounded = Math.fround(value);
    return Number.isInteger(rounded) ? `${String(rounded)}.0` : String(rounded);
}

function attributeOffset(plan: Readonly<ParticleCompiledEmitterPlan>, name: string): number {
    const attribute = plan.attributes.find(candidate => candidate.name === name);
    if (!attribute) throw new Error(`Particle GPU plan requires live attribute ${name}`);
    return attribute.byteOffset / 4;
}

function optionalAttributeOffset(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    name: string
): number | null {
    const attribute = plan.attributes.find(candidate => candidate.name === name);
    return attribute ? attribute.byteOffset / 4 : null;
}

function rangeScalar(value: ParticleScalarValue, stableId: string, lane: number): string {
    return typeof value === 'number'
        ? f32(value)
        : `mix(${f32(value.min)}, ${f32(value.max)}, particleRandom(${stableId}, ${String(lane)}u))`;
}

function rangeVector(value: ParticleVector3Value, stableId: string, firstLane: number): string {
    if ('min' in value) {
        return `mix(vec3<f32>(${value.min.map(f32).join(', ')}), vec3<f32>(${value.max.map(f32).join(', ')}), vec3<f32>(particleRandom(${stableId}, ${String(firstLane)}u), particleRandom(${stableId}, ${String(firstLane + 1)}u), particleRandom(${stableId}, ${String(firstLane + 2)}u)))`;
    }
    return `vec3<f32>(${value.map(f32).join(', ')})`;
}

function forceModuleSource(module: ParticleModule, moduleIndex: number): string {
    const lane = 200 + moduleIndex * 8;
    switch (module.type) {
        case 'velocity-over-lifetime':
            return `position += ${rangeVector(module.velocity, 'stableId', lane)} * deltaTime;`;
        case 'force-over-lifetime':
        case 'gravity':
        case 'wind':
            return `velocity += ${rangeVector(module.force, 'stableId', lane)} * inverseMass * deltaTime;`;
        case 'drag':
            return `velocity *= 1.0 / (1.0 + ${f32(module.coefficient)} * deltaTime);`;
        case 'limit-velocity':
            return `
let speed_${String(moduleIndex)} = length(velocity);
let limit_${String(moduleIndex)} = max(0.0, ${rangeScalar(module.limit, 'stableId', lane)});
if (speed_${String(moduleIndex)} > limit_${String(moduleIndex)} && speed_${String(moduleIndex)} > 0.0) {
    let ratio_${String(moduleIndex)} = limit_${String(moduleIndex)} / speed_${String(moduleIndex)};
    velocity *= 1.0 + (ratio_${String(moduleIndex)} - 1.0) * ${f32(module.dampen ?? 1)};
}`;
        case 'noise':
            return `
let noisePosition_${String(moduleIndex)} = position * ${f32(module.frequency)} + vec3<f32>(${(module.scrollVelocity ?? [0, 0, 0]).map(f32).join(', ')}) * age;
let noise_${String(moduleIndex)} = ${module.field === 'curl' ? 'particleCurlNoise' : 'particleVectorNoise'}(noisePosition_${String(moduleIndex)}, params.spawn.z + ${String(module.seedOffset ?? 0)}u, ${String(module.octaves)}u, ${f32(module.lacunarity ?? 2)}, ${f32(module.persistence ?? 0.5)});
let noiseStrength_${String(moduleIndex)} = ${rangeVector(module.strength, 'stableId', lane)};
${module.mode === 'force' ? `velocity += noise_${String(moduleIndex)} * noiseStrength_${String(moduleIndex)} * deltaTime;` : `noiseOffset = noise_${String(moduleIndex)} * noiseStrength_${String(moduleIndex)};`}`;
        case 'radial-force':
        case 'point-attraction': {
            const center =
                module.type === 'point-attraction'
                    ? (module.point ?? [0, 0, 0])
                    : 'center' in module
                      ? (module.center ?? [0, 0, 0])
                      : [0, 0, 0];
            return `velocity += normalize(vec3<f32>(${center.map(f32).join(', ')}) - position) * ${rangeScalar(module.strength, 'stableId', lane)} * deltaTime;`;
        }
        case 'line-attraction': {
            const start = module.lineStart ?? [0, 0, 0];
            const end = module.lineEnd ?? [0, 1, 0];
            return `
let lineStart_${String(moduleIndex)} = vec3<f32>(${start.map(f32).join(', ')});
let lineVector_${String(moduleIndex)} = vec3<f32>(${end.map(f32).join(', ')}) - lineStart_${String(moduleIndex)};
let lineAmount_${String(moduleIndex)} = clamp(dot(position - lineStart_${String(moduleIndex)}, lineVector_${String(moduleIndex)}) / max(dot(lineVector_${String(moduleIndex)}, lineVector_${String(moduleIndex)}), 0.000001), 0.0, 1.0);
velocity += normalize(lineStart_${String(moduleIndex)} + lineVector_${String(moduleIndex)} * lineAmount_${String(moduleIndex)} - position) * ${rangeScalar(module.strength, 'stableId', lane)} * deltaTime;`;
        }
        case 'orbital-force':
        case 'vortex-force': {
            const center = module.center ?? [0, 0, 0];
            const axis = module.axis ?? [0, 1, 0];
            return `velocity += normalize(cross(vec3<f32>(${axis.map(f32).join(', ')}), position - vec3<f32>(${center.map(f32).join(', ')}))) * ${rangeScalar(module.strength, 'stableId', lane)} * deltaTime;`;
        }
        case 'rotate-around-point': {
            const center = module.center ?? [0, 0, 0];
            const axis = module.axis ?? [0, 1, 0];
            return `velocity += cross(vec3<f32>(${axis.map(f32).join(', ')}), position - vec3<f32>(${center.map(f32).join(', ')})) * ${rangeScalar(module.angularSpeed, 'stableId', lane)} * deltaTime;`;
        }
        case 'conform-sphere': {
            const center = module.center ?? [0, 0, 0];
            return `
let conformDelta_${String(moduleIndex)} = position - vec3<f32>(${center.map(f32).join(', ')});
let conformDistance_${String(moduleIndex)} = max(length(conformDelta_${String(moduleIndex)}), 0.000001);
velocity -= conformDelta_${String(moduleIndex)} / conformDistance_${String(moduleIndex)} * (conformDistance_${String(moduleIndex)} - ${f32(module.radius)}) * ${f32(module.strength)} * deltaTime;`;
        }
        case 'vector-field':
            return `
let vectorField_${String(moduleIndex)} = textureSampleLevel(vectorFieldTexture_${String(moduleIndex)}, vectorFieldSampler_${String(moduleIndex)}, fract(position.xy * 0.5 + vec2<f32>(0.5)), 0.0).xyz * 2.0 - vec3<f32>(1.0);
velocity += vectorField_${String(moduleIndex)} * ${f32(module.strength)} * deltaTime;`;
        default:
            return '';
    }
}

function killModuleSource(module: ParticleModule, moduleIndex: number): string {
    switch (module.type) {
        case 'kill-speed':
            return `alive = alive && length(velocity) >= ${f32(module.range[0])} && length(velocity) <= ${f32(module.range[1])};`;
        case 'kill-distance':
            return `alive = alive && length(position) >= ${f32(module.range[0])} && length(position) <= ${f32(module.range[1])};`;
        case 'kill-plane': {
            const normal = module.normal ?? [0, 1, 0];
            const comparison = `(dot(position, vec3<f32>(${normal.map(f32).join(', ')})) < ${f32(module.offset ?? 0)})`;
            return `let inside_${String(moduleIndex)} = ${comparison}; alive = alive && ${module.mode === 'outside' ? `inside_${String(moduleIndex)}` : `!inside_${String(moduleIndex)}`};`;
        }
        case 'kill-sphere': {
            const center = module.center ?? [0, 0, 0];
            const comparison = `(distance(position, vec3<f32>(${center.map(f32).join(', ')})) <= ${f32(module.radius ?? 0)})`;
            return `let inside_${String(moduleIndex)} = ${comparison}; alive = alive && ${module.mode === 'outside' ? `inside_${String(moduleIndex)}` : `!inside_${String(moduleIndex)}`};`;
        }
        case 'kill-box': {
            const center = module.center ?? [0, 0, 0];
            const halfSize = (module.size ?? [0, 0, 0]).map(
                value => value * 0.5
            ) as unknown as ParticleVector3;
            return `let inside_${String(moduleIndex)} = all(abs(position - vec3<f32>(${center.map(f32).join(', ')})) <= vec3<f32>(${halfSize.map(f32).join(', ')})); alive = alive && ${module.mode === 'outside' ? `inside_${String(moduleIndex)}` : `!inside_${String(moduleIndex)}`};`;
        }
        default:
            return '';
    }
}

function wgslShared(plan: Readonly<ParticleCompiledEmitterPlan>): string {
    return `
struct ParticleParams {
    timeDelta: vec4<f32>,
    emitterPosition: vec4<f32>,
    emitterVelocity: vec4<f32>,
    spawn: vec4<u32>,
    cameraPosition: vec4<f32>,
    sort: vec4<u32>,
};
struct ParticleCounters {
    aliveCount: atomic<u32>,
    outputAliveCount: atomic<u32>,
    deadCount: atomic<u32>,
    nextIndex: atomic<u32>,
    droppedSpawnCount: atomic<u32>,
};
fn mix32(input: u32) -> u32 {
    var mixed = input;
    mixed = (mixed ^ (mixed >> 16u)) * 0x7feb352du;
    mixed = (mixed ^ (mixed >> 15u)) * 0x846ca68bu;
    return mixed ^ (mixed >> 16u);
}
fn particleRandom(stableId: u32, lane: u32) -> f32 {
    var value = mix32(params.spawn.z);
    value = mix32(value ^ ${String(Math.imul(plan.emitterId, 0x9e3779b1) >>> 0)}u);
    value = mix32(value ^ (stableId * 0x85ebca77u));
    value = mix32(value ^ (lane * 0x27d4eb2fu));
    return f32(mix32(value)) / 4294967296.0;
}
fn noiseLattice(cell: vec3<i32>, seed: u32) -> f32 {
    let hash = mix32(bitcast<u32>(cell.x * i32(0x1f123bb5u)) ^ bitcast<u32>(cell.y * i32(0x5f356495u)) ^ bitcast<u32>(cell.z * i32(0x6c8e9cf5u)) ^ seed);
    return f32(hash) / 2147483647.5 - 1.0;
}
fn particleValueNoise(point: vec3<f32>, seed: u32) -> f32 {
    let cell = vec3<i32>(floor(point));
    let local = fract(point);
    let amount = local * local * (vec3<f32>(3.0) - 2.0 * local);
    let x00 = mix(noiseLattice(cell, seed), noiseLattice(cell + vec3<i32>(1, 0, 0), seed), amount.x);
    let x10 = mix(noiseLattice(cell + vec3<i32>(0, 1, 0), seed), noiseLattice(cell + vec3<i32>(1, 1, 0), seed), amount.x);
    let x01 = mix(noiseLattice(cell + vec3<i32>(0, 0, 1), seed), noiseLattice(cell + vec3<i32>(1, 0, 1), seed), amount.x);
    let x11 = mix(noiseLattice(cell + vec3<i32>(0, 1, 1), seed), noiseLattice(cell + vec3<i32>(1, 1, 1), seed), amount.x);
    return mix(mix(x00, x10, amount.y), mix(x01, x11, amount.y), amount.z);
}
fn particleVectorNoise(point: vec3<f32>, seed: u32, octaves: u32, lacunarity: f32, persistence: f32) -> vec3<f32> {
    var result = vec3<f32>(0.0);
    var frequency = 1.0;
    var amplitude = 1.0;
    var normalizer = 0.0;
    for (var octave = 0u; octave < octaves; octave += 1u) {
        result += vec3<f32>(
            particleValueNoise(point * frequency, seed + octave * 17u),
            particleValueNoise(point * frequency, seed + 101u + octave * 17u),
            particleValueNoise(point * frequency, seed + 211u + octave * 17u)
        ) * amplitude;
        normalizer += amplitude;
        frequency *= lacunarity;
        amplitude *= persistence;
    }
    return result / normalizer;
}
fn particleCurlNoise(point: vec3<f32>, seed: u32, octaves: u32, lacunarity: f32, persistence: f32) -> vec3<f32> {
    let epsilon = 1.0 / 128.0;
    let dx = vec3<f32>(epsilon, 0.0, 0.0);
    let dy = vec3<f32>(0.0, epsilon, 0.0);
    let dz = vec3<f32>(0.0, 0.0, epsilon);
    let x0 = particleVectorNoise(point - dx, seed, octaves, lacunarity, persistence);
    let x1 = particleVectorNoise(point + dx, seed, octaves, lacunarity, persistence);
    let y0 = particleVectorNoise(point - dy, seed, octaves, lacunarity, persistence);
    let y1 = particleVectorNoise(point + dy, seed, octaves, lacunarity, persistence);
    let z0 = particleVectorNoise(point - dz, seed, octaves, lacunarity, persistence);
    let z1 = particleVectorNoise(point + dz, seed, octaves, lacunarity, persistence);
    return vec3<f32>((y1.z - y0.z) - (z1.y - z0.y), (z1.x - z0.x) - (x1.z - x0.z), (x1.y - x0.y) - (y1.x - y0.x)) / (2.0 * epsilon);
}`;
}

function copyStateSource(plan: Readonly<ParticleCompiledEmitterPlan>): string {
    return plan.attributes
        .flatMap(attribute =>
            Array.from({ length: attribute.components }, (_, component) => {
                const offset = attribute.byteOffset / 4;
                return `stateTarget[${String(offset)}u + particleIndex * ${String(attribute.components)}u + ${String(component)}u] = stateSource[${String(offset)}u + particleIndex * ${String(attribute.components)}u + ${String(component)}u];`;
            })
        )
        .join('\n');
}

function clearParticleState(plan: Readonly<ParticleCompiledEmitterPlan>): string {
    return plan.attributes
        .flatMap(attribute =>
            Array.from({ length: attribute.components }, (_, component) => {
                const offset = attribute.byteOffset / 4;
                return `stateTarget[${String(offset)}u + particleIndex * ${String(attribute.components)}u + ${String(component)}u] = 0u;`;
            })
        )
        .join('\n');
}

function storageAssignments(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    targetName: string
): string {
    const offset = (name: string): number => attributeOffset(plan, name);
    const assignments = [
        `${targetName}[${String(offset('position'))}u + particleIndex * 3u] = bitcast<u32>(position.x);`,
        `${targetName}[${String(offset('position'))}u + particleIndex * 3u + 1u] = bitcast<u32>(position.y);`,
        `${targetName}[${String(offset('position'))}u + particleIndex * 3u + 2u] = bitcast<u32>(position.z);`,
        `${targetName}[${String(offset('previous-position'))}u + particleIndex * 3u] = bitcast<u32>(previousPosition.x);`,
        `${targetName}[${String(offset('previous-position'))}u + particleIndex * 3u + 1u] = bitcast<u32>(previousPosition.y);`,
        `${targetName}[${String(offset('previous-position'))}u + particleIndex * 3u + 2u] = bitcast<u32>(previousPosition.z);`,
        `${targetName}[${String(offset('velocity'))}u + particleIndex * 3u] = bitcast<u32>(velocity.x);`,
        `${targetName}[${String(offset('velocity'))}u + particleIndex * 3u + 1u] = bitcast<u32>(velocity.y);`,
        `${targetName}[${String(offset('velocity'))}u + particleIndex * 3u + 2u] = bitcast<u32>(velocity.z);`,
        `${targetName}[${String(offset('age'))}u + particleIndex] = bitcast<u32>(age);`,
        `${targetName}[${String(offset('normalized-age'))}u + particleIndex] = bitcast<u32>(clamp(age / max(lifetime, 0.000001), 0.0, 1.0));`
    ];
    const noiseOffset = optionalAttributeOffset(plan, 'noise-offset');
    if (noiseOffset !== null) {
        assignments.push(
            `${targetName}[${String(noiseOffset)}u + particleIndex * 3u] = bitcast<u32>(noiseOffset.x);`,
            `${targetName}[${String(noiseOffset)}u + particleIndex * 3u + 1u] = bitcast<u32>(noiseOffset.y);`,
            `${targetName}[${String(noiseOffset)}u + particleIndex * 3u + 2u] = bitcast<u32>(noiseOffset.z);`
        );
    }
    return assignments.join('\n');
}

function simulateShader(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    buffers: ParticleGPUBufferLayout
): ComputeShader {
    const position = attributeOffset(plan, 'position');
    const velocity = attributeOffset(plan, 'velocity');
    const age = attributeOffset(plan, 'age');
    const lifetime = attributeOffset(plan, 'lifetime');
    const stableId = attributeOffset(plan, 'stable-id');
    const mass = optionalAttributeOffset(plan, 'mass');
    const moduleSource = plan.definition.modules.map(forceModuleSource).join('\n');
    const killSource = plan.definition.modules.map(killModuleSource).join('\n');
    let vectorFieldBinding = 7;
    const vectorFieldDeclarations: string[] = [];
    const vectorFieldBindings: (
        | {
              readonly name: string;
              readonly group: number;
              readonly binding: number;
              readonly kind: 'sampled-texture';
              readonly sampleType: 'float';
          }
        | {
              readonly name: string;
              readonly group: number;
              readonly binding: number;
              readonly kind: 'sampler';
          }
    )[] = [];
    for (const [moduleIndex, module] of plan.definition.modules.entries()) {
        if (module.type !== 'vector-field') continue;
        vectorFieldDeclarations.push(
            `@group(0) @binding(${String(vectorFieldBinding)}) var vectorFieldTexture_${String(moduleIndex)}: texture_2d<f32>;`,
            `@group(0) @binding(${String(vectorFieldBinding + 1)}) var vectorFieldSampler_${String(moduleIndex)}: sampler;`
        );
        vectorFieldBindings.push(
            {
                name: `vectorFieldTexture_${String(moduleIndex)}`,
                group: 0,
                binding: vectorFieldBinding,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: `vectorFieldSampler_${String(moduleIndex)}`,
                group: 0,
                binding: vectorFieldBinding + 1,
                kind: 'sampler'
            }
        );
        vectorFieldBinding += 2;
    }
    return new ComputeShader({
        label: `${plan.definition.name}:particle-simulate`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `${wgslShared(plan)}
@group(0) @binding(0) var<uniform> params: ParticleParams;
@group(0) @binding(1) var<storage, read> stateSource: array<u32>;
@group(0) @binding(2) var<storage, read_write> stateTarget: array<u32>;
@group(0) @binding(3) var<storage, read> aliveSource: array<u32>;
@group(0) @binding(4) var<storage, read_write> aliveTarget: array<u32>;
@group(0) @binding(5) var<storage, read_write> deadIndices: array<u32>;
@group(0) @binding(6) var<storage, read_write> counters: ParticleCounters;
${vectorFieldDeclarations.join('\n')}
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    if (invocation.x >= atomicLoad(&counters.aliveCount)) { return; }
    let particleIndex = aliveSource[invocation.x];
    ${copyStateSource(plan)}
    var position = vec3<f32>(bitcast<f32>(stateSource[${String(position)}u + particleIndex * 3u]), bitcast<f32>(stateSource[${String(position)}u + particleIndex * 3u + 1u]), bitcast<f32>(stateSource[${String(position)}u + particleIndex * 3u + 2u]));
    let previousPosition = position;
    var velocity = vec3<f32>(bitcast<f32>(stateSource[${String(velocity)}u + particleIndex * 3u]), bitcast<f32>(stateSource[${String(velocity)}u + particleIndex * 3u + 1u]), bitcast<f32>(stateSource[${String(velocity)}u + particleIndex * 3u + 2u]));
    var age = bitcast<f32>(stateSource[${String(age)}u + particleIndex]) + params.timeDelta.y;
    let lifetime = bitcast<f32>(stateSource[${String(lifetime)}u + particleIndex]);
    let stableId = stateSource[${String(stableId)}u + particleIndex];
    let inverseMass = ${mass === null ? '1.0' : `1.0 / max(bitcast<f32>(stateSource[${String(mass)}u + particleIndex]), 0.000001)`};
    let deltaTime = params.timeDelta.y;
    var noiseOffset = vec3<f32>(0.0);
    ${moduleSource}
    position += velocity * deltaTime;
    var alive = age < lifetime;
    ${killSource}
    ${storageAssignments(plan, 'stateTarget')}
    if (alive) {
        let outputIndex = atomicAdd(&counters.outputAliveCount, 1u);
        aliveTarget[outputIndex] = particleIndex;
    } else {
        let deadIndex = atomicAdd(&counters.deadCount, 1u);
        deadIndices[deadIndex] = particleIndex;
    }
}`,
        bindings: [
            {
                name: 'params',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: buffers.parameterByteLength
            },
            {
                name: 'stateSource',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: buffers.stateByteLength
            },
            {
                name: 'stateTarget',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.stateByteLength
            },
            {
                name: 'aliveSource',
                group: 0,
                binding: 3,
                kind: 'read-only-storage-buffer',
                minBindingSize: buffers.aliveIndexByteLength
            },
            {
                name: 'aliveTarget',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.aliveIndexByteLength
            },
            {
                name: 'deadIndices',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.deadIndexByteLength
            },
            {
                name: 'counters',
                group: 0,
                binding: 6,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.counterByteLength
            },
            ...vectorFieldBindings
        ]
    });
}

function initializeShader(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    buffers: ParticleGPUBufferLayout
): ComputeShader {
    const offset = (name: string): number => attributeOffset(plan, name);
    const optional = (name: string): number | null => optionalAttributeOffset(plan, name);
    const valueAssignment = (name: string, source: string): string => {
        const attribute = optional(name);
        return attribute === null
            ? ''
            : `stateTarget[${String(attribute)}u + particleIndex] = bitcast<u32>(${source});`;
    };
    const color = optional('color');
    const baseColor = optional('base-color');
    const colorTargets = [color, baseColor].filter((value): value is number => value !== null);
    const colorAssignments =
        color === null
            ? ''
            : colorTargets
                  .flatMap(target =>
                      Array.from(
                          { length: 4 },
                          (_, component) =>
                              `stateTarget[${String(target)}u + particleIndex * 4u + ${String(component)}u] = bitcast<u32>(command.color[${String(component)}u]);`
                      )
                  )
                  .join('\n');
    const customAssignments = plan.definition.modules
        .filter(module => module.type === 'custom-channel')
        .flatMap(module => {
            const attribute = optionalAttributeOffset(plan, `custom:${module.name}`);
            if (attribute === null) return [];
            const values = typeof module.value === 'number' ? [module.value] : module.value;
            return Array.from(
                { length: values.length },
                (_, component) =>
                    `stateTarget[${String(attribute)}u + particleIndex * ${String(values.length)}u + ${String(component)}u] = bitcast<u32>(${f32(values[component] ?? 0)});`
            );
        })
        .join('\n');
    return new ComputeShader({
        label: `${plan.definition.name}:particle-initialize`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `${wgslShared(plan)}
struct SpawnCommand {
    positionLifetime: vec4<f32>,
    velocitySize: vec4<f32>,
    color: vec4<f32>,
    rotationMass: vec4<f32>,
};
@group(0) @binding(0) var<uniform> params: ParticleParams;
@group(0) @binding(1) var<storage, read_write> stateTarget: array<u32>;
@group(0) @binding(2) var<storage, read_write> aliveTarget: array<u32>;
@group(0) @binding(3) var<storage, read_write> deadIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> counters: ParticleCounters;
@group(0) @binding(5) var<storage, read> spawnCommands: array<SpawnCommand>;
fn acquireParticleIndex() -> u32 {
    let available = atomicLoad(&counters.deadCount);
    if (available > 0u) {
        let exchange = atomicCompareExchangeWeak(&counters.deadCount, available, available - 1u);
        if (exchange.exchanged) { return deadIndices[available - 1u]; }
    }
    let next = atomicAdd(&counters.nextIndex, 1u);
    return select(next, 0xffffffffu, next >= ${String(plan.definition.capacity)}u);
}
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    if (invocation.x >= params.spawn.x) { return; }
    let particleIndex = acquireParticleIndex();
    if (particleIndex == 0xffffffffu) { _ = atomicAdd(&counters.droppedSpawnCount, 1u); return; }
    let command = spawnCommands[invocation.x];
    ${clearParticleState(plan)}
    let position = command.positionLifetime.xyz;
    let previousPosition = position;
    let velocity = command.velocitySize.xyz;
    let age = 0.0;
    let lifetime = max(command.positionLifetime.w, 0.000001);
    let noiseOffset = vec3<f32>(0.0);
    ${storageAssignments(plan, 'stateTarget')}
    stateTarget[${String(offset('lifetime'))}u + particleIndex] = bitcast<u32>(lifetime);
    stateTarget[${String(offset('stable-id'))}u + particleIndex] = params.spawn.y + invocation.x;
    stateTarget[${String(offset('generation'))}u + particleIndex] = params.spawn.w;
    stateTarget[${String(offset('alive'))}u + particleIndex] = 1u;
    ${valueAssignment('size', 'command.velocitySize.w')}
    ${valueAssignment('base-size', 'command.velocitySize.w')}
    ${valueAssignment('rotation', 'command.rotationMass.x')}
    ${valueAssignment('base-rotation', 'command.rotationMass.x')}
    ${valueAssignment('mass', 'max(command.rotationMass.y, 0.000001)')}
    ${valueAssignment('sprite-frame', '0.0')}
    ${colorAssignments}
    ${customAssignments}
    let outputIndex = atomicAdd(&counters.outputAliveCount, 1u);
    aliveTarget[outputIndex] = particleIndex;
}`,
        bindings: [
            {
                name: 'params',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: buffers.parameterByteLength
            },
            {
                name: 'stateTarget',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.stateByteLength
            },
            {
                name: 'aliveTarget',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.aliveIndexByteLength
            },
            {
                name: 'deadIndices',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.deadIndexByteLength
            },
            {
                name: 'counters',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.counterByteLength
            },
            {
                name: 'spawnCommands',
                group: 0,
                binding: 5,
                kind: 'read-only-storage-buffer',
                minBindingSize: buffers.spawnCommandByteLength
            }
        ]
    });
}

function simpleShaders(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    buffers: ParticleGPUBufferLayout
): Pick<ParticleGPUShaderPlan, 'recovery' | 'resetCounters' | 'finalize'> {
    const recovery = new ComputeShader({
        label: `${plan.definition.name}:particle-recovery-initializer`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `
struct ParticleCounters {
    aliveCount: atomic<u32>, outputAliveCount: atomic<u32>, deadCount: atomic<u32>, nextIndex: atomic<u32>, droppedSpawnCount: atomic<u32>,
};
@group(0) @binding(0) var<storage, read_write> stateA: array<u32>;
@group(0) @binding(1) var<storage, read_write> stateB: array<u32>;
@group(0) @binding(2) var<storage, read_write> aliveA: array<u32>;
@group(0) @binding(3) var<storage, read_write> aliveB: array<u32>;
@group(0) @binding(4) var<storage, read_write> deadIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> counters: ParticleCounters;
@group(0) @binding(6) var<storage, read_write> indirectArguments: array<u32>;
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    let index = invocation.x;
    if (index < ${String(buffers.stateByteLength / 4)}u) { stateA[index] = 0u; stateB[index] = 0u; }
    if (index < ${String(plan.definition.capacity)}u) { aliveA[index] = 0u; aliveB[index] = 0u; deadIndices[index] = 0u; }
    if (index == 0u) {
        atomicStore(&counters.aliveCount, 0u); atomicStore(&counters.outputAliveCount, 0u); atomicStore(&counters.deadCount, 0u); atomicStore(&counters.nextIndex, 0u); atomicStore(&counters.droppedSpawnCount, 0u);
        indirectArguments[0] = 0u; indirectArguments[1] = 1u; indirectArguments[2] = 0u; indirectArguments[3] = 0u;
    }
}`,
        bindings: [
            {
                name: 'stateA',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.stateByteLength
            },
            {
                name: 'stateB',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.stateByteLength
            },
            {
                name: 'aliveA',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.aliveIndexByteLength
            },
            {
                name: 'aliveB',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.aliveIndexByteLength
            },
            {
                name: 'deadIndices',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.deadIndexByteLength
            },
            {
                name: 'counters',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.counterByteLength
            },
            {
                name: 'indirectArguments',
                group: 0,
                binding: 6,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.indirectArgumentByteLength
            }
        ]
    });
    const resetCounters = new ComputeShader({
        label: `${plan.definition.name}:particle-reset-counters`,
        workgroupSize: [1],
        source: `
struct ParticleCounters { aliveCount: atomic<u32>, outputAliveCount: atomic<u32>, deadCount: atomic<u32>, nextIndex: atomic<u32>, droppedSpawnCount: atomic<u32>, };
@group(0) @binding(0) var<storage, read_write> counters: ParticleCounters;
@compute @workgroup_size(1) fn main() { atomicStore(&counters.outputAliveCount, 0u); }`,
        bindings: [
            {
                name: 'counters',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.counterByteLength
            }
        ]
    });
    const finalize = new ComputeShader({
        label: `${plan.definition.name}:particle-indirect-args`,
        workgroupSize: [1],
        source: `
struct ParticleCounters { aliveCount: atomic<u32>, outputAliveCount: atomic<u32>, deadCount: atomic<u32>, nextIndex: atomic<u32>, droppedSpawnCount: atomic<u32>, };
@group(0) @binding(0) var<storage, read_write> counters: ParticleCounters;
@group(0) @binding(1) var<storage, read_write> indirectArguments: array<u32>;
@compute @workgroup_size(1) fn main() {
    let alive = atomicLoad(&counters.outputAliveCount);
    atomicStore(&counters.aliveCount, alive);
    indirectArguments[0] = alive * 6u; indirectArguments[1] = 1u; indirectArguments[2] = 0u; indirectArguments[3] = 0u;
}`,
        bindings: [
            {
                name: 'counters',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.counterByteLength
            },
            {
                name: 'indirectArguments',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.indirectArgumentByteLength
            }
        ]
    });
    return { recovery, resetCounters, finalize };
}

function sortShader(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    buffers: ParticleGPUBufferLayout,
    strategy: ParticleGPUCompiledPlan['sortStrategy']
): ComputeShader | null {
    if (strategy === 'none') return null;
    const position = attributeOffset(plan, 'position');
    const main =
        strategy === 'bitonic'
            ? `
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    let index = invocation.x;
    let count = atomicLoad(&counters.aliveCount);
    let partner = index ^ params.sort.y;
    if (index >= count || partner >= count || partner <= index) { return; }
    let ascending = (index & params.sort.x) == 0u;
    let left = aliveIndices[index]; let right = aliveIndices[partner];
    let swap = (distanceKey(left) < distanceKey(right)) == ascending;
    if (swap) { aliveIndices[index] = right; aliveIndices[partner] = left; }
}`
            : `
// Large and non-power-of-two capacities use an in-place, high-byte distance bucket pass.
// A single invocation owns the compaction order, avoiding cross-workgroup write hazards.
@compute @workgroup_size(1)
fn main() {
    let count = atomicLoad(&counters.aliveCount);
    var outputIndex = 0u;
    for (var bucket = 256u; bucket > 0u; bucket -= 1u) {
        let targetBucket = bucket - 1u;
        var searchIndex = outputIndex;
        while (searchIndex < count) {
            let candidate = aliveIndices[searchIndex];
            let candidateBucket = bitcast<u32>(max(distanceKey(candidate), 0.0)) >> 24u;
            if (candidateBucket == targetBucket) {
                let displaced = aliveIndices[outputIndex];
                aliveIndices[outputIndex] = candidate;
                aliveIndices[searchIndex] = displaced;
                outputIndex += 1u;
            }
            searchIndex += 1u;
        }
    }
}`;
    return new ComputeShader({
        label: `${plan.definition.name}:particle-distance-sort`,
        workgroupSize: [strategy === 'bitonic' ? WORKGROUP_SIZE : 1],
        source: `${wgslShared(plan)}
@group(0) @binding(0) var<uniform> params: ParticleParams;
@group(0) @binding(1) var<storage, read> state: array<u32>;
@group(0) @binding(2) var<storage, read_write> aliveIndices: array<u32>;
@group(0) @binding(3) var<storage, read_write> counters: ParticleCounters;
fn distanceKey(particleIndex: u32) -> f32 {
    let position = vec3<f32>(bitcast<f32>(state[${String(position)}u + particleIndex * 3u]), bitcast<f32>(state[${String(position)}u + particleIndex * 3u + 1u]), bitcast<f32>(state[${String(position)}u + particleIndex * 3u + 2u]));
    return distance(position, params.cameraPosition.xyz);
}
${main}`,
        bindings: [
            {
                name: 'params',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: buffers.parameterByteLength
            },
            {
                name: 'state',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: buffers.stateByteLength
            },
            {
                name: 'aliveIndices',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.aliveIndexByteLength
            },
            {
                name: 'counters',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.counterByteLength
            }
        ]
    });
}

function rendererVisualSource(plan: Readonly<ParticleCompiledEmitterPlan>): {
    readonly declarations: string;
    readonly statements: string;
} {
    const declarations: string[] = [];
    for (const [index, lut] of plan.curveLUTs.entries()) {
        declarations.push(`
const particleCurve_${String(index)} = array<f32, ${String(lut.values.length)}>(
    ${Array.from(lut.values, f32).join(', ')}
);
fn sampleParticleCurve_${String(index)}(time: f32) -> f32 {
    let position = clamp(time, 0.0, 1.0) * ${f32(lut.values.length - 1)};
    let left = u32(floor(position));
    let right = min(${String(lut.values.length - 1)}u, left + 1u);
    return mix(particleCurve_${String(index)}[left], particleCurve_${String(index)}[right], fract(position));
}`);
    }
    for (const [index, lut] of plan.gradientLUTs.entries()) {
        const colors: string[] = [];
        for (let offset = 0; offset < lut.values.length; offset += 4) {
            colors.push(
                `vec4<f32>(${f32(lut.values[offset] ?? 0)}, ${f32(lut.values[offset + 1] ?? 0)}, ${f32(lut.values[offset + 2] ?? 0)}, ${f32(lut.values[offset + 3] ?? 0)})`
            );
        }
        declarations.push(`
const particleGradient_${String(index)} = array<vec4<f32>, ${String(colors.length)}>(
    ${colors.join(', ')}
);
fn sampleParticleGradient_${String(index)}(time: f32) -> vec4<f32> {
    let position = clamp(time, 0.0, 1.0) * ${f32(colors.length - 1)};
    let left = u32(floor(position));
    let right = min(${String(colors.length - 1)}u, left + 1u);
    return mix(particleGradient_${String(index)}[left], particleGradient_${String(index)}[right], fract(position));
}`);
    }
    const curve = (value: unknown): string => {
        const index = plan.curveLUTs.findIndex(candidate => candidate.curve === value);
        if (index < 0) throw new Error('Particle renderer lost a compiled curve LUT');
        return `sampleParticleCurve_${String(index)}`;
    };
    const gradient = (value: unknown): string => {
        const index = plan.gradientLUTs.findIndex(candidate => candidate.gradient === value);
        if (index < 0) throw new Error('Particle renderer lost a compiled gradient LUT');
        return `sampleParticleGradient_${String(index)}`;
    };
    const statements: string[] = [];
    for (const [moduleIndex, module] of plan.definition.modules.entries()) {
        switch (module.type) {
            case 'size-over-lifetime':
                statements.push(`renderSize = baseSize * ${curve(module.curve)}(normalizedAge);`);
                break;
            case 'rotation-over-lifetime':
                statements.push(
                    `renderRotation = baseRotation + ${curve(module.curve)}(normalizedAge);`
                );
                break;
            case 'alpha-over-lifetime':
                statements.push(
                    `renderColor.a = baseColor.a * ${curve(module.curve)}(normalizedAge);`
                );
                break;
            case 'color-over-lifetime':
                statements.push(
                    `renderColor = baseColor * ${gradient(module.gradient)}(normalizedAge);`
                );
                break;
            case 'size-by-speed':
                statements.push(
                    `renderSize = baseSize * ${curve(module.curve)}(clamp((particleSpeed - ${f32(module.speedRange[0])}) / max(0.000001, ${f32(module.speedRange[1] - module.speedRange[0])}), 0.0, 1.0));`
                );
                break;
            case 'rotation-by-speed':
                statements.push(
                    `renderRotation = baseRotation + ${curve(module.curve)}(clamp((particleSpeed - ${f32(module.speedRange[0])}) / max(0.000001, ${f32(module.speedRange[1] - module.speedRange[0])}), 0.0, 1.0));`
                );
                break;
            case 'color-by-speed':
                statements.push(
                    `renderColor = baseColor * ${gradient(module.gradient)}(clamp((particleSpeed - ${f32(module.speedRange[0])}) / max(0.000001, ${f32(module.speedRange[1] - module.speedRange[0])}), 0.0, 1.0));`
                );
                break;
            case 'frame-over-lifetime':
                statements.push(
                    `renderFrame = ${curve(module.curve)}(normalizedAge) * ${f32(module.cycles ?? 1)};`
                );
                break;
            case 'texture-sheet': {
                const frameCount = module.rows * module.columns;
                const amount =
                    module.mode === 'lifetime'
                        ? `normalizedAge * ${f32(module.cycles ?? 1)}`
                        : module.mode === 'speed'
                          ? `clamp((particleSpeed - ${f32(module.speedRange?.[0] ?? 0)}) / max(0.000001, ${f32((module.speedRange?.[1] ?? 1) - (module.speedRange?.[0] ?? 0))}), 0.0, 1.0)`
                          : `particleAge * ${f32(module.fps ?? 1)} / ${f32(frameCount)}`;
                statements.push(
                    `renderFrame = f32(u32(floor((${amount}) * ${f32(frameCount)})) % ${String(frameCount)}u);`
                );
                break;
            }
            default:
                void moduleIndex;
                break;
        }
    }
    return {
        declarations: declarations.join('\n'),
        statements: statements.join('\n')
    };
}

function rendererBuildShader(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    buffers: ParticleGPUBufferLayout
): ComputeShader {
    const position = attributeOffset(plan, 'position');
    const size = attributeOffset(plan, 'size');
    const rotation = attributeOffset(plan, 'rotation');
    const color = attributeOffset(plan, 'color');
    const frame = attributeOffset(plan, 'sprite-frame');
    const velocity = attributeOffset(plan, 'velocity');
    const noise = optionalAttributeOffset(plan, 'noise-offset');
    const age = attributeOffset(plan, 'age');
    const lifetime = attributeOffset(plan, 'lifetime');
    const baseSize = optionalAttributeOffset(plan, 'base-size');
    const baseRotation = optionalAttributeOffset(plan, 'base-rotation');
    const baseColor = optionalAttributeOffset(plan, 'base-color');
    const visual = rendererVisualSource(plan);
    return new ComputeShader({
        label: `${plan.definition.name}:particle-renderer-build`,
        workgroupSize: [WORKGROUP_SIZE],
        source: `
struct ParticleCounters { aliveCount: atomic<u32>, outputAliveCount: atomic<u32>, deadCount: atomic<u32>, nextIndex: atomic<u32>, droppedSpawnCount: atomic<u32>, };
@group(0) @binding(0) var<storage, read> state: array<u32>;
@group(0) @binding(1) var<storage, read> aliveIndices: array<u32>;
@group(0) @binding(2) var<storage, read_write> counters: ParticleCounters;
@group(0) @binding(3) var<storage, read_write> rendererData: array<vec4<f32>>;
fn stateFloat(wordOffset: u32) -> f32 { return bitcast<f32>(state[wordOffset]); }
${visual.declarations}
@compute @workgroup_size(${String(WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
    if (invocation.x >= atomicLoad(&counters.aliveCount)) { return; }
    let particleIndex = aliveIndices[invocation.x];
    let position = vec3<f32>(stateFloat(${String(position)}u + particleIndex * 3u), stateFloat(${String(position)}u + particleIndex * 3u + 1u), stateFloat(${String(position)}u + particleIndex * 3u + 2u));
    let particleVelocity = vec3<f32>(stateFloat(${String(velocity)}u + particleIndex * 3u), stateFloat(${String(velocity)}u + particleIndex * 3u + 1u), stateFloat(${String(velocity)}u + particleIndex * 3u + 2u));
    let noiseOffset = ${noise === null ? 'vec3<f32>(0.0)' : `vec3<f32>(stateFloat(${String(noise)}u + particleIndex * 3u), stateFloat(${String(noise)}u + particleIndex * 3u + 1u), stateFloat(${String(noise)}u + particleIndex * 3u + 2u))`};
    let particleAge = stateFloat(${String(age)}u + particleIndex);
    let normalizedAge = clamp(particleAge / max(stateFloat(${String(lifetime)}u + particleIndex), 0.000001), 0.0, 1.0);
    let particleSpeed = length(particleVelocity);
    let baseSize = stateFloat(${String(baseSize ?? size)}u + particleIndex);
    let baseRotation = stateFloat(${String(baseRotation ?? rotation)}u + particleIndex);
    let baseColor = vec4<f32>(stateFloat(${String(baseColor ?? color)}u + particleIndex * 4u), stateFloat(${String(baseColor ?? color)}u + particleIndex * 4u + 1u), stateFloat(${String(baseColor ?? color)}u + particleIndex * 4u + 2u), stateFloat(${String(baseColor ?? color)}u + particleIndex * 4u + 3u));
    var renderSize = stateFloat(${String(size)}u + particleIndex);
    var renderRotation = stateFloat(${String(rotation)}u + particleIndex);
    var renderFrame = stateFloat(${String(frame)}u + particleIndex);
    var renderColor = vec4<f32>(stateFloat(${String(color)}u + particleIndex * 4u), stateFloat(${String(color)}u + particleIndex * 4u + 1u), stateFloat(${String(color)}u + particleIndex * 4u + 2u), stateFloat(${String(color)}u + particleIndex * 4u + 3u));
    ${visual.statements}
    rendererData[invocation.x * 4u] = vec4<f32>(position + noiseOffset, renderSize);
    rendererData[invocation.x * 4u + 1u] = renderColor;
    rendererData[invocation.x * 4u + 2u] = vec4<f32>(renderRotation, renderFrame, 0.0, 0.0);
    rendererData[invocation.x * 4u + 3u] = vec4<f32>(particleVelocity, 0.0);
}`,
        bindings: [
            {
                name: 'state',
                group: 0,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: buffers.stateByteLength
            },
            {
                name: 'aliveIndices',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: buffers.aliveIndexByteLength
            },
            {
                name: 'counters',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write',
                minBindingSize: buffers.counterByteLength
            },
            {
                name: 'rendererData',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: buffers.rendererDataByteLength
            }
        ]
    });
}

function storageRenderer(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    renderer: ParticleSpriteRendererDefinition,
    buffers: ParticleGPUBufferLayout
): ParticleGPUStorageRendererPlan {
    const sheet = plan.definition.modules.find(module => module.type === 'texture-sheet');
    const rows = sheet?.type === 'texture-sheet' ? sheet.rows : 1;
    const columns = sheet?.type === 'texture-sheet' ? sheet.columns : 1;
    const textureSource = renderer.texture ? 'uniform sampler2D u_particleTexture;' : '';
    const textureSample = renderer.texture
        ? 'vec4 texel = texture(u_particleTexture, particleUV);'
        : 'vec4 texel = vec4(1.0);';
    const textureBinding = 1;
    const alignment = renderer.alignment ?? 'view';
    const pivot = renderer.pivot ?? [0, 0];
    const stretchScale = renderer.stretchScale ?? 1;
    const cameraOffset = plan.definition.modules.find(module => module.type === 'camera-offset');
    const cameraFade = plan.definition.modules.find(module => module.type === 'camera-fade');
    const screenSpaceSize = plan.definition.modules.find(
        module => module.type === 'screen-space-size'
    );
    const cameraOffsetSource =
        cameraOffset?.type === 'camera-offset'
            ? `viewPosition.z += ${f32(cameraOffset.scale ?? 0)};`
            : '';
    const cameraFadeSource =
        cameraFade?.type === 'camera-fade'
            ? `particleColor.a *= smoothstep(${f32(cameraFade.range?.[0] ?? 0)}, ${f32(cameraFade.range?.[1] ?? 1)}, distance(worldPosition.xyz, u_cameraPosition.xyz));`
            : '';
    const screenSizeSource =
        screenSpaceSize?.type === 'screen-space-size'
            ? `particleSize = clamp(particleSize, ${f32(screenSpaceSize.range?.[0] ?? 0)}, ${f32(screenSpaceSize.range?.[1] ?? Number.MAX_SAFE_INTEGER)}) * max(0.000001, -viewPosition.z) * 2.0 / max(1.0, u_viewport.y * u_projectionMatrix[1][1]) * ${f32(screenSpaceSize.scale ?? 1)};`
            : '';
    const alignmentSource =
        alignment === 'world-up'
            ? `vec2 upAxis = normalize((u_viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy + vec2(0.000001, 0.0));
    vec2 sideAxis = vec2(upAxis.y, -upAxis.x);`
            : alignment === 'stretched' || alignment === 'velocity'
              ? `vec2 upAxis = normalize(viewVelocity.xy + vec2(0.000001, 0.0));
    vec2 sideAxis = vec2(upAxis.y, -upAxis.x);
    ${alignment === 'stretched' ? `corner.y *= 1.0 + length(viewVelocity) * ${f32(stretchScale)} / max(positionSize.w, 0.000001);` : ''}`
              : `vec2 sideAxis = vec2(1.0, 0.0);
    vec2 upAxis = vec2(0.0, 1.0);`;
    const bindings = [
        {
            name: 'ParticleViewBlock',
            group: 0,
            binding: 0,
            kind: 'uniform-buffer' as const,
            minBindingSize: 224
        },
        {
            name: 'particleRenderData',
            group: 3,
            binding: 0,
            kind: 'read-only-storage-buffer' as const,
            minBindingSize: buffers.rendererDataByteLength
        },
        ...(renderer.texture
            ? [
                  {
                      name: 'u_particleTexture',
                      group: 3,
                      binding: textureBinding,
                      kind: 'sampled-texture' as const,
                      sampleType: 'float' as const
                  },
                  {
                      name: 'u_particleTexture',
                      group: 3,
                      binding: textureBinding + 1,
                      kind: 'sampler' as const
                  }
              ]
            : [])
    ];
    return Object.freeze({
        definition: renderer,
        shader: new StorageGraphicsShader({
            label: `${plan.definition.name}:particle-storage-sprite`,
            bindings,
            vertexSource: `#version 310 es
precision highp float;
precision highp int;
layout(std140) uniform ParticleViewBlock {
    mat4 u_viewMatrix;
    mat4 u_projectionMatrix;
    mat4 u_modelMatrix;
    vec4 u_cameraPosition;
    vec4 u_viewport;
};
layout(std430) readonly buffer ParticleRenderData { vec4 values[]; } particleRenderData;
out vec2 particleUV; out vec4 particleColor;
vec2 particleCorner(int vertexIndex) {
    vec2 corner = vec2(-0.5, -0.5);
    if (vertexIndex == 1 || vertexIndex == 2 || vertexIndex == 4) corner.x = 0.5;
    if (vertexIndex == 2 || vertexIndex == 4 || vertexIndex == 5) corner.y = 0.5;
    return corner;
}
void main() {
    int instanceIndex = int(floor(float(gl_VertexID) / 6.0));
    int localIndex = int(mod(float(gl_VertexID), 6.0));
    vec4 positionSize = particleRenderData.values[instanceIndex * 4];
    vec4 sourceColor = particleRenderData.values[instanceIndex * 4 + 1];
    vec4 rotationFrame = particleRenderData.values[instanceIndex * 4 + 2];
    vec4 velocityData = particleRenderData.values[instanceIndex * 4 + 3];
    vec2 corner = particleCorner(localIndex) - vec2(${f32(pivot[0])}, ${f32(pivot[1])});
    float sine = sin(rotationFrame.x); float cosine = cos(rotationFrame.x);
    corner = mat2(cosine, sine, -sine, cosine) * corner;
    vec4 worldPosition = u_modelMatrix * vec4(positionSize.xyz, 1.0);
    vec4 viewPosition = u_viewMatrix * worldPosition;
    vec3 viewVelocity = (u_viewMatrix * u_modelMatrix * vec4(velocityData.xyz, 0.0)).xyz;
    float particleSize = positionSize.w;
    ${cameraOffsetSource}
    ${screenSizeSource}
    ${alignmentSource}
    vec2 alignedCorner = sideAxis * corner.x + upAxis * corner.y;
    gl_Position = u_projectionMatrix * vec4(viewPosition.xyz + vec3(alignedCorner * particleSize, 0.0), 1.0);
    float frameValue = mod(max(0.0, floor(rotationFrame.y)), ${String(rows * columns)}.0);
    particleUV = (particleCorner(localIndex) + vec2(0.5) + vec2(mod(frameValue, ${String(columns)}.0), floor(frameValue / ${String(columns)}.0))) / vec2(${String(columns)}.0, ${String(rows)}.0);
    particleColor = sourceColor;
    ${cameraFadeSource}
}`,
            fragmentSource: `#version 310 es
precision highp float;
precision highp int;
in vec2 particleUV; in vec4 particleColor;
${textureSource}
layout(location = 0) out vec4 fragmentColor;
void main() { ${textureSample} vec4 color = texel * particleColor; ${renderer.blend === 'alpha' || renderer.blend === undefined ? '' : 'color.rgb *= color.a;'} if (color.a <= 0.00001) discard; fragmentColor = color; }`
        })
    });
}

/** Generate fixed Direct-WGSL kernels and constrained storage-raster artifacts before a frame. */
export function compileParticleGPUPlan(
    plan: Readonly<ParticleCompiledEmitterPlan>
): Readonly<ParticleGPUCompiledPlan> {
    if (plan.kind !== 'gpu-stateful') {
        throw new TypeError('Particle GPU compiler requires a gpu-stateful emitter plan');
    }
    if (plan.definition.bounds.mode === 'dynamic') {
        throw new TypeError('Particle GPU plans require manual or conservative automatic bounds');
    }
    const buffers: ParticleGPUBufferLayout = Object.freeze({
        stateByteLength: align(plan.attributeByteLength, 16),
        aliveIndexByteLength: align(plan.definition.capacity * 4, 16),
        deadIndexByteLength: align(plan.definition.capacity * 4, 16),
        counterByteLength: 32,
        parameterByteLength: 96,
        spawnCommandByteLength: align(plan.definition.capacity * 64, 16),
        rendererDataByteLength: align(plan.definition.capacity * 64, 16),
        indirectArgumentByteLength: 16
    });
    const simple = simpleShaders(plan, buffers);
    const usesDistanceSort = plan.definition.renderers.some(
        renderer => (renderer.sort ?? 'none') === 'distance'
    );
    const capacityIsPowerOfTwo = (plan.definition.capacity & (plan.definition.capacity - 1)) === 0;
    const sortStrategy: ParticleGPUCompiledPlan['sortStrategy'] = !usesDistanceSort
        ? 'none'
        : plan.definition.capacity <= 4096 && capacityIsPowerOfTwo
          ? 'bitonic'
          : 'radix-buckets';
    const sort = sortShader(plan, buffers, sortStrategy);
    return Object.freeze({
        emitter: plan,
        buffers,
        shaders: Object.freeze({
            recovery: simple.recovery,
            resetCounters: simple.resetCounters,
            simulate: simulateShader(plan, buffers),
            initialize: initializeShader(plan, buffers),
            finalize: simple.finalize,
            buildRenderer: rendererBuildShader(plan, buffers),
            sort
        }),
        renderers: Object.freeze(
            plan.definition.renderers.map(renderer => storageRenderer(plan, renderer, buffers))
        ),
        workgroupCount: Math.ceil(plan.definition.capacity / WORKGROUP_SIZE),
        sortStrategy,
        recoveryPolicy: 'reinitialize'
    });
}
