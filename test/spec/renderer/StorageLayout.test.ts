import { describe, expect, it } from 'vitest';
import { createStorageLayout, StorageLayout } from '../../../src/render/storage/StorageLayout';

describe('StorageLayout', () => {
    it('calculates WGSL storage alignment for scalars, vectors, matrices, arrays and structs', () => {
        const layout = createStorageLayout({
            position: 'vec3<f32>',
            mass: 'f32',
            basis: 'mat3x2<f32>',
            ids: { type: 'array', element: 'u32', length: 3 },
            metadata: {
                type: 'struct',
                fields: {
                    flags: 'atomic<u32>',
                    bounds: 'vec3<f32>'
                }
            }
        });

        expect(layout.fields.position).toMatchObject({
            offset: 0,
            byteLength: 12,
            alignment: 16
        });
        expect(layout.fields.mass.offset).toBe(12);
        expect(layout.fields.basis).toMatchObject({
            offset: 16,
            byteLength: 24,
            alignment: 8
        });
        expect(layout.fields.ids).toMatchObject({
            offset: 40,
            byteLength: 12,
            alignment: 4
        });
        expect(layout.fields.metadata).toMatchObject({
            offset: 64,
            byteLength: 32,
            alignment: 16
        });
        expect(layout.alignment).toBe(16);
        expect(layout.byteLength).toBe(96);
    });

    it('packs column-major matrices, nested structs, arrays and atomic scalar bytes', () => {
        const layout = createStorageLayout({
            transform: 'mat2x3<f32>',
            records: {
                type: 'array',
                element: {
                    type: 'struct',
                    fields: { id: 'u32', velocity: 'vec2<i32>' }
                },
                length: 2
            },
            counter: 'atomic<i32>'
        });
        const buffer = layout.createBuffer({
            transform: [1, 2, 3, 4, 5, 6],
            records: [
                { id: 7, velocity: [8, 9] },
                { id: 10, velocity: [11, 12] }
            ],
            counter: -2
        });
        const view = new DataView(buffer);

        expect(layout.fields.transform).toMatchObject({ offset: 0, byteLength: 32 });
        expect(view.getFloat32(0, true)).toBe(1);
        expect(view.getFloat32(8, true)).toBe(3);
        expect(view.getFloat32(16, true)).toBe(4);
        expect(view.getFloat32(24, true)).toBe(6);

        const recordsOffset = layout.fields.records.offset;
        expect(view.getUint32(recordsOffset, true)).toBe(7);
        expect(view.getInt32(recordsOffset + 8, true)).toBe(8);
        expect(view.getInt32(recordsOffset + 12, true)).toBe(9);
        expect(view.getUint32(recordsOffset + 16, true)).toBe(10);
        expect(view.getInt32(recordsOffset + 24, true)).toBe(11);
        expect(view.getInt32(recordsOffset + 28, true)).toBe(12);
        expect(view.getInt32(layout.fields.counter.offset, true)).toBe(-2);
    });

    it('supports allocation-free writes and reports the exact changed byte span', () => {
        const layout = createStorageLayout({ value: 'vec3<f32>', tail: 'u32' });
        const buffer = layout.createBuffer();
        const result = { byteOffset: -1, byteLength: -1 };

        expect(layout.writeInto(buffer, 'value', [0, 2, 0], result)).toBe(result);
        expect(result).toEqual({ byteOffset: 4, byteLength: 4 });
        expect(layout.writeInto(buffer, 'value', [0, 2, 0], result)).toBe(result);
        expect(result).toEqual({ byteOffset: 0, byteLength: 0 });
        expect(layout.writeInto(buffer, 'tail', 4, result)).toBe(result);
        expect(result).toEqual({ byteOffset: 12, byteLength: 4 });

        expect(layout.writeInto(buffer, 'value', [-0, 2, 0], result)).toBe(result);
        expect(result).toEqual({ byteOffset: 0, byteLength: 4 });
        expect(Object.is(new DataView(buffer).getFloat32(0, true), -0)).toBe(true);
    });

    it('rejects non-host-shareable types, invalid shapes and numeric overflow', () => {
        expect(() => new StorageLayout({ value: 'bool' } as never)).toThrow(/unsupported/);
        expect(() => new StorageLayout({ value: 'f16' } as never)).toThrow(/unsupported/);
        expect(
            () =>
                new StorageLayout({
                    values: { type: 'array', element: 'u32', length: 0 }
                })
        ).toThrow(/array length/);
        expect(
            () =>
                new StorageLayout({
                    empty: { type: 'struct', fields: {} }
                })
        ).toThrow(/at least one field/);

        const layout = createStorageLayout({ unsigned: 'u32', signed: 'i32', vector: 'vec2<f32>' });
        const buffer = layout.createBuffer();
        expect(() => layout.write(buffer, 'unsigned', -1)).toThrow(/unsigned/);
        expect(() => layout.write(buffer, 'signed', 0x8000_0000)).toThrow(/signed/);
        expect(() => layout.write(buffer, 'vector', [1])).toThrow(/requires 2 values/);
        expect(() => layout.write(buffer, 'vector', [1, Number.NaN])).toThrow(/finite/);
    });

    it('deeply snapshots the schema so caller mutation cannot change the public layout contract', () => {
        const fields = { value: 'u32' as const };
        const definition = { type: 'struct' as const, fields };
        const schema = { nested: definition };
        const layout = createStorageLayout(schema);

        (fields as { value: string }).value = 'vec4<f32>';
        (definition as { type: string }).type = 'array';

        expect(layout.schema).toEqual({
            nested: { type: 'struct', fields: { value: 'u32' } }
        });
        expect(Object.isFrozen(layout.schema)).toBe(true);
        expect(Object.isFrozen(layout.schema.nested)).toBe(true);
        expect(Object.isFrozen(layout.schema.nested.fields)).toBe(true);
        expect(layout.byteLength).toBe(4);
    });
});
