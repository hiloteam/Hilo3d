import type ParticleEmitterDefinition from '../ParticleEmitterDefinition';
import type { ParticleVector3 } from '../ParticleTypes';

/** One application-visible particle event materialized only at a batch boundary. */
export interface ParticleEventRecord {
    readonly name: string;
    readonly emitter: string;
    readonly stableId: number;
    readonly position: ParticleVector3;
    readonly velocity: ParticleVector3;
}

/** Bounded asynchronous aggregate returned to application code. */
export interface ParticleEventAggregate {
    readonly events: readonly Readonly<ParticleEventRecord>[];
    readonly counts: Readonly<Record<string, number>>;
    readonly droppedCount: number;
    readonly remainingCount: number;
}

/** Compact ring storage; no per-event object is allocated during particle simulation. */
export class ParticleCPUEventBuffer {
    readonly #definition: ParticleEmitterDefinition;
    readonly #names: string[] = [];
    readonly #nameToId = new Map<string, number>();
    readonly #nameIds: Uint16Array;
    readonly #stableIds: Uint32Array;
    readonly #positions: Float32Array;
    readonly #velocities: Float32Array;
    #start = 0;
    #count = 0;
    #droppedCount = 0;

    constructor(definition: ParticleEmitterDefinition) {
        this.#definition = definition;
        this.#nameIds = new Uint16Array(definition.eventCapacity);
        this.#stableIds = new Uint32Array(definition.eventCapacity);
        this.#positions = new Float32Array(definition.eventCapacity * 3);
        this.#velocities = new Float32Array(definition.eventCapacity * 3);
    }

    get size(): number {
        return this.#count;
    }

    get droppedCount(): number {
        return this.#droppedCount;
    }

    clear(): void {
        this.#start = 0;
        this.#count = 0;
        this.#droppedCount = 0;
    }

    push(
        name: string,
        stableId: number,
        position: Float32Array,
        velocity: Float32Array,
        vectorOffset: number
    ): boolean {
        const capacity = this.#definition.eventCapacity;
        if (capacity === 0) {
            this.#droppedCount++;
            return false;
        }
        let slot: number;
        if (this.#count === capacity) {
            this.#droppedCount++;
            if (this.#definition.eventOverflow === 'drop-new') return false;
            slot = this.#start;
            this.#start = (this.#start + 1) % capacity;
        } else {
            slot = (this.#start + this.#count) % capacity;
            this.#count++;
        }
        let nameId = this.#nameToId.get(name);
        if (nameId === undefined) {
            nameId = this.#names.length;
            if (nameId > 0xffff) throw new RangeError('Particle event name table is exhausted');
            this.#names.push(name);
            this.#nameToId.set(name, nameId);
        }
        this.#nameIds[slot] = nameId;
        this.#stableIds[slot] = stableId;
        const target = slot * 3;
        this.#positions[target] = position[vectorOffset] ?? 0;
        this.#positions[target + 1] = position[vectorOffset + 1] ?? 0;
        this.#positions[target + 2] = position[vectorOffset + 2] ?? 0;
        this.#velocities[target] = velocity[vectorOffset] ?? 0;
        this.#velocities[target + 1] = velocity[vectorOffset + 1] ?? 0;
        this.#velocities[target + 2] = velocity[vectorOffset + 2] ?? 0;
        return true;
    }

    read(maxCount: number): ParticleEventAggregate {
        if (!Number.isSafeInteger(maxCount) || maxCount < 0) {
            throw new RangeError('Particle event read count must be non-negative');
        }
        const readCount = Math.min(maxCount, this.#count);
        const events: Readonly<ParticleEventRecord>[] = [];
        const counts: Record<string, number> = {};
        for (let index = 0; index < readCount; index += 1) {
            const slot = (this.#start + index) % this.#definition.eventCapacity;
            const name = this.#names[this.#nameIds[slot] ?? 0];
            if (name === undefined) throw new Error('Particle event name is unavailable');
            const offset = slot * 3;
            const position: ParticleVector3 = Object.freeze([
                this.#positions[offset] ?? 0,
                this.#positions[offset + 1] ?? 0,
                this.#positions[offset + 2] ?? 0
            ]);
            const velocity: ParticleVector3 = Object.freeze([
                this.#velocities[offset] ?? 0,
                this.#velocities[offset + 1] ?? 0,
                this.#velocities[offset + 2] ?? 0
            ]);
            events.push(
                Object.freeze({
                    name,
                    emitter: this.#definition.name,
                    stableId: this.#stableIds[slot] ?? 0,
                    position,
                    velocity
                })
            );
            counts[name] = (counts[name] ?? 0) + 1;
        }
        this.#start =
            this.#definition.eventCapacity === 0
                ? 0
                : (this.#start + readCount) % this.#definition.eventCapacity;
        this.#count -= readCount;
        const droppedCount = this.#droppedCount;
        this.#droppedCount = 0;
        return Object.freeze({
            events: Object.freeze(events),
            counts: Object.freeze(counts),
            droppedCount,
            remainingCount: this.#count
        });
    }
}
