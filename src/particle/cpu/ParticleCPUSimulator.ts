import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import type ParticleCurve from '../ParticleCurve';
import type ParticleEmitterDefinition from '../ParticleEmitterDefinition';
import type ParticleGradient from '../ParticleGradient';
import {
    particleRandomFloat,
    particleRandomFloatLane,
    type ParticleRandomKey
} from '../ParticleRandom';
import type {
    ParticleColorValue,
    ParticleModule,
    ParticleRange,
    ParticleScalarValue,
    ParticleShapeDefinition,
    ParticleVector3,
    ParticleVector3Value
} from '../ParticleTypes';
import { ParticleCPUState } from './ParticleCPUState';
import { particleCurlNoise, particleVectorNoise } from './ParticleNoise';

const ZERO_VECTOR: ParticleVector3 = Object.freeze([0, 0, 0]);
const UP_VECTOR: ParticleVector3 = Object.freeze([0, 1, 0]);
const ONE_VECTOR: ParticleVector3 = Object.freeze([1, 1, 1]);
const WHITE_COLOR = Object.freeze([1, 1, 1, 1] as const);
const UNIT_RANGE = Object.freeze([0, 1] as const);

interface MutableParticleRandomKey {
    systemSeed: number;
    emitterId: number;
    particleId: number;
    generation: number;
    lane: number;
}

export interface ParticleEmitterFrameContext {
    readonly position: ParticleVector3;
}

export interface ParticleManualEmitCommand {
    readonly count: number;
    readonly position?: ParticleVector3;
    readonly velocity?: ParticleVector3;
}

function isRange<T>(value: T | ParticleRange<T>): value is ParticleRange<T> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && 'min' in value;
}

/** @internal Shared deterministic initializer used by CPU and GPU spawn-command generation. */
export function sampleParticleScalar(
    value: ParticleScalarValue | undefined,
    fallback: number,
    key: ParticleRandomKey
): number {
    if (value === undefined) return Math.fround(fallback);
    if (typeof value === 'number') return Math.fround(value);
    return Math.fround(value.min + (value.max - value.min) * particleRandomFloat(key));
}

/** @internal Shared deterministic initializer used by CPU and GPU spawn-command generation. */
export function sampleParticleVector(
    value: ParticleVector3Value | undefined,
    fallback: ParticleVector3,
    key: ParticleRandomKey,
    target: Float32Array
): void {
    const source = value ?? fallback;
    if (!isRange(source)) {
        target[0] = source[0];
        target[1] = source[1];
        target[2] = source[2];
        return;
    }
    for (let component = 0; component < 3; component += 1) {
        const amount = particleRandomFloatLane(key, key.lane + component);
        target[component] = Math.fround(
            (source.min[component] ?? 0) +
                ((source.max[component] ?? 0) - (source.min[component] ?? 0)) * amount
        );
    }
}

/** @internal Shared deterministic initializer used by CPU and GPU spawn-command generation. */
export function sampleParticleColor(
    value: ParticleColorValue | undefined,
    key: ParticleRandomKey,
    target: Float32Array
): void {
    const source = value ?? WHITE_COLOR;
    if (!isRange(source)) {
        target.set(source);
        return;
    }
    for (let component = 0; component < 4; component += 1) {
        const amount = particleRandomFloatLane(key, key.lane + component);
        target[component] = Math.fround(
            (source.min[component] ?? 0) +
                ((source.max[component] ?? 0) - (source.min[component] ?? 0)) * amount
        );
    }
}

function length3(x: number, y: number, z: number): number {
    return Math.hypot(x, y, z);
}

/** @internal Normalize one three-component particle value in place. */
export function normalizeParticleVector(values: Float32Array): void {
    const length = length3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
    if (length <= 1e-8) {
        values[0] = 0;
        values[1] = 1;
        values[2] = 0;
        return;
    }
    values[0] = Math.fround((values[0] ?? 0) / length);
    values[1] = Math.fround((values[1] ?? 0) / length);
    values[2] = Math.fround((values[2] ?? 0) / length);
}

