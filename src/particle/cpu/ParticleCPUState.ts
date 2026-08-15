import type { Bounds } from '../../geometry/Geometry';
import type {
    ParticleAttributeLayout,
    ParticleAttributeName,
    ParticleCompiledEmitterPlan
} from '../ParticleCompiledPlan';

type ParticleAttributeArray = Float32Array | Uint32Array;

/** Dense alive SoA storage used by the portable CPU execution plan. */
export class ParticleCPUState {
    readonly capacity: number;
    readonly #layout: readonly Readonly<ParticleAttributeLayout>[];
    readonly #arrays = new Map<ParticleAttributeName, ParticleAttributeArray>();
    aliveCount = 0;
    revision = 0;

    constructor(plan: Readonly<ParticleCompiledEmitterPlan>) {
        this.capacity = plan.definition.capacity;
        this.#layout = plan.attributes;
        for (const attribute of plan.attributes) {
            const length = this.capacity * attribute.components;
            this.#arrays.set(
                attribute.name,
                attribute.storage === 'u32' ? new Uint32Array(length) : new Float32Array(length)
            );
        }
    }

    /** Return one float attribute or fail if liveness compilation omitted it. */
    f32(name: ParticleAttributeName): Float32Array {
        const value = this.#arrays.get(name);
        if (!(value instanceof Float32Array)) {
            throw new TypeError(`Particle attribute ${name} is not an allocated float attribute`);
        }
        return value;
    }

    /** Return one unsigned attribute or fail if liveness compilation omitted it. */
    u32(name: ParticleAttributeName): Uint32Array {
        const value = this.#arrays.get(name);
        if (!(value instanceof Uint32Array)) {
            throw new TypeError(`Particle attribute ${name} is not an allocated uint attribute`);
        }
        return value;
    }

    has(name: ParticleAttributeName): boolean {
        return this.#arrays.has(name);
    }

    /** Move one dense particle record without constructing a temporary particle object. */
    copyParticle(sourceIndex: number, destinationIndex: number): void {
        if (sourceIndex === destinationIndex) return;
        for (const attribute of this.#layout) {
            const values = this.#arrays.get(attribute.name);
            if (!values)
                throw new Error(`Particle attribute ${attribute.name} storage is unavailable`);
            const sourceOffset = sourceIndex * attribute.components;
            const destinationOffset = destinationIndex * attribute.components;
            for (let component = 0; component < attribute.components; component += 1) {
                values[destinationOffset + component] = values[sourceOffset + component] ?? 0;
            }
        }
    }

    /** Remove a dense slot by moving the last alive record into its place. */
    removeParticle(index: number): void {
        if (index < 0 || index >= this.aliveCount) {
            throw new RangeError('Particle dense removal index is out of range');
        }
        const last = this.aliveCount - 1;
        this.copyParticle(last, index);
        this.aliveCount = last;
        this.revision++;
    }

    clear(): void {
        if (this.aliveCount === 0) return;
        this.aliveCount = 0;
        this.revision++;
    }

    markChanged(): void {
        this.revision++;
    }

    /** Exact dynamic bounds over canonical particle positions and scalar sizes. */
    computeBounds(target?: Bounds): Bounds | null {
        if (this.aliveCount === 0) return null;
        const positions = this.f32('position');
        const sizes = this.has('size') ? this.f32('size') : null;
        let xMin = Number.POSITIVE_INFINITY;
        let yMin = Number.POSITIVE_INFINITY;
        let zMin = Number.POSITIVE_INFINITY;
        let xMax = Number.NEGATIVE_INFINITY;
        let yMax = Number.NEGATIVE_INFINITY;
        let zMax = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < this.aliveCount; index += 1) {
            const offset = index * 3;
            const radius = (sizes?.[index] ?? 0) * 0.5;
            const x = positions[offset] ?? 0;
            const y = positions[offset + 1] ?? 0;
            const z = positions[offset + 2] ?? 0;
            xMin = Math.min(xMin, x - radius);
            yMin = Math.min(yMin, y - radius);
            zMin = Math.min(zMin, z - radius);
            xMax = Math.max(xMax, x + radius);
            yMax = Math.max(yMax, y + radius);
            zMax = Math.max(zMax, z + radius);
        }
        const bounds = target ?? {
            x: 0,
            y: 0,
            z: 0,
            width: 0,
            height: 0,
            depth: 0,
            xMin: 0,
            xMax: 0,
            yMin: 0,
            yMax: 0,
            zMin: 0,
            zMax: 0
        };
        bounds.x = (xMin + xMax) * 0.5;
        bounds.y = (yMin + yMax) * 0.5;
        bounds.z = (zMin + zMax) * 0.5;
        bounds.width = xMax - xMin;
        bounds.height = yMax - yMin;
        bounds.depth = zMax - zMin;
        bounds.xMin = xMin;
        bounds.xMax = xMax;
        bounds.yMin = yMin;
        bounds.yMax = yMax;
        bounds.zMin = zMin;
        bounds.zMax = zMax;
        return bounds;
    }

    /** Reproducible hash over the dense alive state in stable attribute order. */
    hash(): string {
        let hash = 0x811c9dc5;
        const updateByte = (byte: number): void => {
            hash ^= byte;
            hash = Math.imul(hash, 0x01000193);
        };
        for (const attribute of this.#layout) {
            const values = this.#arrays.get(attribute.name);
            if (!values)
                throw new Error(`Particle attribute ${attribute.name} storage is unavailable`);
            const byteLength = this.aliveCount * attribute.components * values.BYTES_PER_ELEMENT;
            const bytes = new Uint8Array(values.buffer, values.byteOffset, byteLength);
            for (const byte of bytes) updateByte(byte);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }
}
