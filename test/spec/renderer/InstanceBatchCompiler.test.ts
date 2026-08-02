import { describe, expect, it, vi } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import BasicMaterial from '../../../src/material/BasicMaterial';
import type Material from '../../../src/material/MaterialInstance';
import type {
    MaterialBindingInfo,
    MaterialBindingMap,
    ProgramBindingInfo
} from '../../../src/material/MaterialInstance';
import {
    InstanceBatchCompiler,
    type InstanceBatchCompilerCapabilities,
    type InstanceBatchVertexInputReflection
} from '../../../src/render/renderer/InstanceBatchCompiler';
import {
    instanceBlockLayout,
    MAX_INSTANCES_PER_DRAW
} from '../../../src/render/ubo/BuiltInUniformBlocks';

interface InstanceValues {
    scalar: unknown;
    vec2: unknown;
    vec3: unknown;
    vec4: unknown;
    mat2: unknown;
    mat3: unknown;
    mat4: unknown;
}

const values = new WeakMap<Mesh, InstanceValues>();

function capabilities(
    overrides: Partial<InstanceBatchCompilerCapabilities['limits']> = {}
): InstanceBatchCompilerCapabilities {
    return {
        limits: {
            maxVertexAttributes: overrides.maxVertexAttributes ?? 32,
            maxVertexBuffers: overrides.maxVertexBuffers ?? 8,
            maxVertexBufferArrayStride: overrides.maxVertexBufferArrayStride ?? 2048
        }
    };
}

function valueBinding(key: keyof InstanceValues): MaterialBindingInfo {
    return {
        isDependMesh: true,
        get(mesh): unknown {
            return values.get(mesh)?.[key];
        }
    };
}

function customUniforms(): MaterialBindingMap {
    return {
        i_scalar: valueBinding('scalar'),
        i_vec2: valueBinding('vec2'),
        i_vec3: valueBinding('vec3'),
        i_vec4: valueBinding('vec4'),
        i_mat2: valueBinding('mat2'),
        i_mat3: valueBinding('mat3'),
        i_mat4: valueBinding('mat4')
    };
}

function createFixture(count = 2): {
    material: Material;
    geometry: Geometry;
    meshes: Mesh[];
} {
    const vertices = new GeometryData(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3);
    const geometry = new Geometry({ vertices });
    const material = new BasicMaterial();
    Object.assign(material.uniforms, customUniforms());
    const meshes = new Array<Mesh>(count);
    for (let index = 0; index < count; index += 1) {
        const mesh = new Mesh({ geometry, material, useInstanced: true });
        mesh.name = `instance-${String(index)}`;
        values.set(mesh, {
            scalar: index + 0.25,
            vec2: new Float32Array([index + 1, index + 2]),
            vec3: [index + 3, index + 4, index + 5],
            vec4: { elements: new Float32Array([index + 6, index + 7, index + 8, index + 9]) },
            mat2: [index + 10, index + 11, index + 12, index + 13],
            mat3: new Float32Array([
                index + 14,
                index + 15,
                index + 16,
                index + 17,
                index + 18,
                index + 19,
                index + 20,
                index + 21,
                index + 22
            ]),
            mat4: new Float32Array(16).fill(index + 23)
        });
        meshes[index] = mesh;
    }
    meshes[1]?.worldMatrix.set(2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5, 0, 0, 0, 0, 1);
    return { material, geometry, meshes };
}

function input(
    name: string,
    type: string,
    location: number,
    locationCount?: number
): InstanceBatchVertexInputReflection {
    return locationCount === undefined
        ? { name, type, location }
        : { name, type, location, locationCount };
}

const POSITION_INPUT = input('a_position', 'vec3', 0, 1);
const CUSTOM_INPUTS: readonly InstanceBatchVertexInputReflection[] = [
    POSITION_INPUT,
    input('i_scalar', 'float', 1, 1),
    input('i_mat2', 'mat2', 2)
];

function floatData(source: GeometryData): Float32Array {
    if (!(source.data instanceof Float32Array)) throw new Error('Expected Float32 instance data');
    return source.data;
}

function blockFloats(buffer: { data: ArrayBuffer }): Float32Array {
    return new Float32Array(buffer.data);
}

function required<Value>(value: Value | null | undefined, description: string): Value {
    if (value === null || value === undefined)
        throw new Error(`Test fixture has no ${description}`);
    return value;
}

