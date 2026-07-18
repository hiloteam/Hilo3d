import { beforeAll, describe, expect, it } from 'vitest';
import ComputeShader, {
    type ComputeShaderBinding
} from '../../../src/render/compute/ComputeShader';
import {
    WgslComputeCompilationError,
    WgslComputeShaderCompiler
} from '../../../src/render/shader/WgslComputeCompiler';

const source = `
struct Params {
    count: u32,
}
struct Values {
    items: array<u32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@binding(1) /* fake: @group(99) @binding(99) var fake: sampler; */ @group(0)
var<storage, read> inputData: Values;
@group(0) @binding(2) var<storage, read_write> outputData: Values;
@group(1) @binding(0) var sourceTexture: texture_2d<f32>;
@group(1) @binding(1) var sourceSampler: sampler;
@group(1) @binding(2) var comparisonSampler: sampler_comparison;
@group(1) @binding(3) var outputTexture: texture_storage_2d<rgba8unorm, write>;

/*
@vertex fn ignoredGraphicsEntry() {}
@group(7) @binding(7) var<storage, read_write> ignoredStorage: Values;
*/
@workgroup_size(8u, 4, 1) @compute
fn compact(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x < params.count) {
        outputData.items[id.x] = inputData.items[id.x];
    }
}
`;

const bindings: readonly ComputeShaderBinding[] = [
    {
        name: 'params',
        group: 0,
        binding: 0,
        kind: 'uniform-buffer',
        minBindingSize: 16
    },
    {
        name: 'inputData',
        group: 0,
        binding: 1,
        kind: 'read-only-storage-buffer'
    },
    {
        name: 'outputData',
        group: 0,
        binding: 2,
        kind: 'storage-buffer',
        access: 'write-discard'
    },
    {
        name: 'sourceTexture',
        group: 1,
        binding: 0,
        kind: 'sampled-texture',
        sampleType: 'float'
    },
    { name: 'sourceSampler', group: 1, binding: 1, kind: 'non-filtering-sampler' },
    { name: 'comparisonSampler', group: 1, binding: 2, kind: 'comparison-sampler' },
    {
        name: 'outputTexture',
        group: 1,
        binding: 3,
        kind: 'storage-texture',
        access: 'write-only',
        format: 'rgba8unorm'
    }
];

function createShader(
    overrides: {
        readonly source?: string;
        readonly workgroupSize?: readonly [number, number?, number?];
        readonly bindings?: readonly ComputeShaderBinding[];
        readonly entryPoint?: string;
    } = {}
): ComputeShader {
    return new ComputeShader({
        source: overrides.source ?? source,
        entryPoint: overrides.entryPoint ?? 'compact',
        workgroupSize: overrides.workgroupSize ?? [8, 4, 1],
        bindings: overrides.bindings ?? bindings
    });
}