/** @internal Shared analytic shape sampler used by CPU and GPU spawn-command generation. */
export function sampleParticleShape(
    shape: ParticleShapeDefinition,
    key: ParticleRandomKey,
    position: Float32Array,
    direction: Float32Array
): void {
    const arc = shape.arc ?? Math.PI * 2;
    const thickness = shape.thickness ?? (shape.distribution === 'surface' ? 1 : 0);
    switch (shape.type) {
        case 'point':
            position.fill(0);
            direction[0] = 0;
            direction[1] = 1;
            direction[2] = 0;
            return;
        case 'line':
        case 'edge': {
            const amount = particleRandomFloatLane(key, 20);
            for (let component = 0; component < 3; component += 1) {
                position[component] = Math.fround(
                    (shape.start[component] ?? 0) +
                        ((shape.end[component] ?? 0) - (shape.start[component] ?? 0)) * amount
                );
            }
            direction[0] = shape.end[0] - shape.start[0];
            direction[1] = shape.end[1] - shape.start[1];
            direction[2] = shape.end[2] - shape.start[2];
            normalizeParticleVector(direction);
            return;
        }
        case 'box': {
            for (let component = 0; component < 3; component += 1) {
                position[component] = Math.fround(
                    (particleRandomFloatLane(key, 20 + component) - 0.5) *
                        (shape.size[component] ?? 0)
                );
            }
            direction.set(position);
            normalizeParticleVector(direction);
            return;
        }
        case 'circle':
        case 'disc': {
            const angle = particleRandomFloatLane(key, 20) * arc;
            const radial =
                thickness + (1 - thickness) * Math.sqrt(particleRandomFloatLane(key, 21));
            position[0] = Math.fround(Math.cos(angle) * shape.radius * radial);
            position[1] = Math.fround(Math.sin(angle) * shape.radius * radial);
            position[2] = 0;
            direction[0] = position[0];
            direction[1] = position[1];
            direction[2] = 0;
            normalizeParticleVector(direction);
            return;
        }
        case 'sphere':
        case 'hemisphere': {
            const azimuth = particleRandomFloatLane(key, 20) * arc;
            const vertical =
                shape.type === 'hemisphere'
                    ? particleRandomFloatLane(key, 21)
                    : particleRandomFloatLane(key, 21) * 2 - 1;
            const radialPlane = Math.sqrt(Math.max(0, 1 - vertical * vertical));
            direction[0] = Math.fround(Math.cos(azimuth) * radialPlane);
            direction[1] = Math.fround(vertical);
            direction[2] = Math.fround(Math.sin(azimuth) * radialPlane);
            const radiusFactor =
                thickness + (1 - thickness) * Math.cbrt(particleRandomFloatLane(key, 22));
            position[0] = Math.fround(direction[0] * shape.radius * radiusFactor);
            position[1] = Math.fround(direction[1] * shape.radius * radiusFactor);
            position[2] = Math.fround(direction[2] * shape.radius * radiusFactor);
            return;
        }
        case 'cone': {
            const azimuth = particleRandomFloatLane(key, 20) * arc;
            const height = (shape.length ?? 1) * particleRandomFloatLane(key, 21);
            const coneRadius = shape.radius + Math.tan((shape.angle * Math.PI) / 180) * height;
            const radial =
                thickness + (1 - thickness) * Math.sqrt(particleRandomFloatLane(key, 22));
            position[0] = Math.fround(Math.cos(azimuth) * coneRadius * radial);
            position[1] = Math.fround(height);
            position[2] = Math.fround(Math.sin(azimuth) * coneRadius * radial);
            direction[0] = Math.cos(azimuth) * Math.sin((shape.angle * Math.PI) / 180);
            direction[1] = Math.cos((shape.angle * Math.PI) / 180);
            direction[2] = Math.sin(azimuth) * Math.sin((shape.angle * Math.PI) / 180);
            normalizeParticleVector(direction);
            return;
        }
        case 'torus':
        case 'donut': {
            const major = particleRandomFloatLane(key, 20) * arc;
            const minor = particleRandomFloatLane(key, 21) * Math.PI * 2;
            const tube =
                shape.tubeRadius *
                (thickness + (1 - thickness) * Math.sqrt(particleRandomFloatLane(key, 22)));
            const radial = shape.radius + Math.cos(minor) * tube;
            position[0] = Math.fround(Math.cos(major) * radial);
            position[1] = Math.fround(Math.sin(minor) * tube);
            position[2] = Math.fround(Math.sin(major) * radial);
            direction[0] = Math.cos(major) * Math.cos(minor);
            direction[1] = Math.sin(minor);
            direction[2] = Math.sin(major) * Math.cos(minor);
        }
    }
}

