import { describe, expect, it, vi } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import Material, { type MaterialBindingMap } from '../../../src/material/Material';
import { UNSIGNED_INT } from '../../../src/constants/webgl';
import {
    VertexInputLayoutCompiler,
    type VertexInputLayoutCapabilities,
    type VertexInputReflection
} from '../../../src/render/renderer/VertexInputLayoutCompiler';

function capabilities(
    overrides: Partial<VertexInputLayoutCapabilities['limits']> = {}
): VertexInputLayoutCapabilities {
    return {
        limits: {
            maxVertexAttributes: overrides.maxVertexAttributes ?? 16,
            maxVertexBuffers: overrides.maxVertexBuffers ?? 8,
            maxVertexBufferArrayStride: overrides.maxVertexBufferArrayStride ?? 2048
        }
    };
}

function binding(value: unknown) {
    return {
        get(): unknown {
            return value;
        }
    };
}

function materialWith(values: Readonly<Record<string, unknown>>): Material {
    const attributes: MaterialBindingMap = {};
    for (const [name, value] of Object.entries(values)) attributes[name] = binding(value);
    return new Material({
        needBasicAttributes: false,
        needBasicUniforms: false,
        attributes
    });
}

function meshWith(vertices: GeometryData, material: Material): Mesh {
    return new Mesh({ geometry: new Geometry({ vertices }), material });
}

function compileOne(
    source: GeometryData,
    name = 'a_value',
    location = 0
): ReturnType<VertexInputLayoutCompiler['compile']> {
    const material = materialWith({ [name]: source });
    return new VertexInputLayoutCompiler().compile(
        [{ name, location }],
        meshWith(source, material),
        material,
        capabilities()
    );
}

