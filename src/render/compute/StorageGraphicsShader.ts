import type { ShaderReadBinding } from './ComputeShader';

/** Constrained GLSL ES 3.10 graphics source and readonly resource ABI. */
export interface StorageGraphicsShaderDescriptor {
    /** Optional diagnostic label. */
    readonly label?: string;
    /** GLSL ES 3.10 vertex source; storage blocks must be `readonly` and `std430`. */
    readonly vertexSource: string;
    /** GLSL ES 3.10 fragment source; storage blocks must be `readonly` and `std430`. */
    readonly fragmentSource: string;
    /** Complete read-only resource ABI shared by the two graphics stages. */
    readonly bindings: readonly ShaderReadBinding[];
}

/** Internal adapter for a preprocessed portable shader promoted into the storage-raster dialect. */
export interface PortableStorageGraphicsShaderDescriptor {
    readonly label?: string;
    /** Fully preprocessed GLSL ES 3.00 vertex source. */
    readonly portableVertexSource: string;
    /** Fully preprocessed GLSL ES 3.00 fragment source with constrained readonly storage blocks. */
    readonly portableFragmentSource: string;
    readonly bindings: readonly ShaderReadBinding[];
}

const MAX_U32 = 0xffff_ffff;
const identifierPattern = /^[A-Za-z_]\w*$/u;
const sampledTextureTypes: ReadonlySet<string> = new Set([
    'float',
    'unfilterable-float',
    'depth',
    'sint',
    'uint'
]);
const textureViewDimensions: ReadonlySet<string> = new Set(['2d', '2d-array', '3d', 'cube']);

function requireRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function requireIdentifier(value: unknown, path: string): string {
    if (typeof value !== 'string' || !identifierPattern.test(value)) {
        throw new TypeError(`${path} must be a non-empty GLSL identifier`);
    }
    return value;
}

function requireU32(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_U32) {
        throw new RangeError(`${path} must be a non-negative 32-bit integer`);
    }
    return value;
}

function optionalBindingSize(
    record: Readonly<Record<string, unknown>>,
    path: string
): number | undefined {
    const value = record['minBindingSize'];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${path}.minBindingSize must be a non-negative safe integer`);
    }
    return value;
}

function optionalDynamicOffset(
    record: Readonly<Record<string, unknown>>,
    path: string
): boolean | undefined {
    const value = record['dynamicOffset'];
    if (value !== undefined && typeof value !== 'boolean') {
        throw new TypeError(`${path}.dynamicOffset must be a boolean`);
    }
    return value;
}

function requireStringMember(
    record: Readonly<Record<string, unknown>>,
    name: string,
    values: ReadonlySet<string>,
    path: string
): string {
    const value = record[name];
    if (typeof value !== 'string' || !values.has(value)) {
        throw new TypeError(`${path}.${name} has an unsupported value ${String(value)}`);
    }
    return value;
}

function snapshotBinding(value: unknown, index: number): ShaderReadBinding {
    const path = `StorageGraphicsShader.bindings[${String(index)}]`;
    const record = requireRecord(value, path);
    const base = {
        name: requireIdentifier(record['name'], `${path}.name`),
        group: requireU32(record['group'], `${path}.group`),
        binding: requireU32(record['binding'], `${path}.binding`)
    } as const;
    const kind = record['kind'];
    switch (kind) {
        case 'uniform-buffer':
        case 'read-only-storage-buffer': {
            const minBindingSize = optionalBindingSize(record, path);
            const dynamicOffset = optionalDynamicOffset(record, path);
            return Object.freeze({
                ...base,
                kind,
                ...(minBindingSize === undefined ? {} : { minBindingSize }),
                ...(dynamicOffset === undefined ? {} : { dynamicOffset })
            });
        }
        case 'sampled-texture': {
            const sampleType = requireStringMember(
                record,
                'sampleType',
                sampledTextureTypes,
                path
            ) as Extract<ShaderReadBinding, { readonly kind: 'sampled-texture' }>['sampleType'];
            const rawDimension = record['viewDimension'];
            const viewDimension =
                rawDimension === undefined
                    ? undefined
                    : (requireStringMember(
                          record,
                          'viewDimension',
                          textureViewDimensions,
                          path
                      ) as Extract<
                          ShaderReadBinding,
                          { readonly kind: 'sampled-texture' }
                      >['viewDimension']);
            return Object.freeze({
                ...base,
                kind,
                sampleType,
                ...(viewDimension === undefined ? {} : { viewDimension })
            });
        }
        case 'sampler':
        case 'comparison-sampler':
            return Object.freeze({ ...base, kind });
        default:
            throw new TypeError(
                `${path}.kind must be a read-only graphics binding, received ${String(kind)}`
            );
    }
}

function resourceNameKey(binding: ShaderReadBinding): string {
    return `${binding.name}:${binding.kind}`;
}

function validateBindingNames(bindings: readonly ShaderReadBinding[]): void {
    const resources = new Set<string>();
    const kindsByName = new Map<string, Set<ShaderReadBinding['kind']>>();
    for (const binding of bindings) {
        const resourceKey = resourceNameKey(binding);
        if (resources.has(resourceKey)) {
            throw new TypeError(
                `StorageGraphicsShader contains duplicate ${binding.kind} name ${binding.name}`
            );
        }
        resources.add(resourceKey);
        const kinds = kindsByName.get(binding.name) ?? new Set<ShaderReadBinding['kind']>();
        kinds.add(binding.kind);
        kindsByName.set(binding.name, kinds);
    }
    for (const [name, kinds] of kindsByName) {
        if (kinds.size === 1) continue;
        const isCombinedSampler =
            kinds.size === 2 &&
            kinds.has('sampled-texture') &&
            (kinds.has('sampler') || kinds.has('comparison-sampler'));
        if (!isCombinedSampler) {
            throw new TypeError(
                `StorageGraphicsShader binding name ${name} is shared by incompatible resource kinds`
            );
        }
    }
}

function requireSource(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${path} must be a non-empty string`);
    }
    return value;
}