function sampleLUT(values: Float32Array, time: number): number {
    const position = Math.min(1, Math.max(0, time)) * (values.length - 1);
    const left = Math.floor(position);
    const right = Math.min(values.length - 1, left + 1);
    const amount = position - left;
    return Math.fround((values[left] ?? 0) + ((values[right] ?? 0) - (values[left] ?? 0)) * amount);
}

/** Portable fixed-step particle simulator with no per-particle object allocation. */
export class ParticleCPUSimulator {
    readonly definition: ParticleEmitterDefinition;
    readonly plan: Readonly<ParticleCompiledEmitterPlan>;
    readonly state: ParticleCPUState;
    readonly #seed: number;
    readonly #curveLUTs = new Map<ParticleCurve, Float32Array>();
    readonly #gradientLUTs = new Map<ParticleGradient, Float32Array>();
    readonly #temporaryA = new Float32Array(4);
    readonly #temporaryB = new Float32Array(4);
    readonly #temporaryC = new Float32Array(4);
    readonly #randomKey: MutableParticleRandomKey;
    readonly #pendingCommands: ParticleManualEmitCommand[] = [];
    #emitterAge = 0;
    #accumulator = 0;
    #rateAccumulator = 0;
    #spawnSequence = 0;
    #generation = 0;
    readonly #lastPosition = new Float32Array(3);
    readonly #emitterVelocity = new Float32Array(3);
    #hasLastPosition = false;