describe('VertexInputLayoutCompiler planning', () => {
    it('sorts unique streams by shader location and emits a shared immutable pipeline plan', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const uv = new GeometryData(new Float32Array(6), 2);
        const color = new GeometryData(new Uint8Array(12), 4, { normalized: true });
        const material = materialWith({ a_position: position, a_uv: uv, a_color: color });
        const mesh = meshWith(position, material);
        const inputs: readonly VertexInputReflection[] = [
            { name: 'a_uv', location: 5 },
            { name: 'a_color', location: 2 },
            { name: 'a_position', location: 0 }
        ];

        const plan = new VertexInputLayoutCompiler().compile(
            inputs,
            mesh,
            material,
            capabilities()
        );

        expect(plan.vertexCount).toBe(3);
        expect(plan.streams.map(stream => stream.source)).toEqual([position, color, uv]);
        expect(plan.streams.map(stream => stream.slot)).toEqual([0, 1, 2]);
        expect(plan.vertexBuffers).toEqual([
            {
                arrayStride: 12,
                stepMode: 'vertex',
                attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }]
            },
            {
                arrayStride: 4,
                stepMode: 'vertex',
                attributes: [{ format: 'unorm8x4', offset: 0, shaderLocation: 2 }]
            },
            {
                arrayStride: 8,
                stepMode: 'vertex',
                attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 5 }]
            }
        ]);
        for (const stream of plan.streams) {
            expect(plan.vertexBuffers[stream.slot]).toBe(stream.layout);
            expect(Object.isFrozen(stream)).toBe(true);
            expect(Object.isFrozen(stream.layout)).toBe(true);
            expect(Object.isFrozen(stream.layout.attributes)).toBe(true);
        }
        expect(Object.isFrozen(plan)).toBe(true);
        expect(Object.isFrozen(plan.streams)).toBe(true);
        expect(Object.isFrozen(plan.vertexBuffers)).toBe(true);
    });

    it('merges repeated exact GeometryData sources into one location-sorted slot', () => {
        const shared = new GeometryData(new Float32Array(6), 2);
        const material = materialWith({ a_second: shared, a_first: shared });
        const mesh = meshWith(shared, material);
        const plan = new VertexInputLayoutCompiler().compile(
            [
                { name: 'a_second', location: 7 },
                { name: 'a_first', location: 1 }
            ],
            mesh,
            material,
            capabilities()
        );

        expect(plan.streams).toHaveLength(1);
        expect(plan.streams[0]).toMatchObject({ source: shared, slot: 0, vertexCount: 3 });
        expect(plan.streams[0]?.layout.attributes).toEqual([
            { format: 'float32x2', offset: 0, shaderLocation: 1 },
            { format: 'float32x2', offset: 0, shaderLocation: 7 }
        ]);
    });

    it('expands mat2, mat3, and mat4 values into column-major physical attributes', () => {
        const mat2 = new GeometryData(new Float32Array(8), 4);
        const mat3 = new GeometryData(new Float32Array(18), 9);
        const mat4 = new GeometryData(new Float32Array(32), 16);
        const material = materialWith({ mat2, mat3, mat4 });
        const mesh = meshWith(mat2, material);
        const plan = new VertexInputLayoutCompiler().compile(
            [
                { name: 'mat4', type: 'mat4', location: 6, locationCount: 4 },
                { name: 'mat2', type: 'mat2', location: 1, locationCount: 2 },
                { name: 'mat3', type: 'mat3', location: 3, locationCount: 3 }
            ],
            mesh,
            material,
            capabilities()
        );

        expect(plan.vertexCount).toBe(2);
        expect(plan.streams.map(stream => stream.source)).toEqual([mat2, mat3, mat4]);
        expect(plan.vertexBuffers).toEqual([
            {
                arrayStride: 16,
                stepMode: 'vertex',
                attributes: [
                    { format: 'float32x2', offset: 0, shaderLocation: 1 },
                    { format: 'float32x2', offset: 8, shaderLocation: 2 }
                ]
            },
            {
                arrayStride: 36,
                stepMode: 'vertex',
                attributes: [
                    { format: 'float32x3', offset: 0, shaderLocation: 3 },
                    { format: 'float32x3', offset: 12, shaderLocation: 4 },
                    { format: 'float32x3', offset: 24, shaderLocation: 5 }
                ]
            },
            {
                arrayStride: 64,
                stepMode: 'vertex',
                attributes: [
                    { format: 'float32x4', offset: 0, shaderLocation: 6 },
                    { format: 'float32x4', offset: 16, shaderLocation: 7 },
                    { format: 'float32x4', offset: 32, shaderLocation: 8 },
                    { format: 'float32x4', offset: 48, shaderLocation: 9 }
                ]
            }
        ]);
    });

    it('merges an interleaved matrix with scalar/vector inputs without losing column offsets', () => {
        const storage = new Float32Array(40);
        const position = new GeometryData(storage, 3, {
            bufferViewId: 'matrix-interleaved',
            stride: 80,
            offset: 0
        });
        const transform = new GeometryData(storage, 16, {
            bufferViewId: 'matrix-interleaved',
            stride: 80,
            offset: 16
        });
        const material = materialWith({ position, transform });
        const plan = new VertexInputLayoutCompiler().compile(
            [
                { name: 'transform', type: 'mat4x4', location: 2 },
                { name: 'position', type: 'vec3', location: 0 }
            ],
            meshWith(position, material),
            material,
            capabilities()
        );

        expect(plan.vertexCount).toBe(2);
        expect(plan.streams).toHaveLength(1);
        expect(plan.streams[0]?.source).toBe(position);
        expect(plan.streams[0]?.sources).toEqual([position, transform]);
        expect(plan.vertexBuffers[0]).toEqual({
            arrayStride: 80,
            stepMode: 'vertex',
            attributes: [
                { format: 'float32x3', offset: 0, shaderLocation: 0 },
                { format: 'float32x4', offset: 16, shaderLocation: 2 },
                { format: 'float32x4', offset: 32, shaderLocation: 3 },
                { format: 'float32x4', offset: 48, shaderLocation: 4 },
                { format: 'float32x4', offset: 64, shaderLocation: 5 }
            ]
        });
    });

    it('synthesizes stable missing-input streams with WebGL generic attribute values', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const material = materialWith({
            a_position: position,
            a_uv: null,
            a_uv1: null,
            a_color: undefined
        });
        const mesh = meshWith(position, material);
        const inputs: readonly VertexInputReflection[] = [
            { name: 'a_position', type: 'vec3', location: 0 },
            { name: 'a_uv', type: 'vec2', location: 1 },
            { name: 'a_uv1', type: 'vec2', location: 2 },
            { name: 'a_color', type: 'vec4', location: 3 }
        ];
        const compiler = new VertexInputLayoutCompiler();

        const first = compiler.compile(inputs, mesh, material, capabilities());
        expect(first.streams).toHaveLength(3);
        expect(first.streams[1]?.source.data).toEqual(new Float32Array(6));
        expect(first.streams[1]?.layout.attributes).toEqual([
            { format: 'float32x2', offset: 0, shaderLocation: 1 },
            { format: 'float32x2', offset: 0, shaderLocation: 2 }
        ]);
        expect(first.streams[2]?.source.data).toEqual(
            new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
        );
        expect(compiler.compile(inputs, mesh, material, capabilities())).toBe(first);
        const genericUV = first.streams[1]?.source;
        const genericColor = first.streams[2]?.source;

        position.data = new Float32Array(12);
        const resized = compiler.compile(inputs, mesh, material, capabilities());
        expect(resized).not.toBe(first);
        expect(resized.streams[1]?.source).toBe(genericUV);
        expect(resized.streams[2]?.source).toBe(genericColor);
        expect(resized.streams[1]?.source.count).toBe(4);
        expect(resized.streams[2]?.source.count).toBe(4);

        position.data = new Float32Array(6);
        const resizedAgain = compiler.compile(inputs, mesh, material, capabilities());
        expect(resizedAgain.streams[1]?.source).toBe(genericUV);
        expect(resizedAgain.streams[2]?.source).toBe(genericColor);
        expect(resizedAgain.streams[1]?.source.count).toBe(2);
        expect(resizedAgain.streams[2]?.source.count).toBe(2);

        position.data = new Float32Array(9);
        const restored = compiler.compile(inputs, mesh, material, capabilities());
        expect(restored.streams[1]?.source).toBe(genericUV);
        expect(restored.streams[2]?.source).toBe(genericColor);
        expect(restored.streams[1]?.source.count).toBe(3);
        expect(restored.streams[2]?.source.count).toBe(3);
    });

    it('synthesizes missing matrix columns with WebGL generic-location defaults', () => {
        const position = new GeometryData(new Float32Array(6), 3);
        const material = materialWith({ position, transform: null });
        const plan = new VertexInputLayoutCompiler().compile(
            [
                { name: 'position', type: 'vec3', location: 0 },
                { name: 'transform', type: 'mat4', location: 1, locationCount: 4 }
            ],
            meshWith(position, material),
            material,
            capabilities()
        );

        expect(plan.streams[1]?.source.size).toBe(16);
        expect(plan.streams[1]?.source.data).toEqual(
            new Float32Array([
                0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
                0, 0, 0, 1
            ])
        );
        expect(plan.streams[1]?.layout.attributes).toEqual([
            { format: 'float32x4', offset: 0, shaderLocation: 1 },
            { format: 'float32x4', offset: 16, shaderLocation: 2 },
            { format: 'float32x4', offset: 32, shaderLocation: 3 },
            { format: 'float32x4', offset: 48, shaderLocation: 4 }
        ]);
    });

    it.each([
        [new Float32Array(2), 1, {}, 'float32'],
        [new Float32Array(4), 2, {}, 'float32x2'],
        [new Float32Array(6), 3, {}, 'float32x3'],
        [new Float32Array(8), 4, {}, 'float32x4'],
        [new Int8Array(8), 2, { stride: 4 }, 'sint8x2'],
        [new Int8Array(8), 2, { stride: 4, normalized: true }, 'snorm8x2'],
        [new Int8Array(8), 4, {}, 'sint8x4'],
        [new Int8Array(8), 4, { normalized: true }, 'snorm8x4'],
        [new Uint8Array(8), 2, { stride: 4 }, 'uint8x2'],
        [new Uint8Array(8), 2, { stride: 4, normalized: true }, 'unorm8x2'],
        [new Uint8ClampedArray(8), 4, {}, 'uint8x4'],
        [new Uint8Array(8), 4, { normalized: true }, 'unorm8x4'],
        [new Int16Array(4), 2, {}, 'sint16x2'],
        [new Int16Array(4), 2, { normalized: true }, 'snorm16x2'],
        [new Int16Array(8), 4, {}, 'sint16x4'],
        [new Int16Array(8), 4, { normalized: true }, 'snorm16x4'],
        [new Uint16Array(4), 2, {}, 'uint16x2'],
        [new Uint16Array(4), 2, { normalized: true }, 'unorm16x2'],
        [new Uint16Array(8), 4, {}, 'uint16x4'],
        [new Uint16Array(8), 4, { normalized: true }, 'unorm16x4'],
        [new Int32Array(2), 1, {}, 'sint32'],
        [new Int32Array(4), 2, {}, 'sint32x2'],
        [new Int32Array(6), 3, {}, 'sint32x3'],
        [new Int32Array(8), 4, {}, 'sint32x4'],
        [new Uint32Array(2), 1, {}, 'uint32'],
        [new Uint32Array(4), 2, {}, 'uint32x2'],
        [new Uint32Array(6), 3, {}, 'uint32x3'],
        [new Uint32Array(8), 4, {}, 'uint32x4']
    ] as const)('maps portable storage case %# to %s', (data, size, params, expectedFormat) => {
        const source = new GeometryData(data, size, params);
        expect(compileOne(source).vertexBuffers[0]?.attributes[0]?.format).toBe(expectedFormat);
    });

    it('returns the same plan on the allocation-free exact hit and ignores content revisions', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const material = materialWith({ a_position: position });
        const mesh = meshWith(position, material);
        const inputs: readonly VertexInputReflection[] = [{ name: 'a_position', location: 0 }];
        const compiler = new VertexInputLayoutCompiler();
        const first = compiler.compile(inputs, mesh, material, capabilities());
        const sort = vi.spyOn(Array.prototype, 'sort');

        expect(compiler.compile(inputs, mesh, material, capabilities())).toBe(first);
        position.setSubData(0, new Float32Array([2, 3, 4]));
        expect(compiler.compile(inputs, mesh, material, capabilities())).toBe(first);
        position.data = new Float32Array(9);
        expect(compiler.compile(inputs, mesh, material, capabilities())).toBe(first);
        expect(sort).not.toHaveBeenCalled();
        sort.mockRestore();
    });

    it('misses on exact layout, reflection, geometry, and public material-binding changes', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const material = materialWith({ a_position: position });
        const mesh = meshWith(position, material);
        const input = { name: 'a_position', location: 0 };
        const inputs: VertexInputReflection[] = [input];
        const compiler = new VertexInputLayoutCompiler();
        let previous = compiler.compile(inputs, mesh, material, capabilities());

        position.stride = 12;
        let current = compiler.compile(inputs, mesh, material, capabilities());
        expect(current).not.toBe(previous);
        expect(compiler.compile(inputs, mesh, material, capabilities())).toBe(current);

        previous = current;
        input.location = 1;
        current = compiler.compile(inputs, mesh, material, capabilities());
        expect(current).not.toBe(previous);

        previous = current;
        material.attributes['a_position'] = binding(position);
        current = compiler.compile(inputs, mesh, material, capabilities());
        expect(current).not.toBe(previous);

        previous = current;
        mesh.geometry = new Geometry({ vertices: position });
        current = compiler.compile(inputs, mesh, material, capabilities());
        expect(current).not.toBe(previous);

        previous = current;
        current = compiler.compile([...inputs], mesh, material, capabilities());
        expect(current).not.toBe(previous);
    });

    it('produces one backend-neutral plan for distinct equal WebGL2 and WebGPU limits', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const material = materialWith({ a_position: position });
        const mesh = meshWith(position, material);
        const inputs: readonly VertexInputReflection[] = [{ name: 'a_position', location: 0 }];
        const compiler = new VertexInputLayoutCompiler();
        const webgl2 = capabilities();
        const webgpu = capabilities();

        const webglPlan = compiler.compile(inputs, mesh, material, webgl2);
        const webgpuPlan = compiler.compile(inputs, mesh, material, webgpu);
        expect(webgpuPlan).toBe(webglPlan);
        expect(webgpuPlan.vertexBuffers).toEqual(webglPlan.vertexBuffers);
    });
});

