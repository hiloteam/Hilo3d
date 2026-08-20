import Texture from '../texture/Texture';
import ParticleCurve from './ParticleCurve';
import ParticleGradient from './ParticleGradient';
import type { ParticleVector2, ParticleVector3, ParticleVector4 } from './ParticleTypes';

/** Closed value-kind set accepted by typed particle parameters. */
export type ParticleParameterType =
    | 'float'
    | 'uint'
    | 'boolean'
    | 'vector2'
    | 'vector3'
    | 'vector4'
    | 'color'
    | 'texture'
    | 'curve'
    | 'gradient';

/** Runtime values accepted by a typed particle parameter. */
export type ParticleParameterValue =
    | number
    | boolean
    | ParticleVector2
    | ParticleVector3
    | ParticleVector4
    | Texture<unknown>
    | ParticleCurve
    | ParticleGradient;

function validateValue(type: ParticleParameterType, value: ParticleParameterValue): void {
    const finiteVector = (length: number): boolean =>
        Array.isArray(value) &&
        value.length === length &&
        value.every(component => typeof component === 'number' && Number.isFinite(component));
    const valid =
        (type === 'float' && typeof value === 'number' && Number.isFinite(value)) ||
        (type === 'uint' &&
            typeof value === 'number' &&
            Number.isSafeInteger(value) &&
            value >= 0) ||
        (type === 'boolean' && typeof value === 'boolean') ||
        (type === 'vector2' && finiteVector(2)) ||
        (type === 'vector3' && finiteVector(3)) ||
        (type === 'vector4' && finiteVector(4)) ||
        (type === 'color' && finiteVector(4)) ||
        (type === 'texture' && value instanceof Texture) ||
        (type === 'curve' && value instanceof ParticleCurve) ||
        (type === 'gradient' && value instanceof ParticleGradient);
    if (!valid) throw new TypeError(`Particle parameter value does not match type ${type}`);
}

function snapshotValue<T extends ParticleParameterValue>(value: T): T {
    return (Array.isArray(value) ? Object.freeze([...value]) : value) as T;
}

function parameterValuesEqual(
    left: ParticleParameterValue,
    right: ParticleParameterValue
): boolean {
    if (Object.is(left, right)) return true;
    return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((component, index) => Object.is(component, right[index]))
    );
}

/** Typed identity token for runtime parameter updates that do not change plan topology. */
export class ParticleParameter<T extends ParticleParameterValue = ParticleParameterValue> {
    readonly name: string;
    readonly type: ParticleParameterType;
    readonly defaultValue: T;

    constructor(name: string, type: ParticleParameterType, defaultValue: T) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(name)) {
            throw new TypeError('Particle parameter name is invalid');
        }
        validateValue(type, defaultValue);
        this.name = name;
        this.type = type;
        this.defaultValue = snapshotValue(defaultValue);
        Object.freeze(this);
    }
}

/** Runtime typed parameter values with a monotonic revision. */
export class ParticleParameterSet {
    readonly #values = new Map<ParticleParameter, ParticleParameterValue>();
    #revision = 0;

    get revision(): number {
        return this.#revision;
    }

    get<T extends ParticleParameterValue>(parameter: ParticleParameter<T>): T {
        return (this.#values.get(parameter) ?? parameter.defaultValue) as T;
    }

    set<T extends ParticleParameterValue>(parameter: ParticleParameter<T>, value: T): this {
        validateValue(parameter.type, value);
        if (parameterValuesEqual(this.get(parameter), value)) return this;
        this.#values.set(parameter, snapshotValue(value));
        this.#revision++;
        return this;
    }

    reset(parameter?: ParticleParameter): this {
        if (parameter === undefined) {
            if (this.#values.size === 0) return this;
            this.#values.clear();
        } else if (!this.#values.delete(parameter)) {
            return this;
        }
        this.#revision++;
        return this;
    }
}

/** Resolve a bindable value against a parameter set, falling back to the token default. @internal */
export function resolveParticleParameter<T>(
    value: T | ParticleParameter<T & ParticleParameterValue>,
    parameters?: ParticleParameterSet
): T {
    return value instanceof ParticleParameter
        ? (parameters?.get(value) ?? value.defaultValue)
        : value;
}
