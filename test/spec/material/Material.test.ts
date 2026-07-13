import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import {
    BACK,
    FRONT,
    FRONT_AND_BACK,
    ONE,
    ONE_MINUS_SRC_ALPHA
} from '../../../src/constants/webgl';

const Material = Hilo3d.Material;

describe('Material', () => {
    it('create', () => {
        const material = new Material();
        expect(material.isMaterial).toBe(true);
        expect(material.className).toBe('Material');
    });

    it('publishes a monotonic revision for independent backend caches', () => {
        const material = new Material();
        expect(material.revision).toBe(0);

        material.isDirty = true;
        expect(material.revision).toBe(1);
        material.isDirty = false;
        expect(material.revision).toBe(1);
        material.isDirty = true;
        expect(material.revision).toBe(2);
    });

    it('clone', () => {
        const material = new Material({
            name: 'source',
            transparent: true
        });
        material.isDirty = true;

        const clonedMaterial = material.clone();
        expect(clonedMaterial).not.toBe(material);
        expect(clonedMaterial.name).toBe(material.name);
        expect(clonedMaterial.transparent).toBe(material.transparent);
        expect(clonedMaterial.revision).toBe(0);
    });

    it('side & cullFace', () => {
        const material = new Material();

        material.side = FRONT;
        expect(material.cullFace).toBe(true);
        expect(material.cullFaceType).toBe(BACK);

        material.side = FRONT_AND_BACK;
        expect(material.cullFace).toBe(false);

        material.side = BACK;
        expect(material.cullFace).toBe(true);
        expect(material.cullFaceType).toBe(FRONT);

        material.cullFaceType = BACK;
        expect(material.side).toBe(FRONT);

        material.cullFace = false;
        expect(material.side).toBe(FRONT_AND_BACK);
    });

    it('transparent', () => {
        const material = new Material();

        material.transparent = true;
        expect(material.blend).toBe(true);
        expect(material.blendSrc).toBe(ONE);
        expect(material.blendDst).toBe(ONE_MINUS_SRC_ALPHA);
        expect(material.blendSrcAlpha).toBe(ONE);
        expect(material.blendDstAlpha).toBe(ONE_MINUS_SRC_ALPHA);
        expect(material.depthMask).toBe(false);

        material.transparent = false;
        expect(material.blend).toBe(false);
        expect(material.depthMask).toBe(true);
    });

    it('getRenderOption', () => {
        const material = new Material({
            normalMap: new Hilo3d.Texture({
                uv: 1
            }),
            alphaCutoff: 0.8
        });

        const option = material.getRenderOption({
            HAS_LIGHT: 1
        });
        expect(option['NORMAL_MAP']).toBe(1);
        expect(option['HAS_TEXCOORD1']).toBe(1);
        expect(option['HAS_TEXCOORD0']).toBeUndefined();
        expect(option['ALPHA_CUTOFF']).toBe(1);
    });

    it('gammaCorrection', () => {
        const material = new Material();

        expect(material.gammaCorrection).toBe(false);
        expect(material.getRenderOption()['GAMMA_CORRECTION']).toBeUndefined();

        material.gammaCorrection = true;
        expect(material.getRenderOption()['GAMMA_CORRECTION']).toBe(1);

        material.gammaCorrection = false;
        expect(material.gammaCorrection).toBe(false);
        expect(material.getRenderOption()['GAMMA_CORRECTION']).toBeUndefined();
    });
});
