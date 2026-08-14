import ParticleEmitterDefinition from './ParticleEmitterDefinition';
import { hashParticleDefinition } from './ParticleDefinitionHash';
import {
    PARTICLE_DEFINITION_VERSION,
    type ParticleEmitterDefinitionInput,
    type ParticleSystemDefinitionInput
} from './ParticleTypes';

function requireDefinitionRecord(value: unknown): object {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError('ParticleSystemDefinition input must be an object');
    }
    return value;
}

function describeVersion(value: unknown): string {
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
    ) {
        return String(value);
    }
    return typeof value;
}

/** Immutable, versioned particle asset compiled independently by each renderer. */
class ParticleSystemDefinition {
    readonly version = PARTICLE_DEFINITION_VERSION;
    readonly emitters: readonly ParticleEmitterDefinition[];
    readonly hash: string;

    private constructor(input: Readonly<ParticleSystemDefinitionInput>) {
        const definition = requireDefinitionRecord(input);
        const version: unknown = Reflect.get(definition, 'version');
        if (version !== undefined && version !== PARTICLE_DEFINITION_VERSION) {
            throw new RangeError(
                `Particle definition version ${describeVersion(version)} is unsupported; expected ${String(PARTICLE_DEFINITION_VERSION)}`
            );
        }
        const rawEmitters: unknown = Reflect.get(definition, 'emitters');
        if (!Array.isArray(rawEmitters) || rawEmitters.length === 0) {
            throw new RangeError('ParticleSystemDefinition requires at least one emitter');
        }
        const names = new Set<string>();
        const emitters = rawEmitters.map((candidate: unknown) => {
            if (typeof candidate !== 'object' || candidate === null) {
                throw new TypeError('ParticleSystemDefinition emitters must be objects');
            }
            const name: unknown = Reflect.get(candidate, 'name');
            if (typeof name !== 'string') {
                throw new TypeError('ParticleSystemDefinition emitter name must be a string');
            }
            if (names.has(name)) {
                throw new TypeError(`ParticleSystemDefinition has duplicate emitter ${name}`);
            }
            names.add(name);
            return new ParticleEmitterDefinition(
                candidate as Readonly<ParticleEmitterDefinitionInput>
            );
        });
        this.emitters = Object.freeze(emitters);
        this.hash = hashParticleDefinition({ version: this.version, emitters: this.emitters });
        Object.freeze(this);
    }

    /** Validate and snapshot mutable authoring input. */
    static create(input: Readonly<ParticleSystemDefinitionInput>): ParticleSystemDefinition {
        return new ParticleSystemDefinition(input);
    }

    /** Resolve one immutable emitter by stable authored name. */
    getEmitter(name: string): ParticleEmitterDefinition | null {
        return this.emitters.find(emitter => emitter.name === name) ?? null;
    }
}

export default ParticleSystemDefinition;
