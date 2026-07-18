import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const SkinnedMesh = Hilo3d.SkinnedMesh;

describe('SkinnedMesh', () => {
    it('create', () => {
        const mesh = new SkinnedMesh();
        expect(mesh.isSkinnedMesh).toBe(true);
        expect(mesh.className).toBe('SkinnedMesh');
    });

    it('clone constructs a complete skinned mesh instance', () => {
        const mesh = new SkinnedMesh();

        const clone = mesh.clone();

        expect(clone).toBeInstanceOf(SkinnedMesh);
        expect(clone.isSkinnedMesh).toBe(true);
        expect(clone.className).toBe('SkinnedMesh');
    });
});
