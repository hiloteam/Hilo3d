import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const SkinedMesh = Hilo3d.SkinedMesh;

describe('SkinedMesh', () => {
    it('create', () => {
        const mesh = new SkinedMesh();
        expect(mesh.isSkinedMesh).toBe(true);
        expect(mesh.className).toBe('SkinedMesh');
    });

    it('clone constructs a complete skinned mesh instance', () => {
        const mesh = new SkinedMesh();

        const clone = mesh.clone();

        expect(clone).toBeInstanceOf(SkinedMesh);
        expect(clone.isSkinedMesh).toBe(true);
        expect(clone.className).toBe('SkinedMesh');
    });
});
