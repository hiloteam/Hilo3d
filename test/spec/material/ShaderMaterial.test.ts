import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const ShaderMaterial = Hilo3d.ShaderMaterial;

describe('ShaderMaterial', () => {
    it('create', () => {
        const material = new ShaderMaterial();
        expect(material.isShaderMaterial).toBe(true);
        expect(material.className).toBe('ShaderMaterial');
        expect(material.vs).toBeTypeOf('string');
        expect(material.fs).toBeTypeOf('string');
    });

    it('getRenderOption', () => {
        const material = new ShaderMaterial({
            getCustomRenderOption(option) {
                return Object.assign(option, {
                    TEST: 1
                });
            }
        });

        const options: Record<string, number> = {
            INIT: 1
        };
        material.getRenderOption(options);

        expect(options['INIT']).toBe(1);
        expect(options['HILO_CUSTUM_OPTION_TEST']).toBe(1);
    });
});
