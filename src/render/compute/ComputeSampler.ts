import type { RenderTargetCompareFunction } from '../RenderTarget';

/** Portable addressing mode for a compute sampler. */
export type ComputeSamplerAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
/** Portable filtering mode for a compute sampler. */
export type ComputeSamplerFilterMode = 'nearest' | 'linear';

/** Immutable sampler options consumed by compute and storage-aware graphics passes. */
export interface ComputeSamplerDescriptor {
    /** Optional diagnostic label. */
    readonly label?: string;
    /** U-coordinate addressing mode. */
    readonly addressModeU?: ComputeSamplerAddressMode;
    /** V-coordinate addressing mode. */
    readonly addressModeV?: ComputeSamplerAddressMode;
    /** W-coordinate addressing mode. */
    readonly addressModeW?: ComputeSamplerAddressMode;
    /** Magnification filter. */
    readonly magFilter?: ComputeSamplerFilterMode;
    /** Minification filter. */
    readonly minFilter?: ComputeSamplerFilterMode;
    /** Mipmap-level filter. */
    readonly mipmapFilter?: ComputeSamplerFilterMode;
    /** Minimum level-of-detail clamp. */
    readonly lodMinClamp?: number;
    /** Maximum level-of-detail clamp. */
    readonly lodMaxClamp?: number;
    /** Optional comparison function; its presence creates a comparison sampler. */
    readonly compare?: RenderTargetCompareFunction;
    /** Positive anisotropy value; values above one require all filters to be linear. */
    readonly maxAnisotropy?: number;
}

const ADDRESS_MODES: ReadonlySet<string> = new Set(['clamp-to-edge', 'repeat', 'mirror-repeat']);
const FILTER_MODES: ReadonlySet<string> = new Set(['nearest', 'linear']);
const COMPARE_FUNCTIONS: ReadonlySet<string> = new Set([
    'never',
    'less',
    'equal',
    'less-equal',
    'greater',
    'not-equal',
    'greater-equal',
    'always'
]);

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('ComputeSampler descriptor must be an object');
    }
    return value as Readonly<Record<string, unknown>>;
}

function optionalMember(
    record: Readonly<Record<string, unknown>>,
    name: string,
    allowed: ReadonlySet<string>
): string | undefined {
    const value = record[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !allowed.has(value)) {
        const description = typeof value === 'string' ? value : typeof value;
        throw new TypeError(`ComputeSampler.${name} has unsupported value ${description}`);
    }
    return value;
}

function optionalFinite(
    record: Readonly<Record<string, unknown>>,
    name: string,
    fallback: number
): number {
    const value = record[name] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RangeError(`ComputeSampler.${name} must be finite`);
    }
    return value;
}

/** Immutable, backend-neutral sampler configuration for compute bindings. */
export class ComputeSampler {
    /** Stable diagnostic label. */
    readonly label: string;
    /** U-coordinate addressing mode. */
    readonly addressModeU: ComputeSamplerAddressMode;
    /** V-coordinate addressing mode. */
    readonly addressModeV: ComputeSamplerAddressMode;
    /** W-coordinate addressing mode. */
    readonly addressModeW: ComputeSamplerAddressMode;
    /** Magnification filter. */
    readonly magFilter: ComputeSamplerFilterMode;
    /** Minification filter. */
    readonly minFilter: ComputeSamplerFilterMode;
    /** Mipmap-level filter. */
    readonly mipmapFilter: ComputeSamplerFilterMode;
    /** Minimum level-of-detail clamp. */
    readonly lodMinClamp: number;
    /** Maximum level-of-detail clamp. */
    readonly lodMaxClamp: number;
    /** Comparison function, or undefined for an ordinary sampler. */
    readonly compare: RenderTargetCompareFunction | undefined;
    /** Anisotropy value snapshotted into the RHI sampler recipe. */
    readonly maxAnisotropy: number;

    /** Snapshot a portable immutable sampler descriptor without creating device objects. */
    constructor(descriptor: Readonly<ComputeSamplerDescriptor> = {}) {
        const record = requireRecord(descriptor);
        const label = record['label'] ?? 'ComputeSampler';
        if (typeof label !== 'string' || label.length === 0) {
            throw new TypeError('ComputeSampler.label must be a non-empty string');
        }
        const addressModeU = optionalMember(record, 'addressModeU', ADDRESS_MODES);
        const addressModeV = optionalMember(record, 'addressModeV', ADDRESS_MODES);
        const addressModeW = optionalMember(record, 'addressModeW', ADDRESS_MODES);
        const magFilter = optionalMember(record, 'magFilter', FILTER_MODES);
        const minFilter = optionalMember(record, 'minFilter', FILTER_MODES);
        const mipmapFilter = optionalMember(record, 'mipmapFilter', FILTER_MODES);
        const compare = optionalMember(record, 'compare', COMPARE_FUNCTIONS);
        const lodMinClamp = optionalFinite(record, 'lodMinClamp', 0);
        const lodMaxClamp = optionalFinite(record, 'lodMaxClamp', 32);
        if (lodMinClamp < 0 || lodMaxClamp < lodMinClamp) {
            throw new RangeError('ComputeSampler LOD clamps require 0 <= min <= max');
        }
        const maxAnisotropy = optionalFinite(record, 'maxAnisotropy', 1);
        if (!Number.isSafeInteger(maxAnisotropy) || maxAnisotropy < 1) {
            throw new RangeError('ComputeSampler.maxAnisotropy must be a positive integer');
        }
        if (
            maxAnisotropy > 1 &&
            (magFilter !== 'linear' || minFilter !== 'linear' || mipmapFilter !== 'linear')
        ) {
            throw new TypeError('Anisotropic compute samplers require linear filtering');
        }
        this.label = label;
        this.addressModeU = (addressModeU ?? 'clamp-to-edge') as ComputeSamplerAddressMode;
        this.addressModeV = (addressModeV ?? 'clamp-to-edge') as ComputeSamplerAddressMode;
        this.addressModeW = (addressModeW ?? 'clamp-to-edge') as ComputeSamplerAddressMode;
        this.magFilter = (magFilter ?? 'nearest') as ComputeSamplerFilterMode;
        this.minFilter = (minFilter ?? 'nearest') as ComputeSamplerFilterMode;
        this.mipmapFilter = (mipmapFilter ?? 'nearest') as ComputeSamplerFilterMode;
        this.lodMinClamp = lodMinClamp;
        this.lodMaxClamp = lodMaxClamp;
        this.compare = compare as RenderTargetCompareFunction | undefined;
        this.maxAnisotropy = maxAnisotropy;
        Object.freeze(this);
    }
}

export default ComputeSampler;
