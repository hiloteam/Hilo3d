import { describe, expect, it } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Skeleton from '../../../src/core/Skeleton';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import Matrix4 from '../../../src/math/Matrix4';
import Vector3 from '../../../src/math/Vector3';
import { ShadowCasterBounds } from '../../../src/render/renderer/ShadowCasterBounds';

function delta(x: number, y = 0, z = 0): GeometryData {
    return new GeometryData(new Float32Array([x, y, z, x, y, z]), 3);
}

describe('Conservative shadow caster bounds', () => {
    it('decodes interleaved/normalized positions and caches streams until their data/layout revision changes', () => {
        const vertices = new GeometryData(
            new Int16Array([9, -32767, 0, 0, 9, 32767, 32767, 32767]),
            3,
            { stride: 8, offset: 2, normalized: true }
        );
        const decode = new Matrix4().fromScaling(new Vector3(2, 3, 4));
        const geometry = new Geometry({ vertices, positionDecodeMat: Array.from(decode.elements) });
        const mesh = new Mesh({ geometry });
        const bounds = new ShadowCasterBounds();
        bounds.begin();
        expect(bounds.get(mesh)).toMatchObject({
            xMin: -2,
            xMax: 2,
            yMin: 0,
            yMax: 3,
            zMin: 0,
            zMax: 4
        });
        vertices.data[1] = 0;
        bounds.begin();
        expect(bounds.get(mesh).xMin).toBe(-2);
        vertices.isDirty = true;
        bounds.begin();
        expect(bounds.get(mesh).xMin).toBe(0);
        vertices.data[1] = -32767;
        geometry.isDirty = true;
        bounds.begin();
        expect(bounds.get(mesh).xMin).toBe(-2);
        if (geometry.positionDecodeMat === null) throw new Error('Expected decode matrix');
        geometry.positionDecodeMat[12] = 10;
        bounds.begin();
        expect(bounds.get(mesh).xMin).toBe(8);
    });

    it('expands active morph delta intervals for negative weights and remapped target slots', () => {
        const morph = new MorphGeometry({
            vertices: new GeometryData(new Float32Array([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), 3),
            targets: { vertices: [delta(2, 4, 6), delta(-4)] },
            weights: [-0.5, 0]
        });
        const mesh = new Mesh({ geometry: morph });
        const bounds = new ShadowCasterBounds();
        bounds.begin();
        expect(bounds.get(mesh)).toMatchObject({
            xMin: -1.5,
            xMax: -0.5,
            yMin: -2.5,
            yMax: -1.5,
            zMin: -3.5,
            zMax: -2.5
        });
        morph.update([1, 0], [1, 0]);
        bounds.begin();
        expect(bounds.get(mesh)).toMatchObject({ xMin: -4.5, xMax: -3.5, yMin: -0.5, yMax: 0.5 });
        morph.weights[0] = Number.NaN;
        bounds.begin();
        expect(() => bounds.get(mesh)).toThrow(/finite/);
    });

    it('culls per-slice bounds conservatively after decode, morph, mirrored transforms and opt-out', () => {
        const camera = new OrthographicCamera({
            left: -1,
            right: 1,
            bottom: -1,
            top: 1,
            near: 0.1,
            far: 10
        });
        camera.setPosition(0, 0, 5).lookAt(new Vector3()).updateViewProjectionMatrix();
        const geometry = new MorphGeometry({
            vertices: new GeometryData(new Float32Array([-0.5, -0.5, 0, 0.5, 0.5, 0]), 3),
            targets: { vertices: [delta(-4)] },
            weights: [0]
        });
        const mesh = new Mesh({
            geometry,
            material: new BasicMaterial({ lightType: 'NONE' }),
            x: 4
        });
        mesh.updateMatrixWorld();
        const bounds = new ShadowCasterBounds();
        bounds.begin();
        expect(bounds.isVisible(mesh, camera)).toBe(false);
        geometry.weights[0] = 1;
        bounds.begin();
        expect(bounds.isVisible(mesh, camera)).toBe(true);
        geometry.weights[0] = 0;
        geometry.positionDecodeMat = Array.from(
            new Matrix4().fromTranslation(new Vector3(-4, 0, 0)).elements
        );
        bounds.begin();
        expect(bounds.isVisible(mesh, camera)).toBe(true);
        mesh.scaleX = -1;
        mesh.updateMatrixWorld();
        bounds.begin();
        expect(bounds.isVisible(mesh, camera)).toBe(false);
        mesh.frustumTest = false;
        expect(bounds.isVisible(mesh, camera)).toBe(true);
    });

    it('unions positive-weight joint boxes, updates poses and rejects invalid influence streams', () => {
        const geometry = new BoxGeometry();
        const count = geometry.vertices?.count ?? 0;
        const weights = new Float32Array(count * 4);
        const indices = new Uint8Array(count * 4);
        for (let index = 0; index < count; index++) {
            weights[index * 4] = 0.5;
            weights[index * 4 + 1] = 0.5;
            indices[index * 4 + 1] = 1;
        }
        geometry.skinWeights = new GeometryData(weights, 4);
        geometry.skinIndices = new GeometryData(indices, 4);
        const left = new Node({ x: -3 });
        const right = new Node({ x: 5 });
        const unused = new Node({ x: 1000 });
        const mesh = new SkinnedMesh({
            geometry,
            material: new BasicMaterial({ lightType: 'NONE' }),
            skeleton: new Skeleton({
                jointNodeList: [left, right, unused],
                inverseBindMatrices: [new Matrix4(), new Matrix4(), new Matrix4()]
            })
        });
        left.addTo(mesh);
        right.addTo(mesh);
        unused.addTo(mesh);
        mesh.updateMatrixWorld();
        const bounds = new ShadowCasterBounds();
        bounds.begin();
        expect(bounds.get(mesh)).toMatchObject({ xMin: -3.5, xMax: 5.5 });
        const camera = new OrthographicCamera({
            left: 3,
            right: 7,
            bottom: -1,
            top: 1,
            near: 0.1,
            far: 10
        });
        camera.setPosition(0, 0, 5).lookAt(new Vector3()).updateViewProjectionMatrix();
        expect(camera.isMeshVisible(mesh)).toBe(false);
        expect(bounds.isVisible(mesh, camera)).toBe(true);
        right.x = 9;
        mesh.updateMatrixWorld();
        bounds.begin();
        expect(bounds.get(mesh).xMax).toBe(9.5);
        const quantized = new Uint16Array(count * 4);
        for (let index = 0; index < count; index++) {
            quantized[index * 4] = 32767;
            quantized[index * 4 + 1] = 32767;
        }
        geometry.skinWeights = new GeometryData(quantized, 4, { normalized: true });
        bounds.begin();
        expect(bounds.get(mesh)).toMatchObject({ xMin: -3.5, xMax: 9.5 });
        geometry.skinWeights.setSubData(0, new Uint16Array([0, 0, 0, 0]));
        bounds.begin();
        expect(() => bounds.get(mesh)).toThrow(/positive sum/);
        geometry.skinWeights = new GeometryData(weights, 4);
        geometry.skinWeights.setSubData(0, new Float32Array([-0.5, 1.5, 0, 0]));
        bounds.begin();
        expect(() => bounds.get(mesh)).toThrow(/weight/);
        geometry.skinWeights.setSubData(0, new Float32Array([0.5, 0.5, 0, 0]));
        geometry.skinIndices.setSubData(0, new Uint8Array([3, 1, 0, 0]));
        bounds.begin();
        expect(() => bounds.get(mesh)).toThrow(/index/);
    });
});
