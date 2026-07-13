import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { DEPTH, NORMAL, POSITION } from '../../../src/constants/Hilo';

const GeometryMaterial = Hilo3d.GeometryMaterial;

describe('GeometryMaterial', () => {
    it('create', () => {
        const material = new GeometryMaterial();
        expect(material.isGeometryMaterial).toBe(true);
        expect(material.className).toBe('GeometryMaterial');
        expect(material.vertexType).toBeTypeOf('string');
        expect(material.writeOriginData).toBeTypeOf('boolean');
        expect(material.lightType).toBe('NONE');
    });

    it('getRenderOption', () => {
        let material = new GeometryMaterial({
            vertexType: POSITION
        });
        let option = material.getRenderOption();
        expect(option['VERTEX_TYPE_POSITION']).toBe(1);
        expect(option['HAS_FRAG_POS']).toBe(1);

        material = new GeometryMaterial({
            vertexType: NORMAL
        });
        option = material.getRenderOption();
        expect(option['VERTEX_TYPE_NORMAL']).toBe(1);
        expect(option['HAS_NORMAL']).toBe(1);

        material = new GeometryMaterial({
            vertexType: DEPTH,
            writeOriginData: true
        });
        option = material.getRenderOption();
        expect(option['VERTEX_TYPE_DEPTH']).toBe(1);
        expect(option['WRITE_ORIGIN_DATA']).toBe(1);
    });
});
