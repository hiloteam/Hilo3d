/** Sample interpretation supported by whole-subresource compute graph textures. */
export type ComputeTextureSampleType = 'float' | 'unfilterable-float' | 'depth';

/** Compute graph textures currently expose one complete two-dimensional subresource. */
export type ComputeTextureViewDimension = '2d';
/** Compute storage textures currently expose one complete two-dimensional subresource. */
export type ComputeStorageTextureViewDimension = '2d';
/** Sample interpretation supported by storage-aware graphics shaders. */
export type ShaderTextureSampleType = ComputeTextureSampleType | 'sint' | 'uint';
/** Texture views supported by the Material-backed storage graphics path. */
export type ShaderTextureViewDimension = ComputeTextureViewDimension | '2d-array' | '3d' | 'cube';
/** Public color formats that can be requested for a storage-texture binding. */
export type ComputeStorageTextureFormat = 'r32float' | 'rgba8unorm' | 'rgba16float' | 'rgba32float';
/** Graph initialization promise for a writable storage-buffer binding. */
export type ComputeStorageBufferAccess = 'read-write' | 'write-discard';

/** Resource binding that a shader may only read. */
export type ShaderReadBinding =
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'uniform-buffer' | 'read-only-storage-buffer';
          minBindingSize?: number;
          dynamicOffset?: boolean;
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'sampled-texture';
          sampleType: ShaderTextureSampleType;
          viewDimension?: ShaderTextureViewDimension;
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'sampler' | 'comparison-sampler';
      }>;

/** Explicit binding ABI for one Direct WGSL compute shader. */
export type ComputeShaderBinding =
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'uniform-buffer' | 'read-only-storage-buffer';
          minBindingSize?: number;
          dynamicOffset?: boolean;
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'sampled-texture';
          sampleType: ComputeTextureSampleType;
          viewDimension?: ComputeTextureViewDimension;
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'sampler' | 'non-filtering-sampler' | 'comparison-sampler';
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'storage-buffer';
          /** Graph access promise; both modes use a WGSL `read_write` storage declaration. */
          access: ComputeStorageBufferAccess;
          minBindingSize?: number;
          dynamicOffset?: boolean;
      }>
    | Readonly<{
          name: string;
          group: number;
          binding: number;
          kind: 'storage-texture';
          /**
           * WGSL access mode. Declaring this binding also promises that the pass completely
           * replaces the bound texture subresource before a later graph read.
           */
          access: 'write-only';
          format: ComputeStorageTextureFormat;
          viewDimension?: ComputeStorageTextureViewDimension;
      }>;

/** Immutable source, entry point, workgroup size, and binding ABI for {@link ComputeShader}. */
export interface ComputeShaderDescriptor {
    /** Optional diagnostic label. */
    readonly label?: string;
    /** Direct WGSL source containing exactly the declared compute entry point and resources. */
    readonly source: string;
    /** Compute entry-point name. Defaults to `main`. */
    readonly entryPoint?: string;
    /** One to three positive literal dimensions, which must match `@workgroup_size`. */
    readonly workgroupSize: readonly [number, number?, number?];
    /** Complete explicit resource ABI; entries are snapshotted and sorted by group/binding. */
    readonly bindings: readonly ComputeShaderBinding[];
}

/** Normalized three-dimensional compute workgroup size. */
export type NormalizedComputeWorkgroupSize = readonly [number, number, number];

const MAX_U32 = 0xffff_ffff;
const identifierPattern = /^[A-Za-z_]\w*$/u;
const sampledTextureTypes: ReadonlySet<string> = new Set(['float', 'unfilterable-float', 'depth']);
const textureViewDimensions: ReadonlySet<string> = new Set(['2d']);
const storageTextureViewDimensions: ReadonlySet<string> = new Set(['2d']);
const storageTextureFormats: ReadonlySet<string> = new Set([
    'r32float',
    'rgba8unorm',
    'rgba16float',
    'rgba32float'
]);
const storageBufferAccesses: ReadonlySet<string> = new Set(['read-write', 'write-discard']);
const writeOnlyAccesses: ReadonlySet<string> = new Set(['write-only']);

function requireRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function requireIdentifier(value: unknown, path: string): string {
    if (typeof value !== 'string' || !identifierPattern.test(value)) {
        throw new TypeError(`${path} must be a non-empty WGSL identifier`);
    }
    return value;
}

function requireU32(value: unknown, path: string, allowZero: boolean): number {
    if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < (allowZero ? 0 : 1) ||
        value > MAX_U32
    ) {
        throw new RangeError(
            `${path} must be ${allowZero ? 'a non-negative' : 'a positive'} 32-bit integer`
        );
    }
    return value;
}

