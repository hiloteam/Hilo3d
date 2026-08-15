import type { Renderer } from '../render/Renderer';
import ParticleSystem, { type ParticleSystemParameters } from './ParticleSystem';
import type ParticleSystemDefinition from './ParticleSystemDefinition';

/** Reuses stopped ParticleSystem nodes for large numbers of short-lived effects. */
export class ParticleSystemPool {
    readonly #available = new Map<ParticleSystemDefinition, ParticleSystem[]>();
    readonly #active = new Set<ParticleSystem>();
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
        const systems = this.#available.get(parameters.definition);
        const system = systems?.pop();
        if (system?.seed === (parameters.seed ?? 0)) {
            system.restart();
            this.#active.add(system);
            return system;
        }
        if (system) systems?.push(system);
        const created = new ParticleSystem(parameters);
        this.#active.add(created);
        return created;
    }

    release(system: ParticleSystem, renderer?: Renderer): void {
        if (!this.#active.delete(system)) {
            throw new RangeError('ParticleSystemPool cannot release an inactive system');
        }
        system.stop().removeFromParent();
        if (this.pooledCount >= this.#capacity) {
            if (!renderer) {
                throw new Error(
                    'A renderer is required when ParticleSystemPool releases beyond its capacity'
                );
            }
            system.destroy(renderer);
            return;
        }
        const systems = this.#available.get(system.definition) ?? [];
        systems.push(system);
        this.#available.set(system.definition, systems);
    }

    destroy(renderer: Renderer): void {
        for (const system of this.#active) system.destroy(renderer);
        for (const systems of this.#available.values()) {
            for (const system of systems) system.destroy(renderer);
        }
        this.#active.clear();
        this.#available.clear();
    }
}
