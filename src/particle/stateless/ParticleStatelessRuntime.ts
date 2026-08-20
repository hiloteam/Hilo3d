import type ParticleCurve from '../ParticleCurve';
import type ParticleGradient from '../ParticleGradient';
import { ParticleParameterSet, resolveParticleParameter } from '../ParticleParameter';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import type { ParticleRandomKey } from '../ParticleRandom';
import type { ParticleModule, ParticleScalarSource, ParticleVector3 } from '../ParticleTypes';
import {
    normalizeParticleVector,
    sampleParticleColor,
    sampleParticleScalar,
    sampleParticleShape,
    sampleParticleVector,
    type ParticleEmitterFrameContext,
    type ParticleManualEmitCommand
} from '../cpu/ParticleCPUSimulator';
import { ParticleCPUState } from '../cpu/ParticleCPUState';
import { particleCurlNoise, particleVectorNoise } from '../cpu/ParticleNoise';

const ZERO_VECTOR: ParticleVector3 = Object.freeze([0, 0, 0]);
const UP_VECTOR: ParticleVector3 = Object.freeze([0, 1, 0]);
const ONE_VECTOR: ParticleVector3 = Object.freeze([1, 1, 1]);
const UNIT_RANGE = Object.freeze([0, 1] as const);
const MANUAL_ID_BASE = 0x8000_0000;
const BURST_ID_BASE = 0x4000_0000;

interface MutableParticleRandomKey {
    systemSeed: number;
    emitterId: number;
    particleId: number;
    generation: number;
    lane: number;
}

interface ParticleStatelessManualBatch {
    readonly time: number;
    readonly firstId: number;
    readonly count: number;
    readonly position?: ParticleVector3;
    readonly velocity?: ParticleVector3;
    readonly emitterPosition: ParticleVector3;
}

function maximumScalar(
    value: ParticleScalarSource | undefined,
    fallback: number,
    parameters: ParticleParameterSet
): number {
    if (value === undefined) return fallback;
    const source = resolveParticleParameter(value, parameters);
    return typeof source === 'number' ? source : source.max;
}

function scalarRate(
    value: ParticleScalarSource | undefined,
    parameters: ParticleParameterSet
): number {
    if (value === undefined) return 0;
    const source = resolveParticleParameter(value, parameters);
    return Math.max(0, typeof source === 'number' ? source : (source.min + source.max) * 0.5);
}

function length3(x: number, y: number, z: number): number {
    return Math.hypot(x, y, z);
}

function sampleLUT(values: Float32Array, time: number): number {
    const position = Math.min(1, Math.max(0, time)) * (values.length - 1);
    const left = Math.floor(position);
    const right = Math.min(values.length - 1, left + 1);
    const amount = position - left;
    return Math.fround((values[left] ?? 0) + ((values[right] ?? 0) - (values[left] ?? 0)) * amount);
}

/**
 * Reconstructs renderer attributes from absolute emitter time without preserving particle motion
 * state between frames. The retained manual batches are spawn metadata, not per-particle state.
 */
export class ParticleStatelessRuntime {
    readonly plan: Readonly<ParticleCompiledEmitterPlan>;
    readonly state: ParticleCPUState;
    readonly #seed: number;
    readonly #parameters: ParticleParameterSet;
    readonly #curveLUTs = new Map<ParticleCurve, Float32Array>();
    readonly #gradientLUTs = new Map<ParticleGradient, Float32Array>();
    readonly #temporaryA = new Float32Array(4);
    readonly #temporaryB = new Float32Array(4);
    readonly #temporaryC = new Float32Array(4);
    readonly #keyValue: MutableParticleRandomKey;
    readonly #manualBatches: ParticleStatelessManualBatch[] = [];
    readonly #pendingCommands: ParticleManualEmitCommand[] = [];
    readonly #emitterPosition: [number, number, number] = [0, 0, 0];
    #emitterAge = 0;
    #manualSequence = MANUAL_ID_BASE;
    #particleLimit: number;
    #spawnRateScale = 1;