    constructor(plan: Readonly<ParticleCompiledEmitterPlan>, seed: number) {
        if (plan.kind === 'gpu-stateful') {
            throw new TypeError('ParticleCPUSimulator cannot consume a GPU-owned compiled plan');
        }
        this.plan = plan;
        this.definition = plan.definition;
        this.state = new ParticleCPUState(plan);
        this.#seed = seed >>> 0;
        this.#randomKey = {
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

    get accumulator(): number {
        return this.#accumulator;
    }

    emit(command: number | Readonly<ParticleManualEmitCommand>): void {
        const normalized = typeof command === 'number' ? { count: command } : command;
        if (!Number.isSafeInteger(normalized.count) || normalized.count < 0) {
            throw new RangeError('Particle manual emit count must be a non-negative integer');
        }
        if (normalized.count === 0) return;
        this.#pendingCommands.push(Object.freeze({ ...normalized }));
    }

    clear(): void {
        this.state.clear();
        this.#pendingCommands.length = 0;
        this.#rateAccumulator = 0;
    }

    restart(): void {
        this.clear();
        this.#emitterAge = 0;
        this.#accumulator = 0;
        this.#spawnSequence = 0;
        this.#generation = 0;
        this.#hasLastPosition = false;
    }

    /** Advance seconds through a bounded fixed-step accumulator. */
    simulate(
        deltaTime: number,
        context: Readonly<ParticleEmitterFrameContext>,
        fixedStep = this.definition.fixedStep
    ): number {
        if (!Number.isFinite(deltaTime) || deltaTime < 0) {
            throw new RangeError('Particle simulation deltaTime must be finite and non-negative');
        }
        if (!Number.isFinite(fixedStep) || fixedStep <= 0) {
            throw new RangeError('Particle simulation fixedStep must be positive');
        }
        if (this.#hasLastPosition && deltaTime > 0) {
            this.#emitterVelocity[0] = Math.fround(
                (context.position[0] - (this.#lastPosition[0] ?? 0)) / deltaTime
            );
            this.#emitterVelocity[1] = Math.fround(
                (context.position[1] - (this.#lastPosition[1] ?? 0)) / deltaTime
            );
            this.#emitterVelocity[2] = Math.fround(
                (context.position[2] - (this.#lastPosition[2] ?? 0)) / deltaTime
            );
        }
        this.#lastPosition.set(context.position);
        this.#hasLastPosition = true;
        this.#accumulator = Math.min(
            this.#accumulator + deltaTime,
            fixedStep * this.definition.maxCatchUpSteps
        );
        let steps = 0;
        while (this.#accumulator + 1e-9 >= fixedStep && steps < this.definition.maxCatchUpSteps) {
            this.step(Math.fround(fixedStep), context);
            this.#accumulator -= fixedStep;
            steps++;
        }
        return steps;
    }

    private step(deltaTime: number, context: Readonly<ParticleEmitterFrameContext>): void {
        const previousAge = this.#emitterAge;
        this.#emitterAge = Math.fround(this.#emitterAge + deltaTime);
        const previousActive = Math.max(0, previousAge - this.definition.startDelay);
        const active = Math.max(0, this.#emitterAge - this.definition.startDelay);
        if (active > previousActive) this.emitScheduled(previousActive, active, deltaTime, context);
        this.emitManual(context);
        this.updateParticles(deltaTime);
        this.state.markChanged();
    }

    private emitScheduled(
        previousActive: number,
        active: number,
        deltaTime: number,
        context: Readonly<ParticleEmitterFrameContext>
    ): void {
        if (!this.definition.looping && previousActive >= this.definition.duration) return;
        const effectiveDelta = !this.definition.looping
            ? Math.max(0, Math.min(active, this.definition.duration) - previousActive)
            : deltaTime;
        const rate = sampleParticleScalar(
            this.definition.emission.rateOverTime,
            0,
            this.key(this.#spawnSequence, 0)
        );
        this.#rateAccumulator += Math.max(0, rate) * effectiveDelta;
        if (this.definition.emission.rateOverDistance !== undefined) {
            const distance = length3(
                (this.#emitterVelocity[0] ?? 0) * effectiveDelta,
                (this.#emitterVelocity[1] ?? 0) * effectiveDelta,
                (this.#emitterVelocity[2] ?? 0) * effectiveDelta
            );
            const distanceRate = sampleParticleScalar(
                this.definition.emission.rateOverDistance,
                0,
                this.key(this.#spawnSequence, 1)
            );
            this.#rateAccumulator += Math.max(0, distanceRate) * distance;
        }
        const continuousCount = Math.floor(this.#rateAccumulator);
        this.#rateAccumulator -= continuousCount;
        this.spawnMany(continuousCount, context);

        const startLoop = Math.floor(previousActive / this.definition.duration);
        const endLoop = Math.floor(active / this.definition.duration);
        for (let loop = startLoop; loop <= endLoop; loop += 1) {
            if (!this.definition.looping && loop > 0) break;
            const base = loop * this.definition.duration;
            for (const burst of this.definition.emission.bursts ?? []) {
                const cycles = burst.cycles ?? 1;
                const interval = burst.interval ?? 0;
                for (let cycle = 0; cycle < cycles; cycle += 1) {
                    const eventTime = base + burst.time + interval * cycle;
                    const crossed =
                        eventTime <= active &&
                        (eventTime > previousActive || (previousActive === 0 && eventTime === 0));
                    if (crossed) {
                        this.spawnMany(burst.count, context);
                    }
                }
            }
        }
    }

    private emitManual(context: Readonly<ParticleEmitterFrameContext>): void {
        for (const command of this.#pendingCommands)
            this.spawnMany(command.count, context, command);
        this.#pendingCommands.length = 0;
    }

    private spawnMany(
        count: number,
        context: Readonly<ParticleEmitterFrameContext>,
        command?: Readonly<ParticleManualEmitCommand>
    ): void {
        for (let index = 0; index < count; index += 1) this.spawnOne(context, command);
    }

    private spawnOne(
        context: Readonly<ParticleEmitterFrameContext>,
        command?: Readonly<ParticleManualEmitCommand>
    ): void {
        let index = this.state.aliveCount;
        if (index >= this.state.capacity) {
            if (this.definition.overflow === 'drop-new') return;
            index = this.oldestParticleIndex();
            this.#generation = (this.#generation + 1) >>> 0;
        } else {
            this.state.aliveCount++;
        }
        const particleId = this.#spawnSequence++ >>> 0;
        const key = this.key(particleId, 0);
        const positions = this.state.f32('position');
        const previousPositions = this.state.f32('previous-position');
        const velocities = this.state.f32('velocity');
        const ages = this.state.f32('age');
        const lifetimes = this.state.f32('lifetime');
        const normalizedAges = this.state.f32('normalized-age');
        const position = this.#temporaryA;
        const direction = this.#temporaryB;
        sampleParticleShape(this.definition.shape, key, position, direction);
        sampleParticleVector(
            this.definition.initialize.position,
            ZERO_VECTOR,
            this.key(particleId, 30),
            this.#temporaryC
        );
        position[0] = (position.at(0) ?? 0) + (this.#temporaryC.at(0) ?? 0);
        position[1] = (position.at(1) ?? 0) + (this.#temporaryC.at(1) ?? 0);
        position[2] = (position.at(2) ?? 0) + (this.#temporaryC.at(2) ?? 0);
        if (command?.position !== undefined) position.set(command.position);
        if (this.definition.simulationSpace === 'world') {
            position[0] = (position.at(0) ?? 0) + context.position[0];
            position[1] = (position.at(1) ?? 0) + context.position[1];
            position[2] = (position.at(2) ?? 0) + context.position[2];
        }
        if (this.definition.initialize.direction !== undefined) {
            sampleParticleVector(
                this.definition.initialize.direction,
                UP_VECTOR,
                this.key(particleId, 40),
                direction
            );
            normalizeParticleVector(direction);
        }
        const speed = sampleParticleScalar(
            this.definition.initialize.speed,
            0,
            this.key(particleId, 50)
        );
        const positionOffset = index * 3;
        positions[positionOffset] = position[0];
        positions[positionOffset + 1] = position[1];
        positions[positionOffset + 2] = position[2];
        previousPositions[positionOffset] = position[0];
        previousPositions[positionOffset + 1] = position[1];
        previousPositions[positionOffset + 2] = position[2];
        velocities[positionOffset] = Math.fround((direction.at(0) ?? 0) * speed);
        velocities[positionOffset + 1] = Math.fround((direction.at(1) ?? 0) * speed);
        velocities[positionOffset + 2] = Math.fround((direction.at(2) ?? 0) * speed);
        if (command?.velocity !== undefined) velocities.set(command.velocity, positionOffset);
        ages[index] = 0;
        lifetimes[index] = Math.max(
            1e-6,
            sampleParticleScalar(this.definition.initialize.lifetime, 1, this.key(particleId, 60))
        );
        normalizedAges[index] = 0;
        this.state.u32('stable-id')[index] = particleId;
        this.state.u32('generation')[index] = this.#generation;
        this.state.u32('alive')[index] = 1;
        if (this.state.has('spawn-position')) {
            const spawnPositions = this.state.f32('spawn-position');
            spawnPositions[positionOffset] = position[0];
            spawnPositions[positionOffset + 1] = position[1];
            spawnPositions[positionOffset + 2] = position[2];
        }
        if (this.state.has('noise-offset'))
            this.state.f32('noise-offset').fill(0, positionOffset, positionOffset + 3);
        this.initializeRenderableAttributes(index, key);
        this.initializeModuleAttributes(index, key);
    }

    private initializeRenderableAttributes(index: number, key: ParticleRandomKey): void {
        if (this.state.has('size')) {
            const size = sampleParticleScalar(
                this.definition.initialize.size,
                1,
                this.key(key.particleId, 70)
            );
            this.state.f32('size')[index] = size;
            if (this.state.has('base-size')) this.state.f32('base-size')[index] = size;
        }
        if (this.state.has('rotation')) {
            const rotation = sampleParticleScalar(
                this.definition.initialize.rotation,
                0,
                this.key(key.particleId, 71)
            );
            this.state.f32('rotation')[index] = rotation;
            if (this.state.has('base-rotation')) this.state.f32('base-rotation')[index] = rotation;
        }
        if (this.state.has('color')) {
            sampleParticleColor(
                this.definition.initialize.color,
                this.key(key.particleId, 72),
                this.#temporaryA
            );
            this.state.f32('color').set(this.#temporaryA, index * 4);
            if (this.state.has('base-color'))
                this.state.f32('base-color').set(this.#temporaryA, index * 4);
        }
        if (this.state.has('sprite-frame')) this.state.f32('sprite-frame')[index] = 0;
        if (this.state.has('mass')) {
            this.state.f32('mass')[index] = Math.max(
                1e-6,
                sampleParticleScalar(
                    this.definition.initialize.mass,
                    1,
                    this.key(key.particleId, 73)
                )
            );
        }
    }

    private initializeModuleAttributes(index: number, key: ParticleRandomKey): void {
        const velocityOffset = index * 3;
        const velocity = this.state.f32('velocity');
        for (const module of this.definition.modules) {
            switch (module.type) {
                case 'inherit-emitter-velocity': {
                    const multiplier = module.multiplier ?? 1;
                    velocity[velocityOffset] =
                        (velocity[velocityOffset] ?? 0) +
                        (this.#emitterVelocity[0] ?? 0) * multiplier;
                    velocity[velocityOffset + 1] =
                        (velocity[velocityOffset + 1] ?? 0) +
                        (this.#emitterVelocity[1] ?? 0) * multiplier;
                    velocity[velocityOffset + 2] =
                        (velocity[velocityOffset + 2] ?? 0) +
                        (this.#emitterVelocity[2] ?? 0) * multiplier;
                    break;
                }
                case 'lifetime-by-emitter-speed': {
                    const speed = length3(
                        this.#emitterVelocity[0] ?? 0,
                        this.#emitterVelocity[1] ?? 0,
                        this.#emitterVelocity[2] ?? 0
                    );
                    const amount = Math.min(
                        1,
                        Math.max(
                            0,
                            (speed - module.speedRange[0]) /
                                Math.max(1e-6, module.speedRange[1] - module.speedRange[0])
                        )
                    );
                    this.state.f32('lifetime')[index] = Math.fround(
                        module.lifetimeRange[0] +
                            (module.lifetimeRange[1] - module.lifetimeRange[0]) * amount
                    );
                    break;
                }
                case 'custom-channel': {
                    const values = this.state.f32(`custom:${module.name}`);
                    const source = typeof module.value === 'number' ? [module.value] : module.value;
                    const components = source.length;
                    for (let component = 0; component < components; component += 1) {
                        values[index * components + component] = source[component] ?? 0;
                    }
                    break;
                }
                default:
                    void key;
                    break;
            }
        }
    }

    private updateParticles(deltaTime: number): void {
        const positions = this.state.f32('position');
        const previousPositions = this.state.f32('previous-position');
        const ages = this.state.f32('age');
        const lifetimes = this.state.f32('lifetime');
        const normalized = this.state.f32('normalized-age');
        let index = 0;
        while (index < this.state.aliveCount) {
            const offset = index * 3;
            previousPositions[offset] = positions[offset] ?? 0;
            previousPositions[offset + 1] = positions[offset + 1] ?? 0;
            previousPositions[offset + 2] = positions[offset + 2] ?? 0;
            ages[index] = Math.fround((ages[index] ?? 0) + deltaTime);
            const normalizedAge = Math.min(
                1,
                (ages[index] ?? 0) / Math.max(1e-6, lifetimes[index] ?? 1)
            );
            normalized[index] = Math.fround(normalizedAge);
            this.updateMotion(index, deltaTime);
            this.updateVisualAttributes(index, normalizedAge);
            if ((ages[index] ?? 0) >= (lifetimes[index] ?? 0) || this.shouldKill(index)) {
                this.state.removeParticle(index);
                continue;
            }
            index++;
        }
    }

    private updateMotion(index: number, deltaTime: number): void {
        const positions = this.state.f32('position');
        const velocities = this.state.f32('velocity');
        const offset = index * 3;
        let vx = velocities[offset] ?? 0;
        let vy = velocities[offset + 1] ?? 0;
        let vz = velocities[offset + 2] ?? 0;
        let extraX = 0;
        let extraY = 0;
        let extraZ = 0;
        for (const module of this.definition.modules) {
            switch (module.type) {
                case 'velocity-over-lifetime':
                    sampleParticleVector(
                        module.velocity,
                        ZERO_VECTOR,
                        this.key(this.state.u32('stable-id')[index] ?? 0, 100),
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
                        this.key(this.state.u32('stable-id')[index] ?? 0, 110),
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
                        sampleParticleScalar(
                            module.limit,
                            0,
                            this.key(this.state.u32('stable-id')[index] ?? 0, 120)
                        )
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
                case 'noise':
                    this.applyNoise(module, index, deltaTime, offset, positions);
                    vx += this.#temporaryC[0] ?? 0;
                    vy += this.#temporaryC[1] ?? 0;
                    vz += this.#temporaryC[2] ?? 0;
                    break;
                case 'radial-force':
                case 'point-attraction':
                case 'line-attraction':
                case 'orbital-force':
                case 'vortex-force':
                case 'rotate-around-point':
                case 'conform-sphere': {
                    this.advancedForce(module, index, this.#temporaryA);
                    vx += (this.#temporaryA[0] ?? 0) * deltaTime;
                    vy += (this.#temporaryA[1] ?? 0) * deltaTime;
                    vz += (this.#temporaryA[2] ?? 0) * deltaTime;
                    break;
                }
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

    private applyNoise(
        module: Extract<ParticleModule, { type: 'noise' }>,
        index: number,
        deltaTime: number,
        offset: number,
        positions: Float32Array
    ): void {
        const samplePosition =
            module.mode === 'position-offset' && this.state.has('spawn-position')
                ? this.state.f32('spawn-position')
                : positions;
        const age = this.state.f32('age')[index] ?? 0;
        const scroll = module.scrollVelocity ?? ZERO_VECTOR;
        const frequency = module.frequency;
        const x = ((samplePosition[offset] ?? 0) + scroll[0] * age) * frequency;
        const y = ((samplePosition[offset + 1] ?? 0) + scroll[1] * age) * frequency;
        const z = ((samplePosition[offset + 2] ?? 0) + scroll[2] * age) * frequency;
        const seed = (this.#seed + (module.seedOffset ?? 0)) >>> 0;
        const noise = this.#temporaryA;
        if (module.field === 'curl') {
            particleCurlNoise(
                x,
                y,
                z,
                seed,
                module.octaves,
                module.lacunarity ?? 2,
                module.persistence ?? 0.5,
                noise
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
                noise
            );
        }
        sampleParticleVector(
            module.strength,
            ONE_VECTOR,
            this.key(this.state.u32('stable-id')[index] ?? 0, 130),
            this.#temporaryB
        );
        this.#temporaryC[0] = (noise.at(0) ?? 0) * (this.#temporaryB.at(0) ?? 0);
        this.#temporaryC[1] = (noise.at(1) ?? 0) * (this.#temporaryB.at(1) ?? 0);
        this.#temporaryC[2] = (noise.at(2) ?? 0) * (this.#temporaryB.at(2) ?? 0);
        if (module.mode === 'position-offset') {
            const offsets = this.state.f32('noise-offset');
            offsets[offset] = this.#temporaryC[0];
            offsets[offset + 1] = this.#temporaryC[1];
            offsets[offset + 2] = this.#temporaryC[2];
            this.#temporaryC.fill(0, 0, 3);
        } else {
            const damping = Math.max(0, 1 - (module.damping ?? 0) * deltaTime);
            this.#temporaryC[0] *= deltaTime * damping;
            this.#temporaryC[1] *= deltaTime * damping;
            this.#temporaryC[2] *= deltaTime * damping;
        }
    }

    private advancedForce(
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
        target: Float32Array
    ): void {
        const position = this.state.f32('position');
        const offset = index * 3;
        const center =
            'center' in module
                ? (module.center ?? ZERO_VECTOR)
                : 'point' in module
                  ? (module.point ?? ZERO_VECTOR)
                  : ZERO_VECTOR;
        let dx = center[0] - (position[offset] ?? 0);
        let dy = center[1] - (position[offset + 1] ?? 0);
        let dz = center[2] - (position[offset + 2] ?? 0);
        if (module.type === 'line-attraction') {
            const start = module.lineStart ?? ZERO_VECTOR;
            const end = module.lineEnd ?? UP_VECTOR;
            const lx = end[0] - start[0];
            const ly = end[1] - start[1];
            const lz = end[2] - start[2];
            const lengthSquared = lx * lx + ly * ly + lz * lz;
            const amount =
                lengthSquared <= 1e-8
                    ? 0
                    : Math.min(
                          1,
                          Math.max(
                              0,
                              (((position[offset] ?? 0) - start[0]) * lx +
                                  ((position[offset + 1] ?? 0) - start[1]) * ly +
                                  ((position[offset + 2] ?? 0) - start[2]) * lz) /
                                  lengthSquared
                          )
                      );
            dx = start[0] + lx * amount - (position[offset] ?? 0);
            dy = start[1] + ly * amount - (position[offset + 1] ?? 0);
            dz = start[2] + lz * amount - (position[offset + 2] ?? 0);
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
            const speed = sampleParticleScalar(
                module.angularSpeed,
                0,
                this.key(this.state.u32('stable-id')[index] ?? 0, 140)
            );
            target[0] = (axis[1] * dz - axis[2] * dy) * speed;
            target[1] = (axis[2] * dx - axis[0] * dz) * speed;
            target[2] = (axis[0] * dy - axis[1] * dx) * speed;
            return;
        }
        const strength =
            'strength' in module
                ? sampleParticleScalar(
                      module.strength,
                      0,
                      this.key(this.state.u32('stable-id')[index] ?? 0, 141)
                  )
                : 0;
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
        for (const module of this.definition.modules) {
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

    private shouldKill(index: number): boolean {
        const positions = this.state.f32('position');
        const velocities = this.state.f32('velocity');
        const offset = index * 3;
        const px = positions[offset] ?? 0;
        const py = positions[offset + 1] ?? 0;
        const pz = positions[offset + 2] ?? 0;
        for (const module of this.definition.modules) {
            switch (module.type) {
                case 'kill-speed': {
                    const speed = length3(
                        velocities[offset] ?? 0,
                        velocities[offset + 1] ?? 0,
                        velocities[offset + 2] ?? 0
                    );
                    if (speed < module.range[0] || speed > module.range[1]) return true;
                    break;
                }
                case 'kill-distance': {
                    const distance = length3(px, py, pz);
                    if (distance < module.range[0] || distance > module.range[1]) return true;
                    break;
                }
                case 'kill-plane': {
                    const normal = module.normal ?? UP_VECTOR;
                    const inside =
                        px * normal[0] + py * normal[1] + pz * normal[2] < (module.offset ?? 0);
                    if ((module.mode ?? 'inside') === 'inside' ? inside : !inside) return true;
                    break;
                }
                case 'kill-sphere': {
                    const center = module.center ?? ZERO_VECTOR;
                    const inside =
                        length3(px - center[0], py - center[1], pz - center[2]) <=
                        (module.radius ?? 0);
                    if ((module.mode ?? 'inside') === 'inside' ? inside : !inside) return true;
                    break;
                }
                case 'kill-box': {
                    const center = module.center ?? ZERO_VECTOR;
                    const size = module.size ?? ZERO_VECTOR;
                    const inside =
                        Math.abs(px - center[0]) <= size[0] * 0.5 &&
                        Math.abs(py - center[1]) <= size[1] * 0.5 &&
                        Math.abs(pz - center[2]) <= size[2] * 0.5;
                    if ((module.mode ?? 'inside') === 'inside' ? inside : !inside) return true;
                    break;
                }
                default:
                    break;
            }
        }
        return false;
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
        this.#randomKey.particleId = particleId;
        this.#randomKey.generation = this.#generation;
        this.#randomKey.lane = lane;
        return this.#randomKey;
    }
}
