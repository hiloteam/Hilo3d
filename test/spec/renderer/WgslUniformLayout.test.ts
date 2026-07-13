import { describe, expect, it } from 'vitest';
import {
    createStd140Layout,
    type Std140MatrixType,
    type Std140Type
} from '../../../src/renderer/ubo/Std140Layout';
import {
    createWgslUniformLayout,
    makeWgslUniformLayoutsPortable
} from '../../../src/renderer/webgpu/WgslUniformLayout';

describe('WgslUniformLayout', () => {
    it('preserves the public std140 offsets and strides for portable WGSL', () => {
        const std140 = createStd140Layout({
            head: 'float',
            pairs: { type: 'vec2', arrayLength: 2 },
            basis: 'mat3x2',
            weights: { type: 'float', arrayLength: 3 },
            direction: 'vec3',
            tail: 'uint'
        });
        const layout = createWgslUniformLayout(std140);

        expect(layout.fields.head).toMatchObject({ offset: 0, alignment: 4, byteLength: 4 });
        expect(layout.fields.pairs).toMatchObject({
            offset: 16,
            alignment: 16,
            arrayStride: 16,
            byteLength: 32
        });
        expect(layout.fields.basis).toMatchObject({
            offset: 48,
            alignment: 16,
            matrixStride: 16,
            byteLength: 48
        });
        expect(layout.fields.weights).toMatchObject({
            offset: 96,
            alignment: 16,
            arrayStride: 16,
            byteLength: 48
        });
        expect(layout.fields.direction).toMatchObject({
            offset: 144,
            alignment: 16,
            byteLength: 12
        });
        expect(layout.fields.tail.offset).toBe(156);
        expect(layout.alignment).toBe(16);
        expect(layout.byteLength).toBe(160);
        expect(layout.byteLength).toBe(std140.byteLength);
    });

    it('copies float, signed and unsigned arrays without changing std140 padding', () => {
        const std140 = createStd140Layout({
            floatValues: { type: 'float', arrayLength: 3 },
            signedValues: { type: 'ivec2', arrayLength: 2 },
            matrices: { type: 'mat3x2', arrayLength: 2 },
            unsignedValues: { type: 'uvec3', arrayLength: 2 }
        });
        const source = std140.createBuffer({
            floatValues: [1.5, -2.25, 3.75],
            signedValues: [-1, 2, -3, 4],
            matrices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            unsignedValues: [10, 11, 12, 13, 14, 15]
        });
        const layout = createWgslUniformLayout(std140);
        const target = new DataView(layout.transcode(source));

        expect(layout.fields.floatValues).toMatchObject({ offset: 0, arrayStride: 16 });
        expect([0, 16, 32].map(offset => target.getFloat32(offset, true))).toEqual([
            1.5, -2.25, 3.75
        ]);
        expect(target.getUint32(4, true)).toBe(0);

        expect(layout.fields.signedValues).toMatchObject({ offset: 48, arrayStride: 16 });
        expect([48, 52, 64, 68].map(offset => target.getInt32(offset, true))).toEqual([
            -1, 2, -3, 4
        ]);

        expect(layout.fields.matrices).toMatchObject({
            offset: 80,
            matrixStride: 16,
            arrayStride: 48
        });
        expect(
            [80, 84, 96, 100, 112, 116, 128, 132, 144, 148, 160, 164].map(offset =>
                target.getFloat32(offset, true)
            )
        ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

        expect(layout.fields.unsignedValues).toMatchObject({ offset: 176, arrayStride: 16 });
        expect(
            [176, 180, 184, 192, 196, 200].map(offset => target.getUint32(offset, true))
        ).toEqual([10, 11, 12, 13, 14, 15]);
    });

    const matrixCases: readonly (readonly [Std140MatrixType, number, number])[] = [
        ['mat2', 2, 2],
        ['mat3', 3, 3],
        ['mat4', 4, 4],
        ['mat2x3', 2, 3],
        ['mat2x4', 2, 4],
        ['mat3x2', 3, 2],
        ['mat3x4', 3, 4],
        ['mat4x2', 4, 2],
        ['mat4x3', 4, 3]
    ];

    it.each(matrixCases)('transcodes arrays of every matrix shape: %s', (type, columns, rows) => {
        const std140 = createStd140Layout({ matrices: { type, arrayLength: 2 } });
        const values = Array.from({ length: columns * rows * 2 }, (_, index) => index + 1);
        const layout = createWgslUniformLayout(std140);
        const target = new DataView(layout.transcode(std140.createBuffer({ matrices: values })));
        const field = layout.fields.matrices;
        const expectedAlignment = 16;
        const expectedMatrixStride = 16;

        expect(field.alignment).toBe(expectedAlignment);
        expect(field.matrixStride).toBe(expectedMatrixStride);
        expect(field.arrayStride).toBe(columns * expectedMatrixStride);

        let valueIndex = 0;
        for (let arrayIndex = 0; arrayIndex < 2; arrayIndex++) {
            for (let column = 0; column < columns; column++) {
                for (let row = 0; row < rows; row++) {
                    const offset =
                        field.offset +
                        arrayIndex * field.arrayStride +
                        column * field.matrixStride +
                        row * 4;
                    expect(target.getFloat32(offset, true)).toBe(values[valueIndex++]);
                }
            }
        }
    });

    it.each(['bool', 'bvec2', 'bvec3', 'bvec4'] satisfies Std140Type[])(
        'keeps the std140 integer representation of %s fields',
        type => {
            const std140 = createStd140Layout({ value: type });
            const value = Array.from(
                { length: std140.fields.value.componentCount },
                (_unused, index) => index % 2 === 0
            );
            const source = std140.createBuffer({ value: type === 'bool' ? true : value });
            const portable = createWgslUniformLayout(std140).transcode(source);
            expect(new Int32Array(portable)[0]).toBe(1);
            expect(portable).toEqual(source);
        }
    );

    it('rejects a truncated std140 source buffer', () => {
        const layout = createWgslUniformLayout(createStd140Layout({ transform: 'mat4' }));
        expect(() => layout.transcode(new ArrayBuffer(60))).toThrow(/layout requires 64/);
    });

    it('wraps scalar and vec2 arrays and reconstructs two-row matrices', () => {
        const source = `struct Params {\n    scalarValues: array<f32, 3>,\n    pairs: array<vec2<f32>, 2>,\n    basis: mat3x2<f32>,\n    bases: array<mat2x2<f32>, 2>,\n    colors: array<vec3<f32>, 2>,\n}\n\n@group(3) @binding(0)\nvar<uniform> params: Params;\n\nfn read(i: u32) -> vec2<f32> {\n    return params.basis[1] + params.bases[i][0] + params.pairs[i] + vec2<f32>(params.scalarValues[i]) + params.colors[i].xy;\n}`;
        const portable = makeWgslUniformLayoutsPortable(source);

        expect(portable).not.toMatch(/^requires\s+/mu);
        expect(portable).toContain(
            '@align(16) scalarValues: array<HiloStd140Element_Params_scalarValues, 3>'
        );
        expect(portable).toContain('@size(16) value: f32');
        expect(portable).toContain('@align(16) pairs: array<HiloStd140Element_Params_pairs, 2>');
        expect(portable).toContain('@align(16) basis: HiloStd140Matrix_Params_basis');
        expect(portable).toContain('@size(16) column2: vec2<f32>');
        expect(portable).toContain('@align(16) colors: array<vec3<f32>, 2>');
        expect(portable).toContain('hiloLoadStd140Matrix_Params_basis(params.basis)[1]');
        expect(portable).toContain('hiloLoadStd140Matrix_Params_bases(params.bases[i])[0]');
        expect(portable).toContain('params.pairs[i].value');
        expect(portable).toContain('params.scalarValues[i].value');
    });
});
