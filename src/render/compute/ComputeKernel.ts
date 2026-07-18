import ComputeShader from './ComputeShader';

/** Value accepted by a fixed WGSL pipeline override constant. */
export type ComputePipelineConstant = number | boolean;

/** Immutable compute pipeline configuration shared across renderer-local caches. */
export interface ComputeKernelDescriptor {
    /** Optional diagnostic label. */
    readonly label?: string;
    /** Immutable Direct WGSL shader and explicit binding ABI. */
    readonly shader: ComputeShader;
    /** Pipeline override constants fixed for the lifetime of this kernel. */
    readonly constants?: Readonly<Record<string, ComputePipelineConstant>>;
}

const WGSL_IDENTIFIER = /^[A-Za-z_]\w*$/u;

function isPipelineConstantIdentifier(value: string): boolean {
    if (WGSL_IDENTIFIER.test(value)) return true;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return false;
    const id = Number(value);
    return Number.isSafeInteger(id) && id <= 65_535;
}

function requireDescriptor(value: unknown): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('ComputeKernel descriptor must be an object');
    }
    return value as Readonly<Record<string, unknown>>;
}

function snapshotConstants(value: unknown): Readonly<Record<string, ComputePipelineConstant>> {
    if (value === undefined) return Object.freeze({});
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('ComputeKernel.constants must be an object');
    }
    const source = value as Readonly<Record<string, unknown>>;
    const snapshot: Record<string, ComputePipelineConstant> = {};
    for (const name of Object.keys(source).sort()) {
        if (!isPipelineConstantIdentifier(name)) {
            throw new TypeError(
                `ComputeKernel constant ${name} is not a WGSL name or numeric pipeline constant ID`
            );
        }
        const constant = source[name];
        if (typeof constant === 'number') {
            if (!Number.isFinite(constant)) {
                throw new RangeError(`ComputeKernel constant ${name} must be finite`);
            }
            snapshot[name] = constant;
            continue;
        }
        if (typeof constant === 'boolean') {
            snapshot[name] = constant;
            continue;
        }
        throw new TypeError(`ComputeKernel constant ${name} must be a finite number or boolean`);
    }
    return Object.freeze(snapshot);
}

/**
 * Stable backend-neutral compute pipeline configuration.
 *
 * GPU pipeline, layout, and bind-group objects remain renderer-local. A kernel may therefore be
 * shared by multiple renderers without sharing native resources or device generations.
 */
export class ComputeKernel {
    /** Stable diagnostic label. */
    readonly label: string;
    /** Immutable Direct WGSL source and binding ABI. */
    readonly shader: ComputeShader;
    /** Frozen pipeline override constants. */
    readonly constants: Readonly<Record<string, ComputePipelineConstant>>;

    /** Create a backend-neutral compute pipeline identity. */
    constructor(descriptor: Readonly<ComputeKernelDescriptor>) {
        const record = requireDescriptor(descriptor);
        const shader = record['shader'];
        if (!(shader instanceof ComputeShader)) {
            throw new TypeError('ComputeKernel requires a ComputeShader');
        }
        const label = record['label'] ?? (shader.label || 'ComputeKernel');
        if (typeof label !== 'string' || label.length === 0) {
            throw new TypeError('ComputeKernel.label must be a non-empty string');
        }
        this.label = label;
        this.shader = shader;
        this.constants = snapshotConstants(record['constants']);
        Object.freeze(this);
    }
}

export default ComputeKernel;