describe('WgslComputeShaderCompiler', () => {
    const compiler = new WgslComputeShaderCompiler();

    beforeAll(async () => {
        await compiler.initialize();
    });

    it('validates Direct WGSL through Naga and emits exact frozen RHI reflection', () => {
        const shader = createShader();
        const compiled = compiler.compile(shader);

        expect(compiled).toMatchObject({
            source,
            entryPoint: 'compact',
            workgroupSize: [8, 4, 1],
            bindings: shader.bindings
        });
        expect(compiled.reflection.bindings).toEqual([
            {
                name: 'params',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                minBindingSize: 16
            },
            {
                name: 'inputData',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer'
            },
            {
                name: 'outputData',
                group: 0,
                binding: 2,
                kind: 'storage-buffer'
            },
            {
                name: 'sourceTexture',
                group: 1,
                binding: 0,
                kind: 'sampled-texture',
                sampleType: 'float',
                viewDimension: '2d',
                multisampled: false
            },
            {
                name: 'sourceSampler',
                group: 1,
                binding: 1,
                kind: 'sampler'
            },
            {
                name: 'comparisonSampler',
                group: 1,
                binding: 2,
                kind: 'comparison-sampler'
            },
            {
                name: 'outputTexture',
                group: 1,
                binding: 3,
                kind: 'storage-texture',
                storageTextureAccess: 'write-only',
                storageTextureFormat: 'rgba8unorm',
                viewDimension: '2d'
            }
        ]);
        expect(compiled.reflection.workgroupSize).toBe(shader.workgroupSize);
        expect(compiled.reflection.workgroupSize).toEqual([8, 4, 1]);
        expect(compiled.reflection.workgroupStorageSize).toBe(0);
        expect(compiled.reflection.overrides).toEqual([]);
        expect(compiler.compile(shader)).toBe(compiled);
        expect(Object.isFrozen(compiled)).toBe(true);
        expect(Object.isFrozen(compiled.reflection)).toBe(true);
        expect(Object.isFrozen(compiled.reflection.bindings)).toBe(true);
        expect(Object.isFrozen(compiled.reflection.bindings[0])).toBe(true);
        expect(Object.isFrozen(compiled.reflection.overrides)).toBe(true);
    });

    it('maps the explicit non-filtering sampler ABI onto a WGSL sampler resource', () => {
        const compiled = compiler.compile(createShader());

        expect(compiled.bindings[4]?.kind).toBe('non-filtering-sampler');
        expect(compiled.reflection.bindings[4]?.kind).toBe('sampler');
    });

    it('reflects exact struct, matrix, bool, alias, const, and atomic-array layout', () => {
        const shader = createShader({
            source: `
const ATOMIC_COUNT: u32 = 5u;
alias AtomicWords = array<atomic<u32>, ATOMIC_COUNT>;

struct SharedState {
    header: vec3<f32>,
    scale: f32,
    flag: bool,
    transform: mat3x2<f32>,
    @align(16) @size(32) counters: AtomicWords,
};

var<workgroup> sharedState: SharedState;
var<workgroup> scratch: array<atomic<i32>, 7>;

@compute @workgroup_size(1)
fn metadata() {
    let header = sharedState.header.x;
    let value = atomicLoad(&scratch[0]);
    if (header > 0.0) {
        atomicStore(&sharedState.counters[0], u32(value));
    }
}
`,
            entryPoint: 'metadata',
            workgroupSize: [1],
            bindings: []
        });
        const reflection = compiler.compile(shader).reflection;

        expect(reflection.workgroupStorageSize).toBe(112);
        expect(reflection.overrides).toEqual([]);
        expect(Object.isFrozen(reflection.overrides)).toBe(true);
        expect(Object.isFrozen(reflection.overrides?.[0])).toBe(true);
    });

    it('uses WebGPU 16-byte allocation rounding and selected-entry reachability', () => {
        const shader = createShader({
            source: `
var<workgroup> selectedScalar: u32;
var<workgroup> selectedArray: array<u32, 5>;
var<workgroup> otherEntryArray: array<u32, 1024>;

fn selectedHelper() {
    selectedScalar = selectedArray[0];
}

fn otherHelper() {
    otherEntryArray[0] = 1u;
}

@compute @workgroup_size(1)
fn selected() {
    selectedHelper();
}

@compute @workgroup_size(1)
fn other() {
    otherHelper();
}
`,
            entryPoint: 'selected',
            workgroupSize: [1],
            bindings: []
        });

        // Each statically used module-scope allocation is rounded up to 16 bytes: 16 + 32.
        expect(compiler.compile(shader).reflection.workgroupStorageSize).toBe(48);
    });

    it('reflects named and numeric-id pipeline overrides with exact scalar ABI types', () => {
        const shader = createShader({
            source: `
override REQUIRED_COUNT: u32;
override OPTIONAL_OFFSET: i32 = -1;
override OPTIONAL_SCALE: f32 = 1.0;
@id(7) override ENABLED: bool = true;
@compute @workgroup_size(1) fn metadata() {}
`,
            entryPoint: 'metadata',
            workgroupSize: [1],
            bindings: []
        });
        const reflection = compiler.compile(shader).reflection;

        expect(reflection.overrides).toEqual([
            { name: 'REQUIRED_COUNT', type: 'u32', required: true },
            { name: 'OPTIONAL_OFFSET', type: 'i32', required: false },
            { name: 'OPTIONAL_SCALE', type: 'f32', required: false },
            { name: '7', type: 'bool', required: false }
        ]);
        expect(reflection.requiresF16).toBe(false);
    });

    it('fails closed for f16 until the required Naga WGSL validation path is available', () => {
        expect(() =>
            compiler.compile(
                createShader({
                    source: `
enable f16;
override HALF_SCALE: f16 = 1.0h;
var<workgroup> values: array<vec3<f16>, 2>;
@compute @workgroup_size(1) fn metadata() {}
`,
                    entryPoint: 'metadata',
                    workgroupSize: [1],
                    bindings: []
                })
            )
        ).toThrow(/Direct WGSL f16 is fail-closed/u);
    });

    it('fails closed when overrides or non-literal expressions determine compute metadata', () => {
        expect(() =>
            compiler.compile(
                createShader({
                    source: `
override COUNT: u32 = 4u;
var<workgroup> values: array<u32, COUNT>;
@compute @workgroup_size(1) fn metadata() { values[0] = 1u; }
`,
                    entryPoint: 'metadata',
                    workgroupSize: [1],
                    bindings: []
                })
            )
        ).toThrow(/depends on pipeline override COUNT/u);

        expect(() =>
            compiler.compile(
                createShader({
                    source: `
const COUNT: u32 = 2u * 2u;
var<workgroup> values: array<u32, COUNT>;
@compute @workgroup_size(1) fn metadata() { values[0] = 1u; }
`,
                    entryPoint: 'metadata',
                    workgroupSize: [1],
                    bindings: []
                })
            )
        ).toThrow(/must be one literal integer/u);

        expect(() =>
            compiler.compile(
                createShader({
                    source: `
override WIDTH: u32 = 4u;
@compute @workgroup_size(WIDTH) fn metadata() {}
`,
                    entryPoint: 'metadata',
                    workgroupSize: [4],
                    bindings: []
                })
            )
        ).toThrow(/workgroup_size dimension 0 must be an unsigned literal integer/u);
    });

    it('requires initialization before compiling', () => {
        expect(() => new WgslComputeShaderCompiler().compile(createShader())).toThrow(
            /initialize\(\) is required/u
        );
    });

    it('wraps Naga syntax failures with the original source and cause', () => {
        const invalidSource = '@compute @workgroup_size(1) fn broken( {';
        let thrown: unknown;
        try {
            compiler.compile(
                createShader({
                    source: invalidSource,
                    entryPoint: 'broken',
                    workgroupSize: [1],
                    bindings: []
                })
            );
        } catch (error: unknown) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(WgslComputeCompilationError);
        expect(thrown).toMatchObject({ source: invalidSource });
        expect((thrown as WgslComputeCompilationError).cause).toBeDefined();
    });

    it('runs Naga validation instead of accepting a merely parseable module', () => {
        const invalidSource = `
@compute @workgroup_size(1)
fn broken() {
    let invalid: u32 = vec4<u32>(1u);
}`;
        expect(() =>
            compiler.compile(
                createShader({
                    source: invalidSource,
                    entryPoint: 'broken',
                    workgroupSize: [1],
                    bindings: []
                })
            )
        ).toThrow(WgslComputeCompilationError);
    });

    it('rejects workgroup, entry-stage, and selected-entry mismatches', () => {
        expect(() => compiler.compile(createShader({ workgroupSize: [4, 4, 1] }))).toThrow(
            /workgroupSize 4x4x1 does not match WGSL 8x4x1/u
        );
        expect(() => compiler.compile(createShader({ entryPoint: 'missing' }))).toThrow(
            /entry point missing must name exactly one WGSL function/u
        );
        expect(() =>
            compiler.compile(
                createShader({
                    source: `${source}\n@vertex fn graphics() -> @builtin(position) vec4<f32> { return vec4<f32>(); }`
                })
            )
        ).toThrow(/cannot contain vertex entry graphics/u);
    });

    it('rejects missing, extra, renamed, and access-incompatible bindings', () => {
        expect(() => compiler.compile(createShader({ bindings: bindings.slice(0, -1) }))).toThrow(
            /outputTexture.*absent from ComputeShader ABI/u
        );
        expect(() =>
            compiler.compile(
                createShader({
                    bindings: [
                        ...bindings,
                        { name: 'extra', group: 3, binding: 0, kind: 'sampler' }
                    ]
                })
            )
        ).toThrow(/ABI binding 3:0 is absent from WGSL source/u);
        expect(() =>
            compiler.compile(
                createShader({
                    bindings: bindings.map(binding =>
                        binding.group === 0 && binding.binding === 1
                            ? { ...binding, name: 'renamedInput' }
                            : binding
                    )
                })
            )
        ).toThrow(/names renamedInput, but WGSL declares inputData/u);
        expect(() =>
            compiler.compile(
                createShader({
                    bindings: bindings.map(binding =>
                        binding.group === 0 && binding.binding === 2
                            ? {
                                  name: binding.name,
                                  group: binding.group,
                                  binding: binding.binding,
                                  kind: 'read-only-storage-buffer' as const
                              }
                            : binding
                    )
                })
            )
        ).toThrow(/read-only-storage-buffer, but WGSL declares storage-buffer/u);
    });

    it('rejects sampled and storage texture ABI metadata mismatches', () => {
        expect(() =>
            compiler.compile(
                createShader({
                    bindings: bindings.map(binding =>
                        binding.name === 'sourceTexture'
                            ? { ...binding, sampleType: 'depth' as const }
                            : binding
                    )
                })
            )
        ).toThrow(/sampleType depth does not match WGSL/u);
        expect(() =>
            compiler.compile(
                createShader({
                    source: source.replace('texture_2d<f32>', 'texture_3d<f32>')
                })
            )
        ).toThrow(/viewDimension 2d does not match WGSL 3d/u);
        expect(() =>
            compiler.compile(
                createShader({
                    bindings: bindings.map(binding =>
                        binding.name === 'outputTexture'
                            ? { ...binding, format: 'rgba16float' as const }
                            : binding
                    )
                })
            )
        ).toThrow(/format rgba16float does not match WGSL rgba8unorm/u);
    });
});
