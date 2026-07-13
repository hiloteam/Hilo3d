import { describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const { MeshPicker } = Hilo3d;

describe('MeshPicker', () => {
    it('creates and destroys idempotently through its public lifecycle', () => {
        const picker = new MeshPicker({ renderer: testEnv.renderer });
        const off = vi.spyOn(testEnv.renderer, 'off');
        expect(picker.isMeshPicker).toBe(true);
        expect(picker.className).toBe('MeshPicker');

        picker.destroy();
        picker.destroy();

        expect(off).toHaveBeenCalledTimes(1);
        expect(off.mock.calls.at(0)?.at(0)).toBe('afterRender');
        expect(off.mock.calls.at(0)?.at(1)).toBeTypeOf('function');
        expect(picker.getSelection(0, 0)).toEqual([]);
    });

    it('deduplicates one mesh selected by many framebuffer pixels', () => {
        const camera = new Hilo3d.PerspectiveCamera({
            aspect: 1,
            near: 0.1,
            far: 10,
            z: 3
        });
        camera.lookAt(new Hilo3d.Vector3());
        const stage = new Hilo3d.Stage({ camera, width: 64, height: 64 });
        const mesh = new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({ lightType: 'NONE' })
        });
        mesh.frustumTest = false;
        stage.addChild(mesh);
        const picker = new MeshPicker({ renderer: stage.renderer });

        try {
            stage.tick(0);
            expect(picker.getSelection(0, 0, 64, 64)).toEqual([mesh]);
        } finally {
            picker.destroy();
            stage.destroy();
        }
    });
});