    constructor(
        plan: Readonly<ParticleCompiledEmitterPlan>,
        seed: number,
        parameters = new ParticleParameterSet()
    ) {
        if (plan.kind !== 'stateless') {
            throw new TypeError('ParticleStatelessRuntime requires a stateless compiled plan');
        }
        this.plan = plan;
        this.state = new ParticleCPUState(plan);
        this.#particleLimit = this.state.capacity;
        this.#seed = seed >>> 0;
        this.#parameters = parameters;
        this.#keyValue = {
            systemSeed: this.#seed,
            emitterId: plan.emitterId,
            particleId: 0,
            generation: 0,
            lane: 0
        };
        for (const lut of plan.curveLUTs) this.#curveLUTs.set(lut.curve, lut.values);
        for (const lut of plan.gradientLUTs) this.#gradientLUTs.set(lut.gradient, lut.values);
    }

    get emitterAge(): number {
        return this.#emitterAge;
    }

    /** Stateless emitters have no fixed-step remainder because absolute time is authoritative. */
    readonly accumulator = 0;

    /** Apply renderer-local capacity and scheduled-emission scaling. @internal */
    setBudget(
        particleLimit: number,
        spawnRateScale: number,
        _collision: boolean,
        materialize = true
    ): void {
        if (!Number.isSafeInteger(particleLimit) || particleLimit < 0) {
            throw new RangeError('Particle budget limit must be a non-negative safe integer');
        }
        if (!Number.isFinite(spawnRateScale) || spawnRateScale < 0) {
            throw new RangeError(
                'Particle budget spawn-rate scale must be finite and non-negative'
            );
        }
        this.#particleLimit = Math.min(this.state.capacity, particleLimit);
        this.#spawnRateScale = spawnRateScale;
        if (materialize) this.rebuild();
    }

    emit(command: number | Readonly<ParticleManualEmitCommand>): void {
        const normalized = typeof command === 'number' ? { count: command } : command;
        if (!Number.isSafeInteger(normalized.count) || normalized.count < 0) {
            throw new RangeError('Particle manual emit count must be a non-negative integer');
        }
        if (normalized.count > 0) this.#pendingCommands.push(Object.freeze({ ...normalized }));
    }

    clear(): void {
        this.state.clear();
        this.#manualBatches.length = 0;
        this.#pendingCommands.length = 0;
    }

    restart(): void {
        this.clear();
        this.#emitterAge = 0;
        this.#manualSequence = MANUAL_ID_BASE;
    }

    simulate(
        deltaTime: number,
        context: Readonly<ParticleEmitterFrameContext>,
        fixedStep = this.plan.definition.fixedStep,
        materialize = true
    ): number {
        if (!Number.isFinite(deltaTime) || deltaTime < 0) {
            throw new RangeError('Particle simulation deltaTime must be finite and non-negative');
        }
        if (!Number.isFinite(fixedStep) || fixedStep <= 0) {
            throw new RangeError('Particle simulation fixedStep must be positive');
        }
        this.#emitterPosition[0] = context.position[0];
        this.#emitterPosition[1] = context.position[1];
        this.#emitterPosition[2] = context.position[2];
        this.flushManualCommands();
        this.#emitterAge = Math.fround(this.#emitterAge + deltaTime);
        if (materialize) this.rebuild();
        return deltaTime === 0 ? 0 : 1;
    }

    private flushManualCommands(): void {
        for (const command of this.#pendingCommands) {
            const firstId = this.#manualSequence;
            this.#manualSequence = (this.#manualSequence + command.count) >>> 0;
            this.#manualBatches.push(
                Object.freeze({
                    time: this.#emitterAge,
                    firstId,
                    count: command.count,
                    ...(command.position === undefined ? {} : { position: command.position }),
                    ...(command.velocity === undefined ? {} : { velocity: command.velocity }),
                    emitterPosition: Object.freeze([...this.#emitterPosition] as ParticleVector3)
                })
            );
        }
        this.#pendingCommands.length = 0;
    }

    private rebuild(): void {
        this.state.aliveCount = 0;
        const definition = this.plan.definition;
        const maximumLifetime = maximumScalar(definition.initialize.lifetime, 1, this.#parameters);
        const activeTime = Math.max(0, this.#emitterAge - definition.startDelay);
        const oldestTime = Math.max(0, activeTime - maximumLifetime);
        const rate =
            scalarRate(definition.emission.rateOverTime, this.#parameters) * this.#spawnRateScale;
        if (rate > 0) {
            const emissionEnd = definition.looping
                ? activeTime
                : Math.min(activeTime, definition.duration);
            const firstOrdinal = Math.max(1, Math.floor(oldestTime * rate));
            const lastOrdinal = Math.floor(emissionEnd * rate);
            for (let ordinal = firstOrdinal; ordinal <= lastOrdinal; ordinal += 1) {
                const spawnTime = ordinal / rate;
                this.generateParticle(ordinal - 1, Math.max(0, activeTime - spawnTime));
            }
        }
        const bursts = definition.emission.bursts ?? [];
        const maximumLoop = definition.looping ? Math.floor(activeTime / definition.duration) : 0;
        const maximumBurstTime = bursts.reduce(
            (maximum, burst) =>
                Math.max(maximum, burst.time + ((burst.cycles ?? 1) - 1) * (burst.interval ?? 0)),
            0
        );
        const minimumLoop = definition.looping
            ? Math.max(0, Math.floor((oldestTime - maximumBurstTime) / definition.duration))
            : 0;
        const burstIdsPerLoop = bursts.reduce(
            (total, burst) => total + burst.count * (burst.cycles ?? 1),
            0
        );
        let burstSequenceBase = (BURST_ID_BASE + Math.imul(minimumLoop, burstIdsPerLoop)) >>> 0;
        for (let loop = minimumLoop; loop <= maximumLoop; loop += 1) {
            const loopBase = loop * definition.duration;
            for (const burst of bursts) {
                for (let cycle = 0; cycle < (burst.cycles ?? 1); cycle += 1) {
                    const spawnTime = loopBase + burst.time + cycle * (burst.interval ?? 0);
                    if (spawnTime > activeTime || spawnTime < oldestTime) {
                        burstSequenceBase += burst.count;
                        continue;
                    }
                    const scaledBurstCount = Math.floor(burst.count * this.#spawnRateScale);
                    for (let index = 0; index < scaledBurstCount; index += 1) {
                        const id = (burstSequenceBase + index) >>> 0;
                        this.generateParticle(id, Math.max(0, activeTime - spawnTime));
                    }
                    burstSequenceBase += burst.count;
                }
            }
        }
        const minimumManualTime = this.#emitterAge - maximumLifetime;
        let retainedStart = 0;
        for (const batch of this.#manualBatches) {
            if (batch.time < minimumManualTime) {
                retainedStart++;
                continue;
            }
            const age = this.#emitterAge - batch.time;
            for (let index = 0; index < batch.count; index += 1) {
                this.generateParticle((batch.firstId + index) >>> 0, age, batch);
            }
        }
        if (retainedStart > 0) this.#manualBatches.splice(0, retainedStart);
        this.state.markChanged();
    }

    private generateParticle(
        particleId: number,
        age: number,
        manual?: Readonly<ParticleStatelessManualBatch>
    ): void {
        const lifetime = Math.max(
            1e-6,
            sampleParticleScalar(
                this.plan.definition.initialize.lifetime,
                1,
                this.key(particleId, 60),
                this.#parameters
            )
        );
        if (age >= lifetime) return;
        let index = this.state.aliveCount;
        if (index >= this.#particleLimit) {
            if (this.#particleLimit === 0) return;
            if (this.plan.definition.overflow === 'drop-new') return;
            index = this.oldestParticleIndex();
        } else {
            this.state.aliveCount++;
        }
        const position = this.#temporaryA;
        const direction = this.#temporaryB;
        sampleParticleShape(
            this.plan.definition.shape,
            this.key(particleId, 0),
            position,
            direction
        );
        sampleParticleVector(
            this.plan.definition.initialize.position,
            ZERO_VECTOR,
            this.key(particleId, 30),
            this.#temporaryC,
            this.#parameters
        );
        position[0] = (position[0] ?? 0) + (this.#temporaryC[0] ?? 0);
        position[1] = (position[1] ?? 0) + (this.#temporaryC[1] ?? 0);
        position[2] = (position[2] ?? 0) + (this.#temporaryC[2] ?? 0);
        if (manual?.position) position.set(manual.position);
        if (this.plan.definition.simulationSpace === 'world') {
            const emitterPosition = manual?.emitterPosition ?? this.#emitterPosition;
            position[0] = position[0] + emitterPosition[0];
            position[1] = position[1] + emitterPosition[1];
            position[2] = position[2] + emitterPosition[2];
        }
        if (this.plan.definition.initialize.direction !== undefined) {
            sampleParticleVector(
                this.plan.definition.initialize.direction,
                UP_VECTOR,
                this.key(particleId, 40),
                direction,
                this.#parameters
            );
            normalizeParticleVector(direction);
        }
        const speed = sampleParticleScalar(
            this.plan.definition.initialize.speed,
            0,
            this.key(particleId, 50),
            this.#parameters
        );
        const offset = index * 3;
        const positions = this.state.f32('position');
        const previousPositions = this.state.f32('previous-position');
        const velocities = this.state.f32('velocity');
        positions[offset] = position[0];
        positions[offset + 1] = position[1];
        positions[offset + 2] = position[2];
        velocities[offset] = (direction[0] ?? 0) * speed;
        velocities[offset + 1] = (direction[1] ?? 0) * speed;
        velocities[offset + 2] = (direction[2] ?? 0) * speed;
        if (manual?.velocity) velocities.set(manual.velocity, offset);
        this.state.f32('age')[index] = age;
        this.state.f32('lifetime')[index] = lifetime;
        const normalizedAge = Math.min(1, age / lifetime);
        this.state.f32('normalized-age')[index] = normalizedAge;
        this.state.u32('stable-id')[index] = particleId;
        this.state.u32('generation')[index] = 0;
        this.state.u32('alive')[index] = 1;
        if (this.state.has('spawn-position')) {
            this.state.f32('spawn-position').set(positions.subarray(offset, offset + 3), offset);
        }
        this.initializeAttributes(index, particleId);
        this.reconstructMotion(index, particleId, age);
        previousPositions[offset] = positions[offset] ?? 0;
        previousPositions[offset + 1] = positions[offset + 1] ?? 0;
        previousPositions[offset + 2] = positions[offset + 2] ?? 0;
        this.updateVisualAttributes(index, normalizedAge);
    }

    private initializeAttributes(index: number, particleId: number): void {
        if (this.state.has('size')) {
            const size = sampleParticleScalar(
                this.plan.definition.initialize.size,
                1,
                this.key(particleId, 70),
                this.#parameters
            );
            this.state.f32('size')[index] = size;
            if (this.state.has('base-size')) this.state.f32('base-size')[index] = size;
        }
        if (this.state.has('rotation')) {
            const rotation = sampleParticleScalar(
                this.plan.definition.initialize.rotation,
                0,
                this.key(particleId, 71),
                this.#parameters
            );
            this.state.f32('rotation')[index] = rotation;
            if (this.state.has('base-rotation')) this.state.f32('base-rotation')[index] = rotation;
        }
        if (this.state.has('color')) {
            sampleParticleColor(
                this.plan.definition.initialize.color,
                this.key(particleId, 72),
                this.#temporaryA,
                this.#parameters
            );
            this.state.f32('color').set(this.#temporaryA, index * 4);
            if (this.state.has('base-color')) {
                this.state.f32('base-color').set(this.#temporaryA, index * 4);
            }
        }
        if (this.state.has('sprite-frame')) this.state.f32('sprite-frame')[index] = 0;
        if (this.state.has('mesh-index')) {
            this.state.u32('mesh-index')[index] = Math.floor(
                sampleParticleScalar(
                    this.plan.definition.initialize.meshIndex,
                    particleId,
                    this.key(particleId, 74),
                    this.#parameters
                )
            );
        }
        if (this.state.has('ribbon-id')) {
            this.state.u32('ribbon-id')[index] = Math.floor(
                sampleParticleScalar(
                    this.plan.definition.initialize.ribbonId,
                    0,
                    this.key(particleId, 75),
                    this.#parameters
                )
            );
        }
        if (this.state.has('mass')) {
            this.state.f32('mass')[index] = Math.max(
                1e-6,
                sampleParticleScalar(
                    this.plan.definition.initialize.mass,
                    1,
                    this.key(particleId, 73),
                    this.#parameters
                )
            );
        }
        for (const module of this.plan.definition.modules) {
            if (module.type !== 'custom-channel') continue;
            const values = this.state.f32(`custom:${module.name}`);
            const source = typeof module.value === 'number' ? [module.value] : module.value;
            for (let component = 0; component < source.length; component += 1) {
                values[index * source.length + component] = source[component] ?? 0;
            }
        }
    }

    private reconstructMotion(index: number, particleId: number, age: number): void {
        const positions = this.state.f32('position');
        const velocities = this.state.f32('velocity');
        const offset = index * 3;
        const approximated = this.plan.statelessModules.some(
            metadata => metadata.support === 'approximated'
        );
        const steps = approximated ? Math.min(16, Math.max(1, Math.ceil(age / 0.0625))) : 1;
        const deltaTime = steps === 0 ? 0 : age / steps;
        for (let step = 0; step < steps; step += 1) {
            let vx = velocities[offset] ?? 0;
            let vy = velocities[offset + 1] ?? 0;
            let vz = velocities[offset + 2] ?? 0;
            let extraX = 0;
            let extraY = 0;
            let extraZ = 0;
            for (const module of this.plan.definition.modules) {
                switch (module.type) {
                    case 'velocity-over-lifetime':
                        sampleParticleVector(
                            module.velocity,
                            ZERO_VECTOR,
                            this.key(particleId, 100),
                            this.#temporaryA
                        );
                        extraX += this.#temporaryA[0] ?? 0;
                        extraY += this.#temporaryA[1] ?? 0;
                        extraZ += this.#temporaryA[2] ?? 0;
                        break;
                    case 'force-over-lifetime':
                    case 'gravity':
                    case 'wind': {
                        sampleParticleVector(
                            module.force,
                            ZERO_VECTOR,
                            this.key(particleId, 110),
                            this.#temporaryA
                        );
                        const inverseMass = this.state.has('mass')
                            ? 1 / Math.max(1e-6, this.state.f32('mass')[index] ?? 1)
                            : 1;
                        vx += (this.#temporaryA[0] ?? 0) * inverseMass * deltaTime;
                        vy += (this.#temporaryA[1] ?? 0) * inverseMass * deltaTime;
                        vz += (this.#temporaryA[2] ?? 0) * inverseMass * deltaTime;
                        break;
                    }
                    case 'drag': {
                        const damping = 1 / (1 + module.coefficient * deltaTime);
                        vx *= damping;
                        vy *= damping;
                        vz *= damping;
                        break;
                    }
                    case 'limit-velocity': {
                        const speed = length3(vx, vy, vz);
                        const limit = Math.max(
                            0,
                            sampleParticleScalar(module.limit, 0, this.key(particleId, 120))
                        );
                        if (speed > limit && speed > 0) {
                            const ratio = limit / speed;
                            const dampen = module.dampen ?? 1;
                            vx *= 1 + (ratio - 1) * dampen;
                            vy *= 1 + (ratio - 1) * dampen;
                            vz *= 1 + (ratio - 1) * dampen;
                        }
                        break;
                    }
                    case 'radial-force':
                    case 'point-attraction':
                    case 'line-attraction':
                    case 'orbital-force':
                    case 'vortex-force':
                    case 'rotate-around-point':
                    case 'conform-sphere':
                        this.approximatedForce(module, index, particleId, this.#temporaryA);
                        vx += (this.#temporaryA[0] ?? 0) * deltaTime;
                        vy += (this.#temporaryA[1] ?? 0) * deltaTime;
                        vz += (this.#temporaryA[2] ?? 0) * deltaTime;
                        break;
                    default:
                        break;
                }
            }
            velocities[offset] = Math.fround(vx);
            velocities[offset + 1] = Math.fround(vy);
            velocities[offset + 2] = Math.fround(vz);
            positions[offset] = Math.fround((positions[offset] ?? 0) + (vx + extraX) * deltaTime);
            positions[offset + 1] = Math.fround(
                (positions[offset + 1] ?? 0) + (vy + extraY) * deltaTime
            );
            positions[offset + 2] = Math.fround(
                (positions[offset + 2] ?? 0) + (vz + extraZ) * deltaTime
            );
        }
        for (const module of this.plan.definition.modules) {
            if (module.type !== 'noise' || module.mode !== 'position-offset') continue;
            const source = this.state.f32('spawn-position');
            const scroll = module.scrollVelocity ?? ZERO_VECTOR;
            const seed = (this.#seed + (module.seedOffset ?? 0)) >>> 0;
            const sample = this.#temporaryA;
            const x = ((source[offset] ?? 0) + scroll[0] * age) * module.frequency;
            const y = ((source[offset + 1] ?? 0) + scroll[1] * age) * module.frequency;
            const z = ((source[offset + 2] ?? 0) + scroll[2] * age) * module.frequency;
            if (module.field === 'curl') {
                particleCurlNoise(
                    x,
                    y,
                    z,
                    seed,
                    module.octaves,
                    module.lacunarity ?? 2,
                    module.persistence ?? 0.5,
                    sample
                );
            } else {
                particleVectorNoise(
                    x,
                    y,
                    z,
                    seed,
                    module.octaves,
                    module.lacunarity ?? 2,
                    module.persistence ?? 0.5,
                    sample
                );
            }
            sampleParticleVector(
                module.strength,
                ONE_VECTOR,
                this.key(particleId, 130),
                this.#temporaryB
            );
            const offsets = this.state.f32('noise-offset');
            offsets[offset] = (sample[0] ?? 0) * (this.#temporaryB[0] ?? 0);
            offsets[offset + 1] = (sample[1] ?? 0) * (this.#temporaryB[1] ?? 0);
            offsets[offset + 2] = (sample[2] ?? 0) * (this.#temporaryB[2] ?? 0);
        }
    }

    private approximatedForce(
        module: Extract<
            ParticleModule,
            {
                type:
                    | 'radial-force'
                    | 'point-attraction'
                    | 'line-attraction'
                    | 'orbital-force'
                    | 'vortex-force'
                    | 'rotate-around-point'
                    | 'conform-sphere';
            }
        >,
        index: number,
        particleId: number,
        target: Float32Array
    ): void {
        const positions = this.state.f32('position');
        const offset = index * 3;
        const center =
            'center' in module
                ? (module.center ?? ZERO_VECTOR)
                : 'point' in module
                  ? (module.point ?? ZERO_VECTOR)
                  : ZERO_VECTOR;
        let dx = center[0] - (positions[offset] ?? 0);
        let dy = center[1] - (positions[offset + 1] ?? 0);
        let dz = center[2] - (positions[offset + 2] ?? 0);
        if (module.type === 'line-attraction') {
            const start = module.lineStart ?? ZERO_VECTOR;
            const end = module.lineEnd ?? UP_VECTOR;
            const lx = end[0] - start[0];
            const ly = end[1] - start[1];
            const lz = end[2] - start[2];
            const squared = lx * lx + ly * ly + lz * lz;
            const amount =
                squared <= 1e-8
                    ? 0
                    : Math.min(
                          1,
                          Math.max(
                              0,
                              (((positions[offset] ?? 0) - start[0]) * lx +
                                  ((positions[offset + 1] ?? 0) - start[1]) * ly +
                                  ((positions[offset + 2] ?? 0) - start[2]) * lz) /
                                  squared
                          )
                      );
            dx = start[0] + lx * amount - (positions[offset] ?? 0);
            dy = start[1] + ly * amount - (positions[offset + 1] ?? 0);
            dz = start[2] + lz * amount - (positions[offset + 2] ?? 0);
        }
        const length = Math.max(1e-6, length3(dx, dy, dz));
        const nx = dx / length;
        const ny = dy / length;
        const nz = dz / length;
        if (module.type === 'conform-sphere') {
            const error = length - module.radius;
            target[0] = nx * error * module.strength;
            target[1] = ny * error * module.strength;
            target[2] = nz * error * module.strength;
            return;
        }
        if (module.type === 'rotate-around-point') {
            const axis = module.axis ?? UP_VECTOR;
            const speed = sampleParticleScalar(module.angularSpeed, 0, this.key(particleId, 140));
            target[0] = (axis[1] * dz - axis[2] * dy) * speed;
            target[1] = (axis[2] * dx - axis[0] * dz) * speed;
            target[2] = (axis[0] * dy - axis[1] * dx) * speed;
            return;
        }
        const strength = sampleParticleScalar(module.strength, 0, this.key(particleId, 141));
        if (module.type === 'orbital-force' || module.type === 'vortex-force') {
            const axis = module.axis ?? UP_VECTOR;
            const tx = axis[1] * dz - axis[2] * dy;
            const ty = axis[2] * dx - axis[0] * dz;
            const tz = axis[0] * dy - axis[1] * dx;
            const tangentLength = Math.max(1e-6, length3(tx, ty, tz));
            target[0] = (tx / tangentLength) * strength;
            target[1] = (ty / tangentLength) * strength;
            target[2] = (tz / tangentLength) * strength;
            return;
        }
        target[0] = nx * strength;
        target[1] = ny * strength;
        target[2] = nz * strength;
    }

    private updateVisualAttributes(index: number, normalizedAge: number): void {
        const velocity = this.state.f32('velocity');
        const offset = index * 3;
        const speed = length3(
            velocity[offset] ?? 0,
            velocity[offset + 1] ?? 0,
            velocity[offset + 2] ?? 0
        );
        for (const module of this.plan.definition.modules) {
            switch (module.type) {
                case 'size-over-lifetime':
                    this.state.f32('size')[index] = Math.fround(
                        (this.state.f32('base-size')[index] ?? 1) *
                            this.curve(module.curve, normalizedAge)
                    );
                    break;
                case 'rotation-over-lifetime':
                    this.state.f32('rotation')[index] = Math.fround(
                        (this.state.f32('base-rotation')[index] ?? 0) +
                            this.curve(module.curve, normalizedAge)
                    );
                    break;
                case 'alpha-over-lifetime': {
                    const colorOffset = index * 4;
                    this.state.f32('color')[colorOffset + 3] = Math.fround(
                        (this.state.f32('base-color')[colorOffset + 3] ?? 1) *
                            this.curve(module.curve, normalizedAge)
                    );
                    break;
                }
                case 'color-over-lifetime':
                    this.gradient(module.gradient, normalizedAge, this.#temporaryA);
                    this.multiplyBaseColor(index, this.#temporaryA);
                    break;
                case 'size-by-speed':
                    this.state.f32('size')[index] = Math.fround(
                        (this.state.f32('base-size')[index] ?? 1) *
                            this.curve(module.curve, this.speedAmount(speed, module.speedRange))
                    );
                    break;
                case 'rotation-by-speed':
                    this.state.f32('rotation')[index] = Math.fround(
                        (this.state.f32('base-rotation')[index] ?? 0) +
                            this.curve(module.curve, this.speedAmount(speed, module.speedRange))
                    );
                    break;
                case 'color-by-speed':
                    this.gradient(
                        module.gradient,
                        this.speedAmount(speed, module.speedRange),
                        this.#temporaryA
                    );
                    this.multiplyBaseColor(index, this.#temporaryA);
                    break;
                case 'frame-over-lifetime':
                    this.state.f32('sprite-frame')[index] = Math.fround(
                        this.curve(module.curve, normalizedAge) * (module.cycles ?? 1)
                    );
                    break;
                case 'texture-sheet': {
                    const frameCount = module.rows * module.columns;
                    const amount =
                        module.mode === 'lifetime'
                            ? normalizedAge * (module.cycles ?? 1)
                            : module.mode === 'speed'
                              ? this.speedAmount(speed, module.speedRange ?? UNIT_RANGE)
                              : ((this.state.f32('age')[index] ?? 0) * (module.fps ?? 1)) /
                                frameCount;
                    this.state.f32('sprite-frame')[index] =
                        Math.floor(amount * frameCount) % frameCount;
                    break;
                }
                default:
                    break;
            }
        }
    }

    private curve(curve: ParticleCurve, time: number): number {
        const values = this.#curveLUTs.get(curve);
        if (!values) throw new Error('Particle curve LUT is unavailable');
        return sampleLUT(values, time);
    }

    private gradient(gradient: ParticleGradient, time: number, target: Float32Array): void {
        const values = this.#gradientLUTs.get(gradient);
        if (!values) throw new Error('Particle gradient LUT is unavailable');
        const sampleCount = values.length / 4;
        const position = Math.min(1, Math.max(0, time)) * (sampleCount - 1);
        const left = Math.floor(position);
        const right = Math.min(sampleCount - 1, left + 1);
        const amount = position - left;
        for (let component = 0; component < 4; component += 1) {
            const a = values[left * 4 + component] ?? 0;
            const b = values[right * 4 + component] ?? a;
            target[component] = Math.fround(a + (b - a) * amount);
        }
    }

    private multiplyBaseColor(index: number, multiplier: Float32Array): void {
        const color = this.state.f32('color');
        const base = this.state.f32('base-color');
        const offset = index * 4;
        for (let component = 0; component < 4; component += 1) {
            color[offset + component] = Math.fround(
                (base[offset + component] ?? 1) * (multiplier[component] ?? 1)
            );
        }
    }

    private speedAmount(speed: number, range: readonly [number, number]): number {
        return Math.min(1, Math.max(0, (speed - range[0]) / Math.max(1e-6, range[1] - range[0])));
    }

    private oldestParticleIndex(): number {
        const ages = this.state.f32('age');
        let oldest = 0;
        for (let index = 1; index < this.state.aliveCount; index += 1) {
            if ((ages[index] ?? 0) > (ages[oldest] ?? 0)) oldest = index;
        }
        return oldest;
    }

    private key(particleId: number, lane: number): ParticleRandomKey {
        this.#keyValue.particleId = particleId;
        this.#keyValue.lane = lane;
        return this.#keyValue;
    }
}
