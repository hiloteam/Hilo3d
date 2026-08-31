import { Geometry, Texture } from 'hilo3d';
import ParticleCurve from './ParticleCurve.js';
import ParticleGradient from './ParticleGradient.js';
import { ParticleParameter } from './ParticleParameter.js';

function opaqueIdentity(value: object): string | null {
    if (value instanceof Texture) return `Texture(${value.id})`;
    if (value instanceof Geometry) return `Geometry(${value.id})`;
    return null;
}

function canonicalValue(value: unknown, seen: Set<object>): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new TypeError('Particle definitions require finite numbers');
        return `n:${Math.fround(value).toString()}`;
    }
    if (typeof value === 'string') return `s:${JSON.stringify(value)}`;
    if (typeof value === 'boolean') return value ? 'b:1' : 'b:0';
    if (typeof value !== 'object') {
        throw new TypeError(`Particle definitions cannot contain ${typeof value} values`);
    }
    if (value instanceof ParticleParameter) {
        return `Parameter(${value.name}:${value.type}:${canonicalValue(value.defaultValue, seen)})`;
    }
    const opaque = opaqueIdentity(value);
    if (opaque !== null) return opaque;
    if (seen.has(value)) throw new TypeError('Particle definitions cannot contain cycles');
    seen.add(value);
    try {
        if (value instanceof ParticleCurve) {
            return `Curve(${value.wrap},${value.interpolation},${canonicalValue(value.keys, seen)})`;
        }
        if (value instanceof ParticleGradient) {
            return `Gradient(${canonicalValue(value.keys, seen)})`;
        }
        if (ArrayBuffer.isView(value)) {
            const values =
                value instanceof DataView
                    ? Array.from(
                          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
                          Number
                      )
                    : Array.from(value as unknown as ArrayLike<number>, Number);
            return `Typed(${values.map(component => Math.fround(component)).join(',')})`;
        }
        if (Array.isArray(value)) {
            return `[${value.map(item => canonicalValue(item, seen)).join(',')}]`;
        }
        const record = value as Readonly<Record<string, unknown>>;
        return `{${Object.keys(record)
            .sort()
            .map(key => `${JSON.stringify(key)}:${canonicalValue(record[key], seen)}`)
            .join(',')}}`;
    } finally {
        seen.delete(value);
    }
}

/** Stable non-cryptographic hash used for particle plan/cache identities. */
export function hashParticleDefinition(value: unknown): string {
    const source = canonicalValue(value, new Set());
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function snapshotValue(value: unknown, seen: Set<object>): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            throw new TypeError('Particle definitions require finite numbers');
        return Math.fround(value);
    }
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value !== 'object') {
        throw new TypeError(`Particle definitions cannot contain ${typeof value} values`);
    }
    if (
        value instanceof Texture ||
        value instanceof Geometry ||
        value instanceof ParticleCurve ||
        value instanceof ParticleGradient ||
        value instanceof ParticleParameter
    ) {
        return value;
    }
    if (seen.has(value)) throw new TypeError('Particle definitions cannot contain cycles');
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return Object.freeze(value.map(item => snapshotValue(item, seen)));
        }
        const prototype = Object.getPrototypeOf(value) as object | null;
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(
                'Particle definitions accept only plain records and supported tokens'
            );
        }
        const source = value as Readonly<Record<string, unknown>>;
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(source)) result[key] = snapshotValue(source[key], seen);
        return Object.freeze(result);
    } finally {
        seen.delete(value);
    }
}

/** Deep immutable copy for serializable particle records while retaining opaque resource tokens. */
export function snapshotParticleDefinitionValue<T>(value: T): T {
    return snapshotValue(value, new Set()) as T;
}
