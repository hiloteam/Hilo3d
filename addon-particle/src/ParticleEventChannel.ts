import type ParticleSystem from './ParticleSystem.js';
import type {
    ParticleEventOverflowPolicy,
    ParticleVector2,
    ParticleVector3,
    ParticleVector4
} from './ParticleTypes.js';

/** Fixed field types accepted by a typed particle event channel. */
export type ParticleEventFieldType =
    'float' | 'uint' | 'boolean' | 'vec2' | 'vec3' | 'vec4' | 'color';

/** Runtime values accepted by typed event fields. */
export type ParticleEventFieldValue =
    number | boolean | ParticleVector2 | ParticleVector3 | ParticleVector4;

/** Stable field schema participating in an event channel's public contract. */
export type ParticleEventChannelSchema = Readonly<Record<string, ParticleEventFieldType>>;

/** Small typed payload submitted by applications or aggregate event routing. */
export type ParticleEventChannelPayload = Readonly<Record<string, ParticleEventFieldValue>>;

/** Construction parameters for a bounded typed data channel. */
export interface ParticleEventChannelParameters<Payload extends ParticleEventChannelPayload> {
    readonly schema: Readonly<{ [Name in keyof Payload]: ParticleEventFieldType }>;
    readonly capacity: number;
    readonly overflow?: ParticleEventOverflowPolicy;
    readonly name?: string;
}

function vectorLength(type: ParticleEventFieldType): number | null {
    switch (type) {
        case 'vec2':
            return 2;
        case 'vec3':
            return 3;
        case 'vec4':
        case 'color':
            return 4;
        default:
            return null;
    }
}

function validateField(
    type: ParticleEventFieldType,
    value: ParticleEventFieldValue,
    path: string
): void {
    const length = vectorLength(type);
    if (length !== null) {
        if (
            !Array.isArray(value) ||
            value.length !== length ||
            value.some(component => typeof component !== 'number' || !Number.isFinite(component))
        ) {
            throw new TypeError(`${path} must contain ${String(length)} finite components`);
        }
        return;
    }
    if (type === 'boolean') {
        if (typeof value !== 'boolean') throw new TypeError(`${path} must be boolean`);
        return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${path} must be finite`);
    }
    if (type === 'uint' && (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)) {
        throw new RangeError(`${path} must be an unsigned 32-bit integer`);
    }
}

function snapshotField(
    type: ParticleEventFieldType,
    value: ParticleEventFieldValue
): ParticleEventFieldValue {
    if (!Array.isArray(value)) return value;
    const components = value as readonly number[];
    if (type === 'vec2') {
        const vector: ParticleVector2 = Object.freeze([components[0] ?? 0, components[1] ?? 0]);
        return vector;
    }
    if (type === 'vec3') {
        const vector: ParticleVector3 = Object.freeze([
            components[0] ?? 0,
            components[1] ?? 0,
            components[2] ?? 0
        ]);
        return vector;
    }
    const vector: ParticleVector4 = Object.freeze([
        components[0] ?? 0,
        components[1] ?? 0,
        components[2] ?? 0,
        components[3] ?? 0
    ]);
    return vector;
}

function snapshotPayload<Payload extends ParticleEventChannelPayload>(
    schema: ParticleEventChannelSchema,
    payload: Readonly<Payload>,
    channelName: string
): Readonly<Payload> {
    const snapshot: Record<string, ParticleEventFieldValue> = {};
    for (const [name, type] of Object.entries(schema)) {
        const value = payload[name];
        if (value === undefined) throw new TypeError(`${channelName}.${name} is required`);
        validateField(type, value, `${channelName}.${name}`);
        snapshot[name] = snapshotField(type, value);
    }
    for (const name of Object.keys(payload)) {
        if (schema[name] === undefined)
            throw new TypeError(`${channelName}.${name} is not declared`);
    }
    return Object.freeze(snapshot) as Readonly<Payload>;
}

/**
 * Bounded typed event/data channel for sharing impact-style bursts with a resident particle
 * system. Overflow is explicit and draining is batched.
 */
export class ParticleEventChannel<Payload extends ParticleEventChannelPayload> {
    readonly name: string;
    readonly schema: Readonly<ParticleEventChannelSchema>;
    readonly capacity: number;
    readonly overflow: ParticleEventOverflowPolicy;
    readonly #payloads: Readonly<Payload>[] = [];
    #droppedCount = 0;

    constructor(parameters: Readonly<ParticleEventChannelParameters<Payload>>) {
        if (!Number.isSafeInteger(parameters.capacity) || parameters.capacity < 1) {
            throw new RangeError('ParticleEventChannel capacity must be a positive safe integer');
        }
        this.name = parameters.name ?? 'particle-events';
        if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(this.name)) {
            throw new TypeError('ParticleEventChannel name is invalid');
        }
        if (Object.keys(parameters.schema).length === 0) {
            throw new RangeError('ParticleEventChannel schema must not be empty');
        }
        this.schema = Object.freeze({ ...parameters.schema });
        this.capacity = parameters.capacity;
        this.overflow = parameters.overflow ?? 'drop-new';
    }

    get size(): number {
        return this.#payloads.length;
    }

    get droppedCount(): number {
        return this.#droppedCount;
    }

    submit(payload: Readonly<Payload>): boolean {
        const snapshot = snapshotPayload(this.schema, payload, this.name);
        if (this.#payloads.length >= this.capacity) {
            this.#droppedCount++;
            if (this.overflow === 'drop-new') return false;
            this.#payloads.shift();
        }
        this.#payloads.push(snapshot);
        return true;
    }

    drain(maxCount = this.capacity): readonly Readonly<Payload>[] {
        if (!Number.isSafeInteger(maxCount) || maxCount < 0) {
            throw new RangeError('ParticleEventChannel drain count must be non-negative');
        }
        return Object.freeze(this.#payloads.splice(0, Math.min(maxCount, this.#payloads.length)));
    }

    /** Drain position/velocity payloads into one resident emitter without creating systems. */
    emitTo(
        system: ParticleSystem,
        options: Readonly<{
            emitter?: string;
            count?: number;
            positionField?: keyof Payload & string;
            velocityField?: keyof Payload & string;
        }> = {}
    ): number {
        const payloads = this.drain();
        for (const payload of payloads) {
            const position = options.positionField ? payload[options.positionField] : undefined;
            const velocity = options.velocityField ? payload[options.velocityField] : undefined;
            system.emit({
                ...(options.emitter === undefined ? {} : { emitter: options.emitter }),
                count: options.count ?? 1,
                ...(Array.isArray(position) && position.length === 3
                    ? { position: position as ParticleVector3 }
                    : {}),
                ...(Array.isArray(velocity) && velocity.length === 3
                    ? { velocity: velocity as ParticleVector3 }
                    : {})
            });
        }
        return payloads.length;
    }
}