function meshAt(meshes: readonly Mesh[], index: number): Mesh {
    return required(meshes[index], `mesh at index ${String(index)}`);
}

describe('InstanceBatchCompiler WebGL2 planning', () => {
    it('packs built-in parity and every supported reflected instance shape into matrix columns', () => {
        const { material, meshes } = createFixture();
        const owner = {};
        const inputs: readonly InstanceBatchVertexInputReflection[] = [
            POSITION_INPUT,
            input('u_modelMatrix', 'mat4', 1),
            input('u_normalWorldMatrix', 'mat3', 5),
            input('i_scalar', 'float', 8, 1),
            input('i_vec2', 'vec2', 9, 1),
            input('i_vec3', 'vec3', 10, 1),
            input('i_vec4', 'vec4', 11, 1),
            input('i_mat2', 'mat2', 12),
            input('i_mat3', 'mat3', 14),
            input('i_mat4', 'mat4', 17)
        ];

        const plan = new InstanceBatchCompiler().compile(
            owner,
            meshes,
            material,
            inputs,
            'webgl2',
            capabilities()
        );
        const stream = required(plan.webGLInstance, 'WebGL instance stream');

        expect(plan.owner).toBe(owner);
        expect(plan.backend).toBe('webgl2');
        expect(plan.perVertexInputs).toEqual([POSITION_INPUT]);
        expect(plan.perVertexBufferCount).toBe(1);
        expect(plan.requiredVertexBufferCount).toBe(2);
        expect(plan.instanceCount).toBe(2);
        expect(plan.webGPUInstanceBlock).toBeNull();
        expect(stream).toBe(plan.instanceVertexStream);
        expect(stream.slot).toBe(1);
        expect(stream.capacity).toBe(2);
        expect(stream.layout.arrayStride).toBe(256);
        expect(stream.layout.stepMode).toBe('instance');
        expect(stream.layout.attributes).toEqual([
            { format: 'float32x4', offset: 0, shaderLocation: 1 },
            { format: 'float32x4', offset: 16, shaderLocation: 2 },
            { format: 'float32x4', offset: 32, shaderLocation: 3 },
            { format: 'float32x4', offset: 48, shaderLocation: 4 },
            { format: 'float32x3', offset: 64, shaderLocation: 5 },
            { format: 'float32x3', offset: 76, shaderLocation: 6 },
            { format: 'float32x3', offset: 88, shaderLocation: 7 },
            { format: 'float32', offset: 100, shaderLocation: 8 },
            { format: 'float32x2', offset: 104, shaderLocation: 9 },
            { format: 'float32x3', offset: 112, shaderLocation: 10 },
            { format: 'float32x4', offset: 124, shaderLocation: 11 },
            { format: 'float32x2', offset: 140, shaderLocation: 12 },
            { format: 'float32x2', offset: 148, shaderLocation: 13 },
            { format: 'float32x3', offset: 156, shaderLocation: 14 },
            { format: 'float32x3', offset: 168, shaderLocation: 15 },
            { format: 'float32x3', offset: 180, shaderLocation: 16 },
            { format: 'float32x4', offset: 192, shaderLocation: 17 },
            { format: 'float32x4', offset: 208, shaderLocation: 18 },
            { format: 'float32x4', offset: 224, shaderLocation: 19 },
            { format: 'float32x4', offset: 240, shaderLocation: 20 }
        ]);

        const data = floatData(stream.source);
        expect(Array.from(data.slice(0, 16))).toEqual([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
        ]);
        expect(Array.from(data.slice(16, 25))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        expect(Array.from(data.slice(25, 39))).toEqual([
            0.25, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
        ]);
        expect(Array.from(data.slice(64, 80))).toEqual([
            2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5, 0, 0, 0, 0, 1
        ]);
        expect(Array.from(data.slice(80, 89))).toEqual([
            0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.20000000298023224
        ]);
    });

    it('uses the exact unique per-vertex stream count as the append slot', () => {
        const { material, meshes, geometry } = createFixture(1);
        const shared = required(geometry.vertices, 'vertex source');
        material.attributes['a_sharedPosition'] = {
            get() {
                return shared;
            }
        };
        const inputs = [
            POSITION_INPUT,
            input('a_sharedPosition', 'vec3', 4, 1),
            input('i_scalar', 'float', 7, 1)
        ];

        const plan = new InstanceBatchCompiler().compile(
            {},
            meshes,
            material,
            inputs,
            'webgl2',
            capabilities({ maxVertexBuffers: 2 })
        );

        expect(plan.perVertexInputs).toEqual([POSITION_INPUT, inputs[1]]);
        expect(plan.perVertexBufferCount).toBe(1);
        expect(plan.instanceVertexStream?.slot).toBe(1);
        expect(plan.requiredVertexBufferCount).toBe(2);
    });

    it('counts exact interleaved GeometryData aliases as one per-vertex stream', () => {
        const { material, meshes } = createFixture(1);
        const storage = new Float32Array(15);
        const position = new GeometryData(storage, 3, {
            bufferViewId: 'instanced-interleaved',
            stride: 20,
            offset: 0
        });
        const uv = new GeometryData(storage, 2, {
            bufferViewId: 'instanced-interleaved',
            stride: 20,
            offset: 12
        });
        const mesh = meshAt(meshes, 0);
        mesh.geometry = new Geometry({ vertices: position, uvs: uv });
        material.attributes['a_position'] = { get: () => position };
        material.attributes['a_uv'] = { get: () => uv };

        const plan = new InstanceBatchCompiler().compile(
            {},
            meshes,
            material,
            [
                input('a_position', 'vec3', 0, 1),
                input('a_uv', 'vec2', 1, 1),
                input('i_scalar', 'float', 2, 1)
            ],
            'webgl2',
            capabilities({ maxVertexBuffers: 2 })
        );

        expect(plan.perVertexBufferCount).toBe(1);
        expect(plan.instanceVertexStream?.slot).toBe(1);
        expect(plan.requiredVertexBufferCount).toBe(2);
    });

    it.each(['webgl2', 'webgpu'] as const)(
        'preserves per-vertex matrix reflection and appends the %s instance stream after it',
        backend => {
            const { material, meshes } = createFixture(1);
            const matrix = new GeometryData(new Float32Array(27), 9);
            material.attributes['a_basis'] = { get: () => matrix };
            const inputs = [
                POSITION_INPUT,
                input('a_basis', 'mat3', 1, 3),
                input('i_scalar', 'float', 4, 1)
            ] as const;

            const plan = new InstanceBatchCompiler().compile(
                {},
                meshes,
                material,
                inputs,
                backend,
                capabilities({ maxVertexBuffers: 3 })
            );

            expect(plan.perVertexInputs).toEqual([POSITION_INPUT, inputs[1]]);
            expect(plan.perVertexBufferCount).toBe(2);
            expect(plan.instanceVertexStream?.slot).toBe(2);
            expect(plan.requiredVertexBufferCount).toBe(3);
            expect(plan.instanceVertexStream?.layout).toEqual({
                arrayStride: 4,
                stepMode: 'instance',
                attributes: [{ format: 'float32', offset: 0, shaderLocation: 4 }]
            });
        }
    );
});

describe('InstanceBatchCompiler WebGPU planning', () => {
    it('emits a custom instance stream and fills the fixed model/normal mat4 ABI', () => {
        const { material, meshes } = createFixture();
        const plan = new InstanceBatchCompiler().compile(
            {},
            meshes,
            material,
            CUSTOM_INPUTS,
            'webgpu',
            capabilities()
        );

        expect(plan.webGLInstance).toBeNull();
        expect(plan.instanceVertexStream?.layout).toEqual({
            arrayStride: 20,
            stepMode: 'instance',
            attributes: [
                { format: 'float32', offset: 0, shaderLocation: 1 },
                { format: 'float32x2', offset: 4, shaderLocation: 2 },
                { format: 'float32x2', offset: 12, shaderLocation: 3 }
            ]
        });
        const instanceStream = required(plan.instanceVertexStream, 'WebGPU custom instance stream');
        expect(Array.from(floatData(instanceStream.source).slice(0, 10))).toEqual([
            0.25, 10, 11, 12, 13, 1.25, 11, 12, 13, 14
        ]);

        const block = plan.webGPUInstanceBlock;
        expect(block?.layout).toBe(instanceBlockLayout);
        const packed = blockFloats(required(block, 'WebGPU InstanceBlock'));
        const modelOffset = instanceBlockLayout.fields.u_instanceModelMatrices.offset / 4;
        const previousModelOffset =
            instanceBlockLayout.fields.u_previousInstanceModelMatrices.offset / 4;
        const normalOffset = instanceBlockLayout.fields.u_instanceNormalMatrices.offset / 4;
        expect(Array.from(packed.slice(modelOffset, modelOffset + 16))).toEqual([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
        ]);
        expect(Array.from(packed.slice(modelOffset + 16, modelOffset + 32))).toEqual([
            2, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5, 0, 0, 0, 0, 1
        ]);
        expect(Array.from(packed.slice(normalOffset, normalOffset + 16))).toEqual([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
        ]);
        expect(Array.from(packed.slice(normalOffset + 16, normalOffset + 32))).toEqual([
            0.5, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.20000000298023224, 0, 0, 0, 0, 1
        ]);
        expect(Array.from(packed.slice(modelOffset + 32, previousModelOffset))).toEqual(
            new Array(previousModelOffset - modelOffset - 32).fill(0)
        );
        expect(Array.from(packed.slice(previousModelOffset, previousModelOffset + 32))).toEqual(
            Array.from(packed.slice(modelOffset, modelOffset + 32))
        );
        expect(Array.from(packed.slice(previousModelOffset + 32, normalOffset))).toEqual(
            new Array(normalOffset - previousModelOffset - 32).fill(0)
        );
        expect(Array.from(packed.slice(normalOffset + 32))).toEqual(
            new Array(packed.length - normalOffset - 32).fill(0)
        );
    });

    it('forwards the exact program info to custom mesh-dependent bindings', () => {
        const { geometry } = createFixture(1);
        const seen = vi.fn();
        const material = new BasicMaterial();
        material.uniforms['i_value'] = {
            isDependMesh: true,
            get(_mesh, _material, programInfo): number {
                seen(programInfo);
                return 3;
            }
        };
        const mesh = new Mesh({ geometry, material, useInstanced: true });
        const programInfo: ProgramBindingInfo = { name: 'prepared-program' };

        new InstanceBatchCompiler().compile(
            {},
            [mesh],
            material,
            [POSITION_INPUT, input('i_value', 'float', 1, 1)],
            'webgpu',
            capabilities(),
            programInfo
        );

        expect(seen).toHaveBeenCalledOnce();
        expect(seen).toHaveBeenCalledWith(programInfo);
    });
});

describe('InstanceBatchCompiler revisions and high-water storage', () => {
    it('keeps plan/resources/allocation counters stable and observes value, order, and count changes', () => {
        const { material, geometry, meshes } = createFixture();
        const compiler = new InstanceBatchCompiler();
        const owner = {};
        const first = compiler.compile(
            owner,
            meshes,
            material,
            CUSTOM_INPUTS,
            'webgpu',
            capabilities()
        );
        const stream = required(first.instanceVertexStream, 'stable instance stream');
        const source = stream.source;
        const layout = stream.layout;
        const block = required(first.webGPUInstanceBlock, 'stable InstanceBlock');
        const layoutRevision = first.layoutRevision;
        const resourceRevision = first.resourceRevision;
        const sourceRevision = source.revision;
        const blockRevision = block.revision;
        const storageAllocations = compiler.diagnostics.storageAllocationCount;
        const resolvedCapacity = compiler.diagnostics.resolvedInputCapacity;

        for (let iteration = 0; iteration < 32; iteration += 1) {
            const stable = compiler.compile(
                owner,
                meshes,
                material,
                CUSTOM_INPUTS,
                'webgpu',
                capabilities()
            );
            expect(stable).toBe(first);
            expect(stable.instanceVertexStream).toBe(stream);
            expect(stable.instanceVertexStream?.source).toBe(source);
            expect(stable.instanceVertexStream?.layout).toBe(layout);
            expect(stable.webGPUInstanceBlock).toBe(block);
        }
        expect(first.layoutRevision).toBe(layoutRevision);
        expect(first.resourceRevision).toBe(resourceRevision);
        expect(source.revision).toBe(sourceRevision);
        expect(block.revision).toBe(blockRevision);
        expect(compiler.diagnostics.storageAllocationCount).toBe(storageAllocations);
        expect(compiler.diagnostics.resolvedInputCapacity).toBe(resolvedCapacity);

        const firstMesh = meshAt(meshes, 0);
        const secondMesh = meshAt(meshes, 1);
        const secondValues = required(values.get(secondMesh), 'second mesh values');
        secondValues.scalar = 99;
        secondMesh.worldMatrix.set(3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 5, 0, 0, 0, 0, 1);
        compiler.compile(owner, meshes, material, CUSTOM_INPUTS, 'webgpu', capabilities());
        expect(first.layoutRevision).toBe(layoutRevision);
        expect(first.resourceRevision).toBe(resourceRevision + 1);
        expect(floatData(source)[5]).toBe(99);
        expect(source.revision).toBeGreaterThan(sourceRevision);
        expect(block.revision).toBeGreaterThan(blockRevision);

        compiler.compile(
            owner,
            [secondMesh, firstMesh],
            material,
            CUSTOM_INPUTS,
            'webgpu',
            capabilities()
        );
        expect(first.resourceRevision).toBe(resourceRevision + 2);
        expect(floatData(source)[0]).toBe(99);

        compiler.compile(owner, [firstMesh], material, CUSTOM_INPUTS, 'webgpu', capabilities());
        expect(first.instanceCount).toBe(1);
        expect(first.instanceVertexStream?.capacity).toBe(2);
        const packed = blockFloats(block);
        const secondModel = instanceBlockLayout.fields.u_instanceModelMatrices.offset / 4 + 16;
        expect(Array.from(packed.slice(secondModel, secondModel + 16))).toEqual(
            new Array(16).fill(0)
        );

        const third = new Mesh({ geometry, material, useInstanced: true });
        third.name = 'instance-2';
        values.set(third, {
            scalar: 2.25,
            vec2: [3, 4],
            vec3: [5, 6, 7],
            vec4: [8, 9, 10, 11],
            mat2: [12, 13, 14, 15],
            mat3: new Float32Array(9).fill(16),
            mat4: new Float32Array(16).fill(17)
        });
        const beforeGrowth = compiler.diagnostics.storageAllocationCount;
        compiler.compile(
            owner,
            [firstMesh, secondMesh, third],
            material,
            CUSTOM_INPUTS,
            'webgpu',
            capabilities()
        );
        expect(first.instanceVertexStream?.source).toBe(source);
        expect(first.instanceVertexStream?.capacity).toBe(4);
        expect(compiler.diagnostics.maxInstanceCapacity).toBe(4);
        expect(compiler.diagnostics.storageAllocationCount).toBeGreaterThan(beforeGrowth);
        const afterGrowth = compiler.diagnostics.storageAllocationCount;

        compiler.compile(owner, [firstMesh], material, CUSTOM_INPUTS, 'webgpu', capabilities());
        compiler.compile(
            owner,
            [firstMesh, secondMesh, third],
            material,
            CUSTOM_INPUTS,
            'webgpu',
            capabilities()
        );
        expect(compiler.diagnostics.storageAllocationCount).toBe(afterGrowth);
    });

    it('increments layout revision without replacing the stable plan or GeometryData owner', () => {
        const { material, meshes } = createFixture(1);
        const compiler = new InstanceBatchCompiler();
        const owner = {};
        const plan = compiler.compile(
            owner,
            meshes,
            material,
            CUSTOM_INPUTS,
            'webgl2',
            capabilities()
        );
        const initialStream = required(plan.instanceVertexStream, 'initial instance stream');
        const source = initialStream.source;
        const previousLayout = initialStream.layout;
        const layoutRevision = plan.layoutRevision;
        const movedInputs = [POSITION_INPUT, input('i_scalar', 'float', 5, 1)];

        const updated = compiler.compile(
            owner,
            meshes,
            material,
            movedInputs,
            'webgl2',
            capabilities()
        );

        expect(updated).toBe(plan);
        expect(updated.instanceVertexStream?.source).toBe(source);
        expect(updated.instanceVertexStream?.layout).not.toBe(previousLayout);
        expect(updated.instanceVertexStream?.layout.attributes[0]?.shaderLocation).toBe(5);
        expect(updated.layoutRevision).toBe(layoutRevision + 1);
    });
});

describe('InstanceBatchCompiler atomic validation', () => {
    it('does not mutate a valid plan, stream, or InstanceBlock after binding/layout failure', () => {
        const { material, meshes } = createFixture();
        const compiler = new InstanceBatchCompiler();
        const owner = {};
        const plan = compiler.compile(
            owner,
            meshes,
            material,
            CUSTOM_INPUTS,
            'webgpu',
            capabilities()
        );
        const source = required(plan.instanceVertexStream, 'atomic instance stream').source;
        const block = required(plan.webGPUInstanceBlock, 'atomic InstanceBlock');
        const sourceBytes = Array.from(floatData(source));
        const blockBytes = Array.from(new Uint8Array(block.data));
        const sourceRevision = source.revision;
        const blockRevision = block.revision;
        const layoutRevision = plan.layoutRevision;
        const resourceRevision = plan.resourceRevision;
        const instanceCount = plan.instanceCount;

        required(values.get(meshAt(meshes, 1)), 'second mesh values').scalar = [1, 2];
        expect(() =>
            compiler.compile(owner, meshes, material, CUSTOM_INPUTS, 'webgpu', capabilities())
        ).toThrow(/exactly 1 numeric values/u);
        expect(plan.layoutRevision).toBe(layoutRevision);
        expect(plan.resourceRevision).toBe(resourceRevision);
        expect(plan.instanceCount).toBe(instanceCount);
        expect(source.revision).toBe(sourceRevision);
        expect(block.revision).toBe(blockRevision);
        expect(Array.from(floatData(source))).toEqual(sourceBytes);
        expect(Array.from(new Uint8Array(block.data))).toEqual(blockBytes);

        expect(() =>
            compiler.compile(
                owner,
                meshes,
                material,
                [POSITION_INPUT, input('i_scalar', 'float', 0, 1)],
                'webgpu',
                capabilities()
            )
        ).toThrow(/overlaps/u);
        expect(plan.layoutRevision).toBe(layoutRevision);
        expect(plan.resourceRevision).toBe(resourceRevision);
        expect(Array.from(floatData(source))).toEqual(sourceBytes);
        expect(Array.from(new Uint8Array(block.data))).toEqual(blockBytes);
    });

    it('rejects invalid owners, batches, reflection, bindings, and portable limits', () => {
        const { material, geometry, meshes } = createFixture();
        const compiler = new InstanceBatchCompiler();
        const owner = {};

        expect(() =>
            compiler.compile(owner, [], material, CUSTOM_INPUTS, 'webgl2', capabilities())
        ).toThrow(/at least one mesh/u);
        expect(() =>
            compiler.compile(
                null as unknown as object,
                meshes,
                material,
                CUSTOM_INPUTS,
                'webgl2',
                capabilities()
            )
        ).toThrow(/non-null object owner/u);
        expect(() =>
            compiler.compile(
                owner,
                [meshAt(meshes, 0), meshAt(meshes, 0)],
                material,
                CUSTOM_INPUTS,
                'webgl2',
                capabilities()
            )
        ).toThrow(/more than once/u);

        const direct = new Mesh({ geometry, material });
        expect(() =>
            compiler.compile(owner, [direct], material, CUSTOM_INPUTS, 'webgl2', capabilities())
        ).toThrow(/opted into instancing/u);

        const otherMaterial = new BasicMaterial();
        const wrongMaterial = new Mesh({ geometry, material: otherMaterial, useInstanced: true });
        expect(() =>
            compiler.compile(
                owner,
                [wrongMaterial],
                material,
                CUSTOM_INPUTS,
                'webgl2',
                capabilities()
            )
        ).toThrow(/batch material/u);

        const wrongGeometry = new Mesh({
            geometry: new Geometry({ vertices: geometry.vertices }),
            material,
            useInstanced: true
        });
        expect(() =>
            compiler.compile(
                owner,
                [meshAt(meshes, 0), wrongGeometry],
                material,
                CUSTOM_INPUTS,
                'webgl2',
                capabilities()
            )
        ).toThrow(/same geometry/u);

        expect(() =>
            compiler.compile(
                owner,
                meshes,
                material,
                [POSITION_INPUT, input('missing', 'float', 1, 1)],
                'webgl2',
                capabilities()
            )
        ).toThrow(/neither a per-vertex attribute/u);
        expect(() =>
            compiler.compile(
                owner,
                meshes,
                material,
                [POSITION_INPUT, input('i_scalar', 'int', 1, 1)],
                'webgl2',
                capabilities()
            )
        ).toThrow(/unsupported reflected type/u);
        expect(() =>
            compiler.compile(
                owner,
                meshes,
                material,
                [POSITION_INPUT, input('i_mat2', 'mat2', 1, 1)],
                'webgl2',
                capabilities()
            )
        ).toThrow(/requires 2 shader locations/u);
        expect(() =>
            compiler.compile(
                owner,
                meshes,
                material,
                [POSITION_INPUT, input('i_mat4', 'mat4', 14)],
                'webgl2',
                capabilities({ maxVertexAttributes: 16 })
            )
        ).toThrow(/exceeding maxVertexAttributes 16/u);
        expect(() =>
            compiler.compile(
                owner,
                meshes,
                material,
                [POSITION_INPUT, input('i_scalar', 'float', 1, 1)],
                'webgl2',
                capabilities({ maxVertexBuffers: 1 })
            )
        ).toThrow(/exceeding maxVertexBuffers 1/u);
        expect(() =>
            compiler.compile(
                owner,
                meshes,
                material,
                [POSITION_INPUT, input('i_vec4', 'vec4', 1, 1)],
                'webgl2',
                capabilities({ maxVertexBufferArrayStride: 12 })
            )
        ).toThrow(/stride 16 exceeds/u);
        expect(() =>
            compiler.compile(
                owner,
                meshes,
                material,
                [POSITION_INPUT, input('u_modelMatrix', 'mat4', 1)],
                'webgpu',
                capabilities()
            )
        ).toThrow(/must be supplied by InstanceBlock/u);
        expect(compiler.hasOwner(owner)).toBe(false);
    });

    it('rejects more than the fixed ABI instance capacity before creating an owner', () => {
        const { material, geometry } = createFixture(1);
        const meshes = new Array<Mesh>(MAX_INSTANCES_PER_DRAW + 1);
        for (let index = 0; index < meshes.length; index += 1) {
            meshes[index] = new Mesh({ geometry, material, useInstanced: true });
        }
        const compiler = new InstanceBatchCompiler();
        const owner = {};

        expect(() =>
            compiler.compile(owner, meshes, material, CUSTOM_INPUTS, 'webgpu', capabilities())
        ).toThrow(/MAX_INSTANCES_PER_DRAW/u);
        expect(compiler.hasOwner(owner)).toBe(false);
    });
});

describe('InstanceBatchCompiler lifecycle', () => {
    it('detaches both backend records atomically and resets all active owners', () => {
        const { material, meshes } = createFixture();
        const compiler = new InstanceBatchCompiler();
        const owner = {};
        const webgl = compiler.compile(
            owner,
            meshes,
            material,
            CUSTOM_INPUTS,
            'webgl2',
            capabilities()
        );
        const webgpu = compiler.compile(
            owner,
            meshes,
            material,
            CUSTOM_INPUTS,
            'webgpu',
            capabilities()
        );

        expect(compiler.diagnostics.activeOwnerCount).toBe(1);
        expect(compiler.diagnostics.activePlanCount).toBe(2);
        expect(compiler.hasOwner(owner)).toBe(true);
        expect(compiler.detach(owner)).toBe(true);
        expect(compiler.detach(owner)).toBe(false);
        expect(compiler.hasOwner(owner)).toBe(false);
        expect(compiler.diagnostics.activeOwnerCount).toBe(0);
        expect(compiler.diagnostics.activePlanCount).toBe(0);
        expect(webgl.owner).toBeNull();
        expect(webgl.instanceCount).toBe(0);
        expect(webgl.instanceVertexStream).toBeNull();
        expect(webgl.layoutRevision).toBe(0);
        expect(webgpu.owner).toBeNull();
        expect(webgpu.webGPUInstanceBlock).toBeNull();

        const replacement = compiler.compile(
            owner,
            meshes,
            material,
            CUSTOM_INPUTS,
            'webgpu',
            capabilities()
        );
        expect(replacement).not.toBe(webgpu);
        expect(replacement.owner).toBe(owner);
        const otherOwner = {};
        compiler.compile(otherOwner, meshes, material, CUSTOM_INPUTS, 'webgl2', capabilities());
        expect(compiler.diagnostics.activeOwnerCount).toBe(2);

        compiler.reset();
        expect(compiler.diagnostics.activeOwnerCount).toBe(0);
        expect(compiler.diagnostics.activePlanCount).toBe(0);
        expect(compiler.hasOwner(owner)).toBe(false);
        expect(compiler.hasOwner(otherOwner)).toBe(false);
        expect(replacement.owner).toBeNull();
    });
});
