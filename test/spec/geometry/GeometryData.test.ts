import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { FLOAT } from '../../../src/constants/webgl';
import type {
    GeometryAttributeValue,
    GeometryDataComponentCallback,
    GeometryDataTraverseCallback
} from '../../../src/geometry/GeometryData';

const GeometryData = Hilo3d.GeometryData;

function expectVector3(value: GeometryAttributeValue, ...components: number[]): void {
    if (!(value instanceof Hilo3d.Vector3)) {
        throw new TypeError('Expected a size-3 GeometryData value to be a Vector3');
    }
    expect(value.elements).toEqualishValues(...components);
}

describe('GeometryData', () => {
    it('create', () => {
        const data = new GeometryData(new Float32Array(), 3);
        expect(data.isGeometryData).toBe(true);
        expect(data.className).toBe('GeometryData');
    });

    const testData = new GeometryData(
        new Float32Array([1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]),
        3,
        {
            stride: 16,
            offset: 4
        }
    );

    it('stride & strideSize', () => {
        expect(testData.stride).toBe(16);
        expect(testData.strideSize).toBe(4);
    });

    it('offset & offsetSize', () => {
        expect(testData.offset).toBe(4);
        expect(testData.offsetSize).toBe(1);
    });

    it('data', () => {
        expect(testData.type).toBe(FLOAT);
    });

    it('length & realLength & count', () => {
        expect(testData.length).toBe(16);
        expect(testData.realLength).toBe(12);
        expect(testData.count).toBe(4);
    });

    it('getOffset', () => {
        expect(testData.getOffset(1)).toBe(5);
    });

    it('get & set', () => {
        expectVector3(testData.get(1), 10, 12, 14);
        testData.set(1, new Hilo3d.Vector3(55, 66, 77));
        expectVector3(testData.get(1), 55, 66, 77);
        testData.set(1, new Hilo3d.Vector3(10, 12, 14));
    });

    it('getCopy', () => {
        expectVector3(testData.getCopy(1), 10, 12, 14);
        expect(testData.getCopy(1)).not.toBe(testData.getCopy(1));
    });

    it('getByOffset & setByOffset', () => {
        expectVector3(testData.getByOffset(5), 10, 12, 14);
        testData.setByOffset(3, new Hilo3d.Vector3(55, 66, 77));
        expectVector3(testData.getByOffset(3), 55, 66, 77);
        testData.setByOffset(3, new Hilo3d.Vector3(6, 8, 10));
    });

    it('traverse & traverseByComponent', () => {
        const attributeCallback = vi.fn<GeometryDataTraverseCallback>(
            (attribute, index, offset) => {
                expect(offset).toBe(index * 4 + 1);
                expect(attribute).toBeInstanceOf(Hilo3d.Vector3);
                if (!(attribute instanceof Hilo3d.Vector3)) {
                    throw new TypeError('A size-3 GeometryData must traverse Vector3 values.');
                }
                expect(attribute.elements).toEqual(
                    new Float32Array([offset * 2, (offset + 1) * 2, (offset + 2) * 2])
                );
            }
        );
        testData.traverse(attributeCallback);
        expect(attributeCallback).toHaveBeenCalledTimes(4);

        const componentCallback = vi.fn<GeometryDataComponentCallback>((data, index, offset) => {
            expect(data).toBe(offset * 2);
            expect(offset).toBe(Math.floor(index / 3) * 4 + (index % 3) + 1);
        });
        testData.traverseByComponent(componentCallback);
        expect(componentCallback).toHaveBeenCalledTimes(12);
    });
});