function requireNonNegativeSafeInteger(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${path} must be a non-negative safe integer`);
    }
    return value;
}

function optionalBoolean(record: Readonly<Record<string, unknown>>, name: string, path: string) {
    const value = record[name];
    if (value !== undefined && typeof value !== 'boolean') {
        throw new TypeError(`${path}.${name} must be a boolean`);
    }
    return value;
}

function optionalBindingSize(
    record: Readonly<Record<string, unknown>>,
    path: string
): number | undefined {
    const value = record['minBindingSize'];
    return value === undefined
        ? undefined
        : requireNonNegativeSafeInteger(value, `${path}.minBindingSize`);
}

function requireStringMember(
    record: Readonly<Record<string, unknown>>,
    name: string,
    allowed: ReadonlySet<string>,
    path: string
): string {
    const value = record[name];
    if (typeof value !== 'string' || !allowed.has(value)) {
        throw new TypeError(`${path}.${name} has an unsupported value ${String(value)}`);
    }
    return value;
}

function snapshotBufferBinding(
    record: Readonly<Record<string, unknown>>,
    base: Readonly<{ name: string; group: number; binding: number }>,
    kind: 'uniform-buffer' | 'read-only-storage-buffer',
    path: string
): ComputeShaderBinding {
    const minBindingSize = optionalBindingSize(record, path);
    const dynamicOffset = optionalBoolean(record, 'dynamicOffset', path);
    return Object.freeze({
        ...base,
        kind,
        ...(minBindingSize === undefined ? {} : { minBindingSize }),
        ...(dynamicOffset === undefined ? {} : { dynamicOffset })
    });
}

function snapshotBinding(value: unknown, index: number): ComputeShaderBinding {
    const path = `ComputeShader.bindings[${String(index)}]`;
    const record = requireRecord(value, path);
    const base = Object.freeze({
        name: requireIdentifier(record['name'], `${path}.name`),
        group: requireU32(record['group'], `${path}.group`, true),
        binding: requireU32(record['binding'], `${path}.binding`, true)
    });
    const kind = record['kind'];
    switch (kind) {
        case 'uniform-buffer':
        case 'read-only-storage-buffer':
            return snapshotBufferBinding(record, base, kind, path);
        case 'storage-buffer': {
            const minBindingSize = optionalBindingSize(record, path);
            const dynamicOffset = optionalBoolean(record, 'dynamicOffset', path);
            const access = requireStringMember(record, 'access', storageBufferAccesses, path) as
                'read-write' | 'write-discard';
            return Object.freeze({
                ...base,
                kind,
                access,
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
            ) as ComputeTextureSampleType;
            const viewDimensionValue = record['viewDimension'];
            const viewDimension =
                viewDimensionValue === undefined
                    ? undefined
                    : (requireStringMember(
                          record,
                          'viewDimension',
                          textureViewDimensions,
                          path
                      ) as ComputeTextureViewDimension);
            return Object.freeze({
                ...base,
                kind,
                sampleType,
                ...(viewDimension === undefined ? {} : { viewDimension })
            });
        }
        case 'sampler':
        case 'non-filtering-sampler':
        case 'comparison-sampler':
            return Object.freeze({ ...base, kind });
        case 'storage-texture': {
            const access = requireStringMember(
                record,
                'access',
                writeOnlyAccesses,
                path
            ) as 'write-only';
            const format = requireStringMember(
                record,
                'format',
                storageTextureFormats,
                path
            ) as ComputeStorageTextureFormat;
            const viewDimensionValue = record['viewDimension'];
            const viewDimension =
                viewDimensionValue === undefined
                    ? undefined
                    : (requireStringMember(
                          record,
                          'viewDimension',
                          storageTextureViewDimensions,
                          path
                      ) as ComputeStorageTextureViewDimension);
            return Object.freeze({
                ...base,
                kind,
                access,
                format,
                ...(viewDimension === undefined ? {} : { viewDimension })
            });
        }
        default:
            throw new TypeError(`${path}.kind has an unsupported value ${String(kind)}`);
    }
}

function snapshotWorkgroupSize(value: unknown): NormalizedComputeWorkgroupSize {
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
        throw new TypeError('ComputeShader.workgroupSize must contain one to three dimensions');
    }
    return Object.freeze([
        requireU32(value[0], 'ComputeShader.workgroupSize[0]', false),
        value[1] === undefined ? 1 : requireU32(value[1], 'ComputeShader.workgroupSize[1]', false),
        value[2] === undefined ? 1 : requireU32(value[2], 'ComputeShader.workgroupSize[2]', false)
    ]);
}

/** Immutable, backend-neutral Direct WGSL compute shader configuration. */
export class ComputeShader {
    /** Stable diagnostic label, or an empty string. */
    readonly label: string;
    /** Validated Direct WGSL source. */
    readonly source: string;
    /** Validated compute entry point. */
    readonly entryPoint: string;
    /** Normalized workgroup dimensions. */
    readonly workgroupSize: NormalizedComputeWorkgroupSize;
    /** Immutable bindings in group/binding order. */
    readonly bindings: readonly ComputeShaderBinding[];

    /** Snapshot a Direct WGSL compute shader contract without creating device objects. */
    constructor(descriptor: Readonly<ComputeShaderDescriptor>) {
        const record = requireRecord(descriptor, 'ComputeShader descriptor');
        const label = record['label'];
        if (label !== undefined && typeof label !== 'string') {
            throw new TypeError('ComputeShader.label must be a string');
        }
        const source = record['source'];
        if (typeof source !== 'string' || source.trim().length === 0) {
            throw new TypeError('ComputeShader.source must be a non-empty string');
        }
        const rawBindings = record['bindings'];
        if (!Array.isArray(rawBindings)) {
            throw new TypeError('ComputeShader.bindings must be an array');
        }

        const bindings = rawBindings.map(snapshotBinding);
        bindings.sort((left, right) => left.group - right.group || left.binding - right.binding);
        const locations = new Set<string>();
        const names = new Set<string>();
        for (const binding of bindings) {
            const location = `${String(binding.group)}:${String(binding.binding)}`;
            if (locations.has(location)) {
                throw new TypeError(
                    `ComputeShader contains duplicate binding location ${location}`
                );
            }
            if (names.has(binding.name)) {
                throw new TypeError(
                    `ComputeShader contains duplicate binding name ${binding.name}`
                );
            }
            locations.add(location);
            names.add(binding.name);
        }

        this.label = label ?? '';
        this.source = source;
        this.entryPoint = requireIdentifier(
            record['entryPoint'] ?? 'main',
            'ComputeShader.entryPoint'
        );
        this.workgroupSize = snapshotWorkgroupSize(record['workgroupSize']);
        this.bindings = Object.freeze(bindings);
        Object.freeze(this);
    }
}

export default ComputeShader;