function promotePortableSource(source: string, stage: 'vertex' | 'fragment'): string {
    const promoted = source.replace(/^#version 300 es$/mu, '#version 310 es');
    if (promoted === source) {
        throw new TypeError(`Portable storage graphics ${stage} source must use GLSL ES 3.00`);
    }
    return promoted;
}

/**
 * Immutable WebGPU-only graphics shader configuration for readonly storage-buffer rendering.
 *
 * Sources use the constrained GLSL ES 3.10 contract. Compilation still runs through the shared
 * engine GLSL preprocessing and Naga translation path; this object never accepts hand-written
 * graphics WGSL.
 */
export class StorageGraphicsShader {
    /** Stable diagnostic label, or an empty string. */
    readonly label: string;
    /** Immutable GLSL ES 3.10 vertex source. */
    readonly vertexSource: string;
    /** Immutable GLSL ES 3.10 fragment source. */
    readonly fragmentSource: string;
    /** Immutable bindings in group/binding order. */
    readonly bindings: readonly ShaderReadBinding[];

    /** Snapshot a WebGPU-only storage-aware graphics shader contract. */
    constructor(descriptor: Readonly<StorageGraphicsShaderDescriptor>) {
        const record = requireRecord(descriptor, 'StorageGraphicsShader descriptor');
        const label = record['label'];
        if (label !== undefined && typeof label !== 'string') {
            throw new TypeError('StorageGraphicsShader.label must be a string');
        }
        const rawBindings = record['bindings'];
        if (!Array.isArray(rawBindings)) {
            throw new TypeError('StorageGraphicsShader.bindings must be an array');
        }
        const bindings = rawBindings.map(snapshotBinding);
        bindings.sort(
            (left, right) =>
                left.group - right.group ||
                left.binding - right.binding ||
                left.kind.localeCompare(right.kind)
        );
        const locations = new Set<string>();
        for (const binding of bindings) {
            const location = `${String(binding.group)}:${String(binding.binding)}`;
            if (locations.has(location)) {
                throw new TypeError(
                    `StorageGraphicsShader contains duplicate binding location ${location}`
                );
            }
            locations.add(location);
        }
        validateBindingNames(bindings);
        if (!bindings.some(binding => binding.kind === 'read-only-storage-buffer')) {
            throw new TypeError(
                'StorageGraphicsShader requires at least one read-only-storage-buffer binding'
            );
        }

        this.label = label ?? '';
        this.vertexSource = requireSource(
            record['vertexSource'],
            'StorageGraphicsShader.vertexSource'
        );
        this.fragmentSource = requireSource(
            record['fragmentSource'],
            'StorageGraphicsShader.fragmentSource'
        );
        this.bindings = Object.freeze(bindings);
        Object.freeze(this);
    }
}

/**
 * Promote fully preprocessed portable raster source at the single storage-graphics boundary.
 * This keeps dynamic built-in material variants on the same GLSL/Naga path without admitting a
 * second handwritten WGSL or raster-material tree.
 *
 * @internal
 */
export function createStorageGraphicsShaderFromPortable(
    descriptor: Readonly<PortableStorageGraphicsShaderDescriptor>
): StorageGraphicsShader {
    return new StorageGraphicsShader({
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        vertexSource: promotePortableSource(descriptor.portableVertexSource, 'vertex'),
        fragmentSource: promotePortableSource(descriptor.portableFragmentSource, 'fragment'),
        bindings: descriptor.bindings
    });
}

export default StorageGraphicsShader;
