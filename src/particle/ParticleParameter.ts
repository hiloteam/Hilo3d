import Color from '../math/Color';
import Vector2 from '../math/Vector2';
import Vector3 from '../math/Vector3';
import Vector4 from '../math/Vector4';
import Texture from '../texture/Texture';
import ParticleCurve from './ParticleCurve';
import ParticleGradient from './ParticleGradient';

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
    | Vector2
    | Vector3
    | Vector4
    | Color
    | Texture<unknown>
    | ParticleCurve
    | ParticleGradient;

function validateValue(type: ParticleParameterType, value: ParticleParameterValue): void {
    const valid =
        (type === 'float' && typeof value === 'number' && Number.isFinite(value)) ||
        (type === 'uint' &&
            typeof value === 'number' &&
            Number.isSafeInteger(value) &&
            value >= 0) ||
        (type === 'boolean' && typeof value === 'boolean') ||
        (type === 'vector2' && value instanceof Vector2) ||
        (type === 'vector3' && value instanceof Vector3 && !(value instanceof Color)) ||
        (type === 'vector4' && value instanceof Vector4 && !(value instanceof Color)) ||
        (type === 'color' && value instanceof Color) ||
        (type === 'texture' && value instanceof Texture) ||
        (type === 'curve' && value instanceof ParticleCurve) ||
        (type === 'gradient' && value instanceof ParticleGradient);
    if (!valid) throw new TypeError(`Particle parameter value does not match type ${type}`);
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
        this.defaultValue = defaultValue;
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
        if (Object.is(this.get(parameter), value)) return this;
        this.#values.set(parameter, value);
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