describe('VertexInputLayoutCompiler validation', () => {
    it('requires unique named reflection with non-overlapping physical locations', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const material = materialWith({ a: position, b: position });
        const mesh = meshWith(position, material);
        const compiler = new VertexInputLayoutCompiler();

        expect(() => compiler.compile([], mesh, material, capabilities())).toThrow(
            /at least one named/u
        );
        expect(() => compiler.compile([{ location: 0 }], mesh, material, capabilities())).toThrow(
            /non-empty reflection name/u
        );
        expect(() =>
            compiler.compile(
                [
                    { name: 'a', location: 0 },
                    { name: 'a', location: 1 }
                ],
                mesh,
                material,
                capabilities()
            )
        ).toThrow(/name a is declared more than once/u);
        expect(() =>
            compiler.compile(
                [
                    { name: 'a', location: 0 },
                    { name: 'b', location: 0 }
                ],
                mesh,
                material,
                capabilities()
            )
        ).toThrow(/overlaps a at shader location 0/u);
        expect(() =>
            compiler.compile(
                [{ name: 'a', location: 0, locationCount: 2 }],
                mesh,
                material,
                capabilities()
            )
        ).toThrow(/type unknown requires 1 shader locations/u);
        expect(() =>
            compiler.compile(
                [{ name: 'a', location: 2 }],
                mesh,
                material,
                capabilities({
                    maxVertexAttributes: 2
                })
            )
        ).toThrow(/occupies locations \[2, 3\).*maxVertexAttributes 2/u);
        expect(() =>
            compiler.compile(
                [
                    { name: 'a', location: 0 },
                    { name: 'b', location: 1 }
                ],
                mesh,
                material,
                capabilities({ maxVertexAttributes: 1 })
            )
        ).toThrow(/exceeding maxVertexAttributes 1/u);

        const matrix = new GeometryData(new Float32Array(9), 9);
        const matrixMaterial = materialWith({ matrix, b: position });
        const matrixMesh = meshWith(position, matrixMaterial);
        expect(() =>
            compiler.compile(
                [
                    { name: 'matrix', type: 'mat3', location: 1, locationCount: 3 },
                    { name: 'b', type: 'vec3', location: 3 }
                ],
                matrixMesh,
                matrixMaterial,
                capabilities()
            )
        ).toThrow(/overlaps matrix at shader location 3/u);
        expect(() =>
            compiler.compile(
                [{ name: 'matrix', type: 'mat3', location: 14, locationCount: 3 }],
                matrixMesh,
                matrixMaterial,
                capabilities()
            )
        ).toThrow(/occupies locations \[14, 17\).*maxVertexAttributes 16/u);
        expect(() =>
            compiler.compile(
                [{ name: 'matrix', type: 'mat3', location: 0, locationCount: 2 }],
                matrixMesh,
                matrixMaterial,
                capabilities()
            )
        ).toThrow(/mat3 requires 3 shader locations/u);
    });

    it('rejects non-GeometryData, unsupported matrix shapes, instancing, and storage pairs', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const invalidMaterial = materialWith({ a: new Float32Array(3) });
        const mesh = meshWith(position, invalidMaterial);
        const compiler = new VertexInputLayoutCompiler();

        expect(() =>
            compiler.compile([{ name: 'a', location: 0 }], mesh, invalidMaterial, capabilities())
        ).toThrow(/must resolve to GeometryData/u);
        expect(() => compileOne(new GeometryData(new Float32Array(18), 9))).toThrow(
            /scalar through vec4|matrix/u
        );
        const matrixMaterial = materialWith({ matrix: new GeometryData(new Float32Array(9), 9) });
        const matrixMesh = meshWith(position, matrixMaterial);
        expect(() =>
            compiler.compile(
                [{ name: 'matrix', type: 'mat2x3', location: 0 }],
                matrixMesh,
                matrixMaterial,
                capabilities()
            )
        ).toThrow(/rectangular.*GeometryData ABI/u);
        const wrongSizeMaterial = materialWith({ matrix: position });
        expect(() =>
            compiler.compile(
                [{ name: 'matrix', type: 'mat3', location: 0 }],
                meshWith(position, wrongSizeMaterial),
                wrongSizeMaterial,
                capabilities()
            )
        ).toThrow(/requires GeometryData size 9/u);
        const integerMatrix = new GeometryData(new Int32Array(9), 9);
        const integerMatrixMaterial = materialWith({ matrix: integerMatrix });
        expect(() =>
            compiler.compile(
                [{ name: 'matrix', type: 'mat3', location: 0 }],
                meshWith(position, integerMatrixMaterial),
                integerMatrixMaterial,
                capabilities()
            )
        ).toThrow(/matrices require Float32 storage/u);
        const float64 = new GeometryData(new Float32Array(6), 3);
        Reflect.set(float64, '_data', new Float64Array(6));
        expect(() => compileOne(float64)).toThrow(/unsupported storage/u);
        expect(() =>
            compileOne(new GeometryData(new Float32Array(6), 3, { normalized: true }))
        ).toThrow(/must not be normalized/u);
        expect(() => compileOne(new GeometryData(new Uint8Array(6), 3))).toThrow(/only x2 or x4/u);
        expect(() =>
            compileOne(new GeometryData(new Uint32Array(4), 2, { normalized: true }))
        ).toThrow(/Normalized 32-bit/u);

        const mismatched = new GeometryData(new Float32Array(6), 3);
        mismatched.type = UNSIGNED_INT;
        expect(() => compileOne(mismatched)).toThrow(/must use the FLOAT/u);

        const material = materialWith({ a: position });
        const instancedMesh = meshWith(position, material);
        instancedMesh.useInstanced = true;
        expect(() =>
            compiler.compile([{ name: 'a', location: 0 }], instancedMesh, material, capabilities())
        ).toThrow(/Instanced vertex inputs/u);

        const instancedPlan = compiler.compile(
            [{ name: 'a', location: 0 }],
            instancedMesh,
            material,
            capabilities(),
            undefined,
            true
        );
        expect(instancedPlan.vertexCount).toBe(3);
        expect(instancedMesh.useInstanced).toBe(true);
    });

    it('enforces portable stride, offset, alignment, and complete-vertex rules', () => {
        expect(() => compileOne(new GeometryData(new Uint8Array(4), 2))).toThrow(
            /stride must be a multiple of 4/u
        );
        expect(() =>
            compileOne(new GeometryData(new Uint16Array(4), 2, { stride: 8, offset: 2 }))
        ).toThrow(/offset must be aligned to 4/u);
        expect(() => compileOne(new GeometryData(new Float32Array(6), 2, { offset: 4 }))).toThrow(
            /non-zero offset with a tightly packed/u
        );
        expect(() =>
            compileOne(new GeometryData(new Float32Array(8), 3, { stride: 12, offset: 4 }))
        ).toThrow(/exceeds its vertex array stride/u);
        expect(() => compileOne(new GeometryData(new Float32Array(6), 3, { stride: 16 }))).toThrow(
            /whole number of complete vertices/u
        );

        const source = new GeometryData(new Float32Array(8), 4);
        const material = materialWith({ a: source });
        const mesh = meshWith(source, material);
        expect(() =>
            new VertexInputLayoutCompiler().compile(
                [{ name: 'a', location: 0 }],
                mesh,
                material,
                capabilities({ maxVertexBufferArrayStride: 12 })
            )
        ).toThrow(/exceeds maxVertexBufferArrayStride 12/u);
    });

    it('requires equal per-vertex counts and enough unique vertex-buffer slots', () => {
        const position = new GeometryData(new Float32Array(9), 3);
        const uv = new GeometryData(new Float32Array(4), 2);
        const material = materialWith({ position, uv });
        const mesh = meshWith(position, material);
        const inputs: readonly VertexInputReflection[] = [
            { name: 'position', location: 0 },
            { name: 'uv', location: 1 }
        ];
        const compiler = new VertexInputLayoutCompiler();

        expect(() => compiler.compile(inputs, mesh, material, capabilities())).toThrow(
            /same vertex count/u
        );

        uv.data = new Float32Array(6);
        expect(() =>
            compiler.compile(inputs, mesh, material, capabilities({ maxVertexBuffers: 1 }))
        ).toThrow(/exceeding maxVertexBuffers 1/u);
    });

    it('merges distinct GeometryData aliases over one exact interleaved byte range', () => {
        const storage = new ArrayBuffer(48);
        const position = new GeometryData(new Float32Array(storage), 2, {
            bufferViewId: 'shared',
            stride: 16,
            offset: 0
        });
        const uv = new GeometryData(new Float32Array(storage), 2, {
            bufferViewId: 'shared',
            stride: 16,
            offset: 8
        });
        const material = materialWith({ position, uv });
        const mesh = meshWith(position, material);
        const inputs: readonly VertexInputReflection[] = [
            { name: 'position', location: 0 },
            { name: 'uv', location: 1 }
        ];
        const compiler = new VertexInputLayoutCompiler();
        const plan = compiler.compile(inputs, mesh, material, capabilities());

        expect(plan.streams).toHaveLength(1);
        expect(plan.streams[0]?.source).toBe(position);
        expect(plan.streams[0]?.sources).toEqual([position, uv]);
        expect(Object.isFrozen(plan.streams[0]?.sources)).toBe(true);
        expect(plan.streams[0]?.layout).toEqual({
            arrayStride: 16,
            stepMode: 'vertex',
            attributes: [
                { format: 'float32x2', offset: 0, shaderLocation: 0 },
                { format: 'float32x2', offset: 8, shaderLocation: 1 }
            ]
        });

        uv.data = new Float32Array(12);
        expect(() => compiler.compile(inputs, mesh, material, capabilities())).toThrow(
            /exact same underlying byte range/u
        );
    });

    it('rejects one bufferViewId across different storage ranges or effective strides', () => {
        const position = new GeometryData(new Float32Array(12), 3, {
            bufferViewId: 'shared',
            stride: 16,
            offset: 0
        });
        const differentStorage = new GeometryData(new Float32Array(12), 2, {
            bufferViewId: 'shared',
            stride: 16,
            offset: 8
        });
        const material = materialWith({ position, uv: differentStorage });
        const mesh = meshWith(position, material);
        const inputs: readonly VertexInputReflection[] = [
            { name: 'position', location: 0 },
            { name: 'uv', location: 1 }
        ];
        const compiler = new VertexInputLayoutCompiler();

        expect(() => compiler.compile(inputs, mesh, material, capabilities())).toThrow(
            /exact same underlying byte range/u
        );

        const sharedStorage = new Float32Array(12);
        const stride16 = new GeometryData(sharedStorage, 3, {
            bufferViewId: 'stride-shared',
            stride: 16,
            offset: 0
        });
        const stride12 = new GeometryData(sharedStorage, 2, {
            bufferViewId: 'stride-shared',
            stride: 12,
            offset: 4
        });
        const strideMaterial = materialWith({ position: stride16, uv: stride12 });

        expect(() =>
            compiler.compile(
                inputs,
                meshWith(stride16, strideMaterial),
                strideMaterial,
                capabilities()
            )
        ).toThrow(/same effective array stride/u);
    });
});
