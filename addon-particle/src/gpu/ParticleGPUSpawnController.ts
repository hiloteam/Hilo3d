import type ParticleEmitterDefinition from '../ParticleEmitterDefinition.js';
import { ParticleParameterSet } from '../ParticleParameter.js';
import type { ParticleRandomKey } from '../ParticleRandom.js';
import type { ParticleVector3 } from '../ParticleTypes.js';
import {
    normalizeParticleVector,
    sampleParticleColor,
    sampleParticleScalar,
    sampleParticleShape,
    sampleParticleVector,
    type ParticleEmitterFrameContext,
    type ParticleManualEmitCommand
} from '../cpu/ParticleCPUSimulator.js';

const COMMAND_FLOAT_COUNT = 16;
const ZERO_VECTOR: ParticleVector3 = Object.freeze([0, 0, 0]);
const UP_VECTOR: ParticleVector3 = Object.freeze([0, 1, 0]);

interface MutableParticleRandomKey {
    systemSeed: number;
    emitterId: number;
    particleId: number;
    generation: number;
    lane: number;
}

function length3(x: number, y: number, z: number): number {
    return Math.hypot(x, y, z);
}

/**
 * CPU-side, particle-object-free scheduler for GPU initialize commands.
 *
 * It owns only emitter clock/spawn metadata and a fixed command array. Persistent particle state
 * remains exclusively in renderer-owned GPU buffers.
 * @internal
 */
export class ParticleGPUSpawnController {
    readonly definition: ParticleEmitterDefinition;
    readonly commands: Float32Array;
    readonly emitterVelocity = new Float32Array(3);
    readonly #seed: number;
    readonly #parameters: ParticleParameterSet;
    readonly #randomKey: MutableParticleRandomKey;
    readonly #position = new Float32Array(4);
    readonly #direction = new Float32Array(4);
    readonly #temporary = new Float32Array(4);
    readonly #color = new Float32Array(4);
    readonly #lastPosition = new Float32Array(3);
    readonly #manualCommands: ParticleManualEmitCommand[] = [];
    #emitterAge = 0;
    #accumulator = 0;
    #rateAccumulator = 0;
    #spawnSequence = 0;
    #pendingSpawnStart = 0;
    #pendingSpawnCount = 0;
    #pendingDeltaSeconds = 0;
    #hasLastPosition = false;
    #particleLimit: number;
    #spawnRateScale = 1;
    #budgetDirty = false;
    #maximumObservedLifetime = 0;

