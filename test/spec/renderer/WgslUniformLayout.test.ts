import { describe, expect, it } from 'vitest';
import {
    createStd140Layout,
    type Std140MatrixType,
    type Std140Type
} from '../../../src/renderer/ubo/Std140Layout';
import {
    createWgslUniformLayout,
    WGSL_UNIFORM_BUFFER_STANDARD_LAYOUT_FEATURE
} from '../../../src/renderer/webgpu/WgslUniformLayout';

describe('WgslUniformLayout', () => {
    it('computes natural WGSL offsets and strides for uniform_buffer_standard_layout', () => {
        const std140 = createStd140Layout({
            head: 'float',
            pairs: { type: 'vec2', arrayLength: 2 },
            basis: 'mat3x2',
            weights: { type: 'float', arrayLength: 3 },
            direction: 'vec3',
            tail: 'uint'
        });
        const layout = createWgslUniformLayout(std140);

        expect(WGSL_UNIFORM_BUFFER_STANDARD_LAYOUT_FEATURE).toBe('uniform_buffer_standard_layout');
        expect(layout.fields.head).toMatchObject({ offset: 0, alignment: 4, byteLength: 4 });
        expect(layout.fields.pairs).toMatchObject({
            offset: 8,
            alignment: 8,
            arrayStride: 8,
            byteLength: 16
        });
        expect(layout.fields.basis).toMatchObject({
            offset: 24,
            alignment: 8,
            matrixStride: 8,
            byteLength: 24
        });
        expect(layout.fields.weights).toMatchObject({
            offset: 48,
            alignment: 4,
            arrayStride: 4,
            byteLength: 12
        });
        expect(layout.fields.direction).toMatchObject({
            offset: 64,
            alignment: 16,
            byteLength: 12
        });
        expect(layout.fields.tail.offset).toBe(76);
        expect(layout.alignment).toBe(16);
        expect(layout.byteLength).toBe(80);
        expect(layout.byteLength).toBeLessThan(std140.byteLength);
    });

    it('transcodes float, signed and unsigned arrays without preserving std140 padding', () => {
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

        expect(layout.fields.floatValues).toMatchObject({ offset: 0, arrayStride: 4 });
        expect([0, 4, 8].map(offset => target.getFloat32(offset, true))).toEqual([
            1.5, -2.25, 3.75
        ]);
        expect(target.getUint32(12, true)).toBe(0);

        expect(layout.fields.signedValues).toMatchObject({ offset: 16, arrayStride: 8 });
        expect([16, 20, 24, 28].map(offset => target.getInt32(offset, true))).toEqual([
            -1, 2, -3, 4
        ]);

        expect(layout.fields.matrices).toMatchObject({
            offset: 32,
            matrixStride: 8,
            arrayStride: 24
        });
        expect(
            [32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76].map(offset =>
                target.getFloat32(offset, true)
            )
        ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

        expect(layout.fields.unsignedValues).toMatchObject({ offset: 80, arrayStride: 16 });
        expect([80, 84, 88, 96, 100, 104].map(offset => target.getUint32(offset, true))).toEqual([
            10, 11, 12, 13, 14, 15
        ]);
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
        const expectedAlignment = rows === 2 ? 8 : 16;
        const expectedMatrixStride = rows === 2 ? 8 : 16;

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
        'rejects non-host-shareable %s fields',
        type => {
            const std140 = createStd140Layout({ value: type });
            expect(() => createWgslUniformLayout(std140)).toThrow(/not host-shareable/);
        }
    );

    it('rejects a truncated std140 source buffer', () => {
        const layout = createWgslUniformLayout(createStd140Layout({ transform: 'mat4' }));
        expect(() => layout.transcode(new ArrayBuffer(60))).toThrow(/layout requires 64/);
    });
});
