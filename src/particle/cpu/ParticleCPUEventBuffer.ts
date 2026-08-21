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

/** @internal */
export interface ParticleCPUEventBufferSnapshot {
    readonly names: readonly string[];
    readonly nameIds: Uint16Array;
    readonly stableIds: Uint32Array;
    readonly positions: Float32Array;
    readonly velocities: Float32Array;
    readonly start: number;
    readonly count: number;
    readonly droppedCount: number;
    readonly byteLength: number;
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

    /** Copy the compact ring without materializing application event objects. @internal */
    capture(): Readonly<ParticleCPUEventBufferSnapshot> {
        const nameIds = this.#nameIds.slice();
        const stableIds = this.#stableIds.slice();
        const positions = this.#positions.slice();
        const velocities = this.#velocities.slice();
        return Object.freeze({
            names: Object.freeze([...this.#names]),
            nameIds,
            stableIds,
            positions,
            velocities,
            start: this.#start,
            count: this.#count,
            droppedCount: this.#droppedCount,
            byteLength:
                nameIds.byteLength +
                stableIds.byteLength +
                positions.byteLength +
                velocities.byteLength
        });
    }

    /** Restore one compatible compact event ring. @internal */
    restore(snapshot: Readonly<ParticleCPUEventBufferSnapshot>): void {
        if (
            snapshot.nameIds.length !== this.#nameIds.length ||
            snapshot.stableIds.length !== this.#stableIds.length ||
            snapshot.positions.length !== this.#positions.length ||
            snapshot.velocities.length !== this.#velocities.length
        ) {
            throw new TypeError('Particle event snapshot capacity is incompatible');
        }
        const capacity = this.#definition.eventCapacity;
        if (
            !Number.isSafeInteger(snapshot.start) ||
            snapshot.start < 0 ||
            snapshot.start > Math.max(0, capacity - 1) ||
            !Number.isSafeInteger(snapshot.count) ||
            snapshot.count < 0 ||
            snapshot.count > capacity ||
            !Number.isSafeInteger(snapshot.droppedCount) ||
            snapshot.droppedCount < 0
        ) {
            throw new RangeError('Particle event snapshot ring metadata is invalid');
        }
        this.#names.length = 0;
        this.#nameToId.clear();
        for (const name of snapshot.names) {
            if (this.#nameToId.has(name)) {
                throw new TypeError('Particle event snapshot name table is invalid');
            }
            this.#nameToId.set(name, this.#names.length);
            this.#names.push(name);
        }
        this.#nameIds.set(snapshot.nameIds);
        this.#stableIds.set(snapshot.stableIds);
        this.#positions.set(snapshot.positions);
        this.#velocities.set(snapshot.velocities);
        this.#start = snapshot.start;
        this.#count = snapshot.count;
        this.#droppedCount = snapshot.droppedCount;
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