    constructor(
        definition: ParticleEmitterDefinition,
        seed: number,
        emitterId: number,
        parameters = new ParticleParameterSet()
    ) {
        this.definition = definition;
        this.#seed = seed >>> 0;
        this.#parameters = parameters;
        this.commands = new Float32Array(definition.capacity * COMMAND_FLOAT_COUNT);
        this.#particleLimit = definition.capacity;
        this.#randomKey = {
            systemSeed: this.#seed,
            emitterId,
            particleId: 0,
            generation: 0,
            lane: 0
        };
    }

    get emitterAge(): number {
        return this.#emitterAge;
    }

    get pendingDeltaSeconds(): number {
        return this.#pendingDeltaSeconds;
    }

    get pendingSpawnStart(): number {
        return this.#pendingSpawnStart;
    }

    get pendingSpawnCount(): number {
        return this.#pendingSpawnCount;
    }

    get hasPendingWork(): boolean {
        return this.#pendingDeltaSeconds > 0 || this.#pendingSpawnCount > 0 || this.#budgetDirty;
    }

    get particleLimit(): number {
        return this.#particleLimit;
    }

    get maximumObservedLifetime(): number {
        return this.#maximumObservedLifetime;
    }

    /** Apply renderer-local capacity and scheduled-emission scaling. @internal */
    setBudget(particleLimit: number, spawnRateScale: number): void {
        if (!Number.isSafeInteger(particleLimit) || particleLimit < 0) {
            throw new RangeError('Particle budget limit must be a non-negative safe integer');
        }
        if (!Number.isFinite(spawnRateScale) || spawnRateScale < 0) {
            throw new RangeError(
                'Particle budget spawn-rate scale must be finite and non-negative'
            );
        }
        const nextLimit = Math.min(this.definition.capacity, particleLimit);
        if (nextLimit !== this.#particleLimit) this.#budgetDirty = true;
        this.#particleLimit = nextLimit;
        this.#spawnRateScale = spawnRateScale;
        this.#pendingSpawnCount = Math.min(this.#pendingSpawnCount, this.#particleLimit);
    }

    emit(command: number | Readonly<ParticleManualEmitCommand>): void {
        const normalized = typeof command === 'number' ? { count: command } : command;
        if (!Number.isSafeInteger(normalized.count) || normalized.count < 0) {
            throw new RangeError('Particle manual emit count must be a non-negative integer');
        }
        if (normalized.count === 0) return;
        this.#manualCommands.push(Object.freeze({ ...normalized }));
    }

    restart(): void {
        this.#emitterAge = 0;
        this.#accumulator = 0;
        this.#rateAccumulator = 0;
        this.#spawnSequence = 0;
        this.#pendingSpawnStart = 0;
        this.#pendingSpawnCount = 0;
        this.#pendingDeltaSeconds = 0;
        this.#budgetDirty = false;
        this.#maximumObservedLifetime = 0;
        this.#manualCommands.length = 0;
        this.#hasLastPosition = false;
        this.commands.fill(0);
        this.emitterVelocity.fill(0);
    }

    advance(
        deltaTime: number,
        context: Readonly<ParticleEmitterFrameContext>,
        fixedStep = this.definition.fixedStep
    ): number {
        if (!Number.isFinite(deltaTime) || deltaTime < 0) {
            throw new RangeError(
                'Particle GPU simulation deltaTime must be finite and non-negative'
            );
        }
        if (!Number.isFinite(fixedStep) || fixedStep <= 0) {
            throw new RangeError('Particle GPU simulation fixedStep must be positive');
        }
        if (this.#hasLastPosition && deltaTime > 0) {
            this.emitterVelocity[0] = Math.fround(
                (context.position[0] - (this.#lastPosition[0] ?? 0)) / deltaTime
            );
            this.emitterVelocity[1] = Math.fround(
                (context.position[1] - (this.#lastPosition[1] ?? 0)) / deltaTime
            );
            this.emitterVelocity[2] = Math.fround(
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
        const stepTolerance = fixedStep * 1e-6;
        while (
            this.#accumulator + stepTolerance >= fixedStep &&
            steps < this.definition.maxCatchUpSteps
        ) {
            this.step(Math.fround(fixedStep), context);
            this.#accumulator -= fixedStep;
            steps++;
        }
        return steps;
    }

    /** Retain queued work after rollback; successful submission consumes it exactly once. */
    commitPendingWork(): void {
        this.#pendingDeltaSeconds = 0;
        this.#pendingSpawnCount = 0;
        this.#pendingSpawnStart = this.#spawnSequence;
        this.#budgetDirty = false;
    }

    private step(deltaTime: number, context: Readonly<ParticleEmitterFrameContext>): void {
        const previousAge = this.#emitterAge;
        this.#emitterAge = Math.fround(this.#emitterAge + deltaTime);
        const previousActive = Math.max(0, previousAge - this.definition.startDelay);
        const active = Math.max(0, this.#emitterAge - this.definition.startDelay);
        if (active > previousActive) {
            this.emitScheduled(previousActive, active, deltaTime, context);
        }
        for (const command of this.#manualCommands) {
            this.spawnMany(command.count, context, command);
        }
        this.#manualCommands.length = 0;
        this.#pendingDeltaSeconds = Math.fround(this.#pendingDeltaSeconds + deltaTime);
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
            this.key(this.#spawnSequence, 0),
            this.#parameters
        );
        this.#rateAccumulator += Math.max(0, rate) * effectiveDelta * this.#spawnRateScale;
        if (this.definition.emission.rateOverDistance !== undefined) {
            const distance = length3(
                (this.emitterVelocity[0] ?? 0) * effectiveDelta,
                (this.emitterVelocity[1] ?? 0) * effectiveDelta,
                (this.emitterVelocity[2] ?? 0) * effectiveDelta
            );
            const distanceRate = sampleParticleScalar(
                this.definition.emission.rateOverDistance,
                0,
                this.key(this.#spawnSequence, 1),
                this.#parameters
            );
            this.#rateAccumulator += Math.max(0, distanceRate) * distance * this.#spawnRateScale;
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
                    if (
                        eventTime <= active &&
                        (eventTime > previousActive || (previousActive === 0 && eventTime === 0))
                    ) {
                        this.spawnMany(Math.floor(burst.count * this.#spawnRateScale), context);
                    }
                }
            }
        }
    }

    private spawnMany(
        count: number,
        context: Readonly<ParticleEmitterFrameContext>,
        command?: Readonly<ParticleManualEmitCommand>
    ): void {
        for (let index = 0; index < count; index += 1) {
            if (this.#pendingSpawnCount >= this.#particleLimit) return;
            this.writeSpawnCommand(context, command);
        }
    }

    private writeSpawnCommand(
        context: Readonly<ParticleEmitterFrameContext>,
        command?: Readonly<ParticleManualEmitCommand>
    ): void {
        const particleId = this.#spawnSequence >>> 0;
        if (this.#pendingSpawnCount === 0) this.#pendingSpawnStart = particleId;
        const key = this.key(particleId, 0);
        sampleParticleShape(this.definition.shape, key, this.#position, this.#direction);
        sampleParticleVector(
            this.definition.initialize.position,
            ZERO_VECTOR,
            this.key(particleId, 30),
            this.#temporary,
            this.#parameters
        );
        this.#position[0] = (this.#position.at(0) ?? 0) + (this.#temporary.at(0) ?? 0);
        this.#position[1] = (this.#position.at(1) ?? 0) + (this.#temporary.at(1) ?? 0);
        this.#position[2] = (this.#position.at(2) ?? 0) + (this.#temporary.at(2) ?? 0);
        if (command?.position !== undefined) this.#position.set(command.position);
        if (this.definition.simulationSpace === 'world') {
            this.#position[0] = (this.#position.at(0) ?? 0) + context.position[0];
            this.#position[1] = (this.#position.at(1) ?? 0) + context.position[1];
            this.#position[2] = (this.#position.at(2) ?? 0) + context.position[2];
        }
        if (this.definition.initialize.direction !== undefined) {
            sampleParticleVector(
                this.definition.initialize.direction,
                UP_VECTOR,
                this.key(particleId, 40),
                this.#direction,
                this.#parameters
            );
            normalizeParticleVector(this.#direction);
        }
        const speed = sampleParticleScalar(
            this.definition.initialize.speed,
            0,
            this.key(particleId, 50),
            this.#parameters
        );
        this.#temporary[0] = Math.fround((this.#direction.at(0) ?? 0) * speed);
        this.#temporary[1] = Math.fround((this.#direction.at(1) ?? 0) * speed);
        this.#temporary[2] = Math.fround((this.#direction.at(2) ?? 0) * speed);
        if (command?.velocity !== undefined) this.#temporary.set(command.velocity);
        let lifetime = Math.max(
            1e-6,
            sampleParticleScalar(
                this.definition.initialize.lifetime,
                1,
                this.key(particleId, 60),
                this.#parameters
            )
        );
        for (const module of this.definition.modules) {
            if (module.type === 'inherit-emitter-velocity') {
                const multiplier = module.multiplier ?? 1;
                this.#temporary[0] =
                    (this.#temporary.at(0) ?? 0) + (this.emitterVelocity.at(0) ?? 0) * multiplier;
                this.#temporary[1] =
                    (this.#temporary.at(1) ?? 0) + (this.emitterVelocity.at(1) ?? 0) * multiplier;
                this.#temporary[2] =
                    (this.#temporary.at(2) ?? 0) + (this.emitterVelocity.at(2) ?? 0) * multiplier;
            } else if (module.type === 'lifetime-by-emitter-speed') {
                const emitterSpeed = length3(
                    this.emitterVelocity.at(0) ?? 0,
                    this.emitterVelocity.at(1) ?? 0,
                    this.emitterVelocity.at(2) ?? 0
                );
                const amount = Math.min(
                    1,
                    Math.max(
                        0,
                        (emitterSpeed - module.speedRange[0]) /
                            Math.max(1e-6, module.speedRange[1] - module.speedRange[0])
                    )
                );
                lifetime = Math.fround(
                    module.lifetimeRange[0] +
                        (module.lifetimeRange[1] - module.lifetimeRange[0]) * amount
                );
            }
        }
        this.#maximumObservedLifetime = Math.max(this.#maximumObservedLifetime, lifetime);
        sampleParticleColor(
            this.definition.initialize.color,
            this.key(particleId, 72),
            this.#color,
            this.#parameters
        );
        const offset = this.#pendingSpawnCount * COMMAND_FLOAT_COUNT;
        this.commands[offset] = this.#position[0];
        this.commands[offset + 1] = this.#position[1];
        this.commands[offset + 2] = this.#position[2];
        this.commands[offset + 3] = lifetime;
        this.commands[offset + 4] = this.#temporary[0];
        this.commands[offset + 5] = this.#temporary[1];
        this.commands[offset + 6] = this.#temporary[2];
        this.commands[offset + 7] = sampleParticleScalar(
            this.definition.initialize.size,
            1,
            this.key(particleId, 70),
            this.#parameters
        );
        this.commands.set(this.#color, offset + 8);
        this.commands[offset + 12] = sampleParticleScalar(
            this.definition.initialize.rotation,
            0,
            this.key(particleId, 71),
            this.#parameters
        );
        this.commands[offset + 13] = Math.max(
            1e-6,
            sampleParticleScalar(
                this.definition.initialize.mass,
                1,
                this.key(particleId, 73),
                this.#parameters
            )
        );
        this.commands[offset + 14] = Math.floor(
            sampleParticleScalar(
                this.definition.initialize.meshIndex,
                particleId,
                this.key(particleId, 74),
                this.#parameters
            )
        );
        this.commands[offset + 15] = Math.floor(
            sampleParticleScalar(
                this.definition.initialize.ribbonId,
                0,
                this.key(particleId, 75),
                this.#parameters
            )
        );
        this.#pendingSpawnCount++;
        this.#spawnSequence = (this.#spawnSequence + 1) >>> 0;
    }

    private key(particleId: number, lane: number): ParticleRandomKey {
        this.#randomKey.particleId = particleId;
        this.#randomKey.generation = 0;
        this.#randomKey.lane = lane;
        return this.#randomKey;
    }
}
