export type VariantHashValue = string | number | boolean | null | undefined;
export type VariantHashFunction = (values: readonly VariantHashValue[]) => string;

const numberBuffer = new ArrayBuffer(8);
const numberView = new DataView(numberBuffer);

const TYPE_STRING = 0x01;
const TYPE_NUMBER = 0x02;
const TYPE_TRUE = 0x03;
const TYPE_FALSE = 0x04;
const TYPE_NULL = 0x05;
const TYPE_UNDEFINED = 0x06;

function rotateLeft(value: number, count: number): number {
    return (value << count) | (value >>> (32 - count));
}

function avalanche(value: number): number {
    value ^= value >>> 16;
    value = Math.imul(value, 0x85ebca6b);
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2ae35);
    value ^= value >>> 16;
    return value >>> 0;
}

function hex32(value: number): string {
    return value.toString(16).padStart(8, '0');
}

/**
 * Incremental, dual-lane 64-bit hash for shader variant fields.
 *
 * Values are type- and length-delimited, so structured inputs do not rely on separators or an
 * intermediate serialization. This is a cache hash rather than a security primitive.
 */
class StructuredVariantHasher {
    private laneA = 0x9e3779b1;
    private laneB = 0x243f6a88;
    private wordCount = 0;

    private mix(word: number): void {
        let laneA = Math.imul(this.laneA ^ word, 0x85ebca77);
        laneA = Math.imul(rotateLeft(laneA, 13), 5) + 0xe6546b64;

        let laneB = Math.imul(this.laneB ^ word, 0xc2b2ae3d);
        laneB = Math.imul(rotateLeft(laneB, 15), 5) + 0x52dce729;

        this.laneA = laneA | 0;
        this.laneB = laneB | 0;
        this.wordCount++;
    }

    private writeString(value: string): void {
        this.mix(TYPE_STRING);
        this.mix(value.length);
        for (let index = 0; index < value.length; index += 2) {
            const first = value.charCodeAt(index);
            const second = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
            this.mix(first | (second << 16));
        }
    }

    private writeNumber(value: number): void {
        this.mix(TYPE_NUMBER);
        // Shader define output treats -0 and 0 identically. Canonicalize them in the signature too.
        if (Number.isNaN(value)) {
            this.mix(0);
            this.mix(0x7ff80000);
            return;
        }
        numberView.setFloat64(0, value === 0 ? 0 : value, true);
        this.mix(numberView.getUint32(0, true));
        this.mix(numberView.getUint32(4, true));
    }

    write(value: VariantHashValue): void {
        if (typeof value === 'string') {
            this.writeString(value);
        } else if (typeof value === 'number') {
            this.writeNumber(value);
        } else if (value === true) {
            this.mix(TYPE_TRUE);
        } else if (value === false) {
            this.mix(TYPE_FALSE);
        } else if (value === null) {
            this.mix(TYPE_NULL);
        } else {
            this.mix(TYPE_UNDEFINED);
        }
    }

    digest(): string {
        const laneA = avalanche(this.laneA ^ this.wordCount);
        const laneB = avalanche(this.laneB ^ this.wordCount ^ rotateLeft(laneA, 17));
        return `${hex32(laneA)}${hex32(laneB)}`;
    }
}

/** Hash a structured sequence without allocating a serialized copy of it. */
export function hashVariantValues(values: readonly VariantHashValue[]): string {
    const hasher = new StructuredVariantHasher();
    for (const value of values) hasher.write(value);
    return hasher.digest();
}

interface VariantKeyEntry {
    readonly key: string;
    readonly values: readonly VariantHashValue[];
}

interface VariantKeyBucket {
    readonly entries: VariantKeyEntry[];
    nextSlot: number;
}

function valuesEqual(
    left: readonly VariantHashValue[],
    right: readonly VariantHashValue[]
): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
        const leftValue = left[index];
        const rightValue = right[index];
        if (leftValue === rightValue) continue;
        if (
            typeof leftValue === 'number' &&
            typeof rightValue === 'number' &&
            Number.isNaN(leftValue) &&
            Number.isNaN(rightValue)
        ) {
            continue;
        }
        return false;
    }
    return true;
}

/**
 * Resolves compact hashes to cache keys while retaining exact fields for collision checks.
 * Hash collisions receive deterministic bucket suffixes instead of aliasing another variant.
 */
export class CollisionSafeVariantKeyRegistry {
    private readonly buckets = new Map<string, VariantKeyBucket>();
    private readonly keyBuckets = new Map<string, string>();

    constructor(private readonly hash: VariantHashFunction = hashVariantValues) {}

    resolve(
        namespace: string,
        values: readonly VariantHashValue[],
        hashedValues: readonly VariantHashValue[] = values
    ): string {
        const bucketKey = `${namespace}:${this.hash(hashedValues)}`;
        let bucket = this.buckets.get(bucketKey);
        if (bucket) {
            for (const entry of bucket.entries) {
                if (valuesEqual(entry.values, values)) return entry.key;
            }
        } else {
            bucket = { entries: [], nextSlot: 0 };
            this.buckets.set(bucketKey, bucket);
        }

        const slot = bucket.nextSlot++;
        const key = slot === 0 ? bucketKey : `${bucketKey}.${slot.toString(36)}`;
        bucket.entries.push({ key, values: values.slice() });
        this.keyBuckets.set(key, bucketKey);
        return key;
    }

    release(key: string): void {
        const bucketKey = this.keyBuckets.get(key);
        if (bucketKey === undefined) return;
        const bucket = this.buckets.get(bucketKey);
        if (!bucket) return;

        const entryIndex = bucket.entries.findIndex(entry => entry.key === key);
        if (entryIndex >= 0) bucket.entries.splice(entryIndex, 1);
        this.keyBuckets.delete(key);
        if (bucket.entries.length === 0) this.buckets.delete(bucketKey);
    }

    clear(): void {
        this.buckets.clear();
        this.keyBuckets.clear();
    }
}
