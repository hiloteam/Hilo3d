import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3, type Bounds } from '../../../src/Hilo3d';
import { editorCameraClipRange, frameEditorBounds } from '../../../editor/camera-framing';

function makeBounds(size: number, center = new Vector3()): Bounds {
    return {
        x: center.x,
        y: center.y,
        z: center.z,
        width: size,
        height: size,
        depth: size,
        xMin: center.x - size / 2,
        xMax: center.x + size / 2,
        yMin: center.y - size / 2,
        yMax: center.y + size / 2,
        zMin: center.z - size / 2,
        zMax: center.z + size / 2
    };
}

function expectProjected(bounds: Bounds, aspect: number, direction: Vector3): void {
    const frame = frameEditorBounds(bounds, direction, 42, aspect);
    const clipping = editorCameraClipRange(frame.distance, frame.radius, frame.maxDistance);
    const camera = new PerspectiveCamera({
        aspect,
        fov: 42,
        near: clipping.near,
        far: clipping.far
    });
    camera.position.copy(frame.position);
    camera.lookAt(frame.target);
    camera.updateMatrixWorld();
    camera.updateViewProjectionMatrix();
    expect(frame.maxDistance).toBeGreaterThanOrEqual(frame.distance);
    expect(clipping.far).toBeGreaterThan(frame.distance + frame.radius);
    for (const x of [bounds.xMin, bounds.xMax])
        for (const y of [bounds.yMin, bounds.yMax])
            for (const z of [bounds.zMin, bounds.zMax]) {
                const point = camera.projectVector(new Vector3(x, y, z));
                expect(Math.abs(point.x)).toBeLessThan(0.912);
                expect(Math.abs(point.y)).toBeLessThan(0.912);
                expect(point.z).toBeGreaterThan(-1);
                expect(point.z).toBeLessThan(1);
            }
}

describe('editor camera framing', () => {
    for (const size of [100, 10_000])
        for (const aspect of [1.4, 0.35]) {
            it(`fits every corner of a ${String(size)}m model in aspect ${String(aspect)}`, () => {
                expectProjected(
                    makeBounds(size, new Vector3(10_000, -7500, 5000)),
                    aspect,
                    new Vector3(3.6, 2.6, 4.8)
                );
            });
        }
    it('fits rotated and nearly top-down editor views', () => {
        for (const direction of [
            new Vector3(-2, 1, -5),
            new Vector3(0, 1, 0.00001),
            new Vector3(1, -0.5, -1)
        ]) {
            expectProjected(makeBounds(100), 0.5, direction);
        }
    });
    it('does not impose the old 0.8m minimum framing span on small geometry', () => {
        expectProjected(makeBounds(0.001), 1.4, new Vector3(3, 2, 4));
        expect(
            frameEditorBounds(makeBounds(0.001), new Vector3(3, 2, 4), 42, 1.4).distance
        ).toBeLessThan(0.01);
    });
    it('keeps near clipping below a long thin model end and adapts while dollying', () => {
        const slender = {
            ...makeBounds(10_000),
            xMin: -0.01,
            xMax: 0.01,
            yMin: -0.01,
            yMax: 0.01,
            width: 0.02,
            height: 0.02
        };
        expectProjected(slender, 1.4, new Vector3(0, 0, 1));
        const distant = editorCameraClipRange(25_000, 8000, 100_000);
        const close = editorCameraClipRange(0.2, 8000, 100_000);
        expect(distant.near).toBeGreaterThan(close.near);
        expect(close.near).toBeLessThan(0.2);
        expect(close.far).toBeGreaterThan(100_000);
    });
    it('rejects non-finite world bounds without manufacturing a camera pose', () => {
        expect(() =>
            frameEditorBounds({ ...makeBounds(1), xMax: Infinity }, new Vector3(1, 1, 1), 42, 1)
        ).toThrow(/non-finite/);
    });
});
