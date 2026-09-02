import type { Renderer } from 'hilo3d';
import ParticleSystem, { type ParticleSystemParameters } from './ParticleSystem.js';
import type ParticleSystemDefinition from './ParticleSystemDefinition.js';

/** Reuses stopped ParticleSystem resources for large numbers of short-lived effects. */
export class ParticleSystemPool {
    readonly #available = new Map<ParticleSystemDefinition, ParticlePoolEntry[]>();
    readonly #active = new Map<ParticleSystem, Readonly<ParticleSystemParameters>>();
    readonly #capacity: number;

    constructor(capacity = 64) {
        if (!Number.isSafeInteger(capacity) || capacity < 0) {
            throw new RangeError('ParticleSystemPool capacity must be a non-negative safe integer');
        }
        this.#capacity = capacity;
    }

    get activeCount(): number {
        return this.#active.size;
    }

    get pooledCount(): number {
        let count = 0;
        for (const systems of this.#available.values()) count += systems.length;
        return count;
    }

    acquire(parameters: Readonly<ParticleSystemParameters>): ParticleSystem {
        const entries = this.#available.get(parameters.definition);
        const entryIndex = entries?.findIndex(entry =>
            parametersMatch(entry.parameters, parameters)
        );
        const entry =
            entryIndex === undefined || entryIndex < 0
                ? undefined
                : entries?.splice(entryIndex, 1)[0];
        const system = entry?.system;
        if (system) {
            system.resetForPool(parameters);
            this.#active.set(system, Object.freeze({ ...parameters }));
            return system;
        }
        const created = new ParticleSystem(parameters);
        this.#active.set(created, Object.freeze({ ...parameters }));
        return created;
    }

    release(system: ParticleSystem, renderer?: Renderer): void {
        const parameters = this.#active.get(system);
        if (!parameters) {
            throw new RangeError('ParticleSystemPool cannot release an inactive system');
        }
        if (this.pooledCount >= this.#capacity) {
            if (!renderer) {
                throw new Error(
                    'A renderer is required when ParticleSystemPool releases beyond its capacity'
                );
            }
            this.#active.delete(system);
            system.stop();
            system.destroy(renderer);
            return;
        }
        this.#active.delete(system);
        system.stop();
        const entries = this.#available.get(system.definition) ?? [];
        entries.push({ system, parameters });
        this.#available.set(system.definition, entries);
    }

    destroy(renderer: Renderer): void {
        for (const system of this.#active.keys()) system.destroy(renderer);
        for (const entries of this.#available.values()) {
            for (const entry of entries) entry.system.destroy(renderer);
        }
        this.#active.clear();
        this.#available.clear();
    }
}

interface ParticlePoolEntry {
    readonly system: ParticleSystem;
    readonly parameters: Readonly<ParticleSystemParameters>;
}

function parametersMatch(
    left: Readonly<ParticleSystemParameters>,
    right: Readonly<ParticleSystemParameters>
): boolean {
    const leftKeys = Object.keys(left) as (keyof ParticleSystemParameters)[];
    const rightKeys = Object.keys(right) as (keyof ParticleSystemParameters)[];
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(key => Object.hasOwn(right, key) && Object.is(left[key], right[key]));
}
