import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../src/Hilo3d';
import OrbitControls, { type OrbitControlsOptions } from './OrbitControls';

function createControls(options: OrbitControlsOptions = {}): {
    camera: Hilo3d.PerspectiveCamera;
    canvas: HTMLCanvasElement;
    controls: OrbitControls;
} {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 1000;
    Object.defineProperties(canvas, {
        setPointerCapture: { value: vi.fn() },
        hasPointerCapture: { value: vi.fn(() => false) },
        releasePointerCapture: { value: vi.fn() }
    });
    const camera =
        options.camera ??
        new Hilo3d.PerspectiveCamera({
            fov: 60,
            near: 0.1,
            z: 10
        });
    const stage = { camera, canvas } as unknown as Hilo3d.Stage;
    const controls = new OrbitControls(stage, { ...options, camera, enabled: false });
    return { camera, canvas, controls };
}

function cameraDistance(camera: Hilo3d.PerspectiveCamera, target: Hilo3d.Vector3): number {
    return camera.position.distance(target);
}

describe('OrbitControls', () => {
    it('orients the camera toward a configurable target', () => {
        const target = new Hilo3d.Vector3(2, 1, -3);
        const camera = new Hilo3d.PerspectiveCamera({ x: 4, y: 3, z: 7 });
        const { controls } = createControls({ camera, target });
        const forward = new Hilo3d.Vector3(0, 0, -1).transformQuat(camera.quaternion).normalize();
        const expected = target.clone().subtract(camera.position).normalize();

        expect(controls.target).not.toBe(target);
        expect(forward.dot(expected)).toBeCloseTo(1, 5);
    });

    it('orbits the camera while preserving its distance to the target', () => {
        const { camera, controls } = createControls();

        controls.rotate(250, 0);

        expect(cameraDistance(camera, controls.target)).toBeCloseTo(10, 5);
        expect(camera.x).toBeCloseTo(-10, 5);
        expect(camera.z).toBeCloseTo(0, 5);
    });

    it('dollies and clamps the camera distance', () => {
        const { camera, controls } = createControls({
            minDistance: 4,
            maxDistance: 8
        });

        expect(cameraDistance(camera, controls.target)).toBeCloseTo(8, 5);
        controls.dolly(10);
        expect(cameraDistance(camera, controls.target)).toBeCloseTo(4, 5);
        controls.dolly(0.01);
        expect(cameraDistance(camera, controls.target)).toBeCloseTo(8, 5);
    });

    it('pans the camera and target by the same world-space offset', () => {
        const { camera, controls } = createControls();
        const originalOffset = camera.position.clone().subtract(controls.target);

        controls.pan(100, 50);

        expect(controls.target.length()).toBeGreaterThan(0);
        expect(camera.position.clone().subtract(controls.target).equals(originalOffset)).toBe(true);
    });

    it('uses the current camera position instead of stale internal orbit state', () => {
        const { camera, controls } = createControls();
        camera.setPosition(20, 0, 0);

        controls.dolly(2);

        expect(camera.x).toBeCloseTo(10, 5);
        expect(camera.y).toBeCloseTo(0, 5);
        expect(camera.z).toBeCloseTo(0, 5);
    });

    it('resets camera and target after interaction', () => {
        const { camera, controls } = createControls({
            target: new Hilo3d.Vector3(1, 2, 3)
        });
        const initialPosition = camera.position.clone();
        const initialTarget = controls.target.clone();
        controls.rotate(100, 80);
        controls.pan(40, 30);
        controls.dolly(2);

        controls.reset();

        expect(camera.position.equals(initialPosition)).toBe(true);
        expect(controls.target.equals(initialTarget)).toBe(true);
    });

    it('restores the canvas touch behavior when disposed', () => {
        const { canvas, controls } = createControls();
        canvas.style.touchAction = 'pan-y';

        controls.enable();
        expect(canvas.style.touchAction).toBe('none');
        controls.dispose();

        expect(canvas.style.touchAction).toBe('');
    });

    it('orbits with a single touch pointer', () => {
        const { camera, canvas, controls } = createControls();
        controls.enable();
        canvas.dispatchEvent(
            new PointerEvent('pointerdown', {
                pointerId: 1,
                pointerType: 'touch',
                clientX: 500,
                clientY: 500,
                buttons: 1
            })
        );

        canvas.dispatchEvent(
            new PointerEvent('pointermove', {
                pointerId: 1,
                pointerType: 'touch',
                clientX: 750,
                clientY: 500,
                buttons: 1
            })
        );

        expect(camera.x).toBeCloseTo(-10, 5);
        expect(camera.z).toBeCloseTo(0, 5);
        controls.dispose();
    });

    it('pans and dollies with a two-finger touch gesture', () => {
        const { camera, canvas, controls } = createControls();
        controls.enable();
        for (const [pointerId, clientX] of [
            [1, 400],
            [2, 600]
        ] as const) {
            canvas.dispatchEvent(
                new PointerEvent('pointerdown', {
                    pointerId,
                    pointerType: 'touch',
                    clientX,
                    clientY: 500,
                    buttons: 1
                })
            );
        }

        canvas.dispatchEvent(
            new PointerEvent('pointermove', {
                pointerId: 2,
                pointerType: 'touch',
                clientX: 700,
                clientY: 550,
                buttons: 1
            })
        );

        expect(cameraDistance(camera, controls.target)).toBeLessThan(10);
        expect(controls.target.length()).toBeGreaterThan(0);
        controls.dispose();
    });

    it('rejects invalid limits and targets', () => {
        expect(() => createControls({ minDistance: 2, maxDistance: 1 })).toThrow(RangeError);
        expect(() => createControls({ minPolarAngle: Math.PI })).toThrow(RangeError);
        expect(() => createControls({ target: new Hilo3d.Vector3(Number.NaN, 0, 0) })).toThrow(
            RangeError
        );
    });
});
