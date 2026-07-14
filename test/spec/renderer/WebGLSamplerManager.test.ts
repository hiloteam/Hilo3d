import { describe, expect, it, vi } from 'vitest';
import { WebGLSamplerManager } from '../../../src/render/internal/webgl2/WebGLSamplerManager';
import type WebGLState from '../../../src/render/internal/webgl2/WebGLState';
import Texture from '../../../src/texture/Texture';

function createManager(): {
    readonly manager: WebGLSamplerManager;
    readonly gl: WebGL2RenderingContext;
    readonly createSampler: ReturnType<typeof vi.fn>;
    readonly samplerParameteri: ReturnType<typeof vi.fn>;
    readonly samplerParameterf: ReturnType<typeof vi.fn>;
    readonly bindSampler: ReturnType<typeof vi.fn>;
    readonly deleteSampler: ReturnType<typeof vi.fn>;
} {
    let nextSamplerId = 1;
    const createSampler = vi.fn(() => ({ id: nextSamplerId++ }));
    const samplerParameteri = vi.fn();
    const samplerParameterf = vi.fn();
    const bindSampler = vi.fn();
    const deleteSampler = vi.fn();
    const gl = {
        LEQUAL: 0x0203,
        GEQUAL: 0x0206,
        CLAMP_TO_EDGE: 0x812f,
        NONE: 0,
        COMPARE_REF_TO_TEXTURE: 0x884e,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_WRAP_R: 0x8072,
        TEXTURE_COMPARE_MODE: 0x884c,
        TEXTURE_COMPARE_FUNC: 0x884d,
        createSampler,
        samplerParameteri,
        samplerParameterf,
        bindSampler,
        deleteSampler
    } as unknown as WebGL2RenderingContext;
    const state = {
        gl,
        extensions: {
            textureFilterAnisotropic: {
                TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe
            }
        },
        capabilities: {
            MAX_TEXTURE_MAX_ANISOTROPY: 8
        }
    } as unknown as WebGLState;
    return {
        manager: new WebGLSamplerManager(state),
        gl,
        createSampler,
        samplerParameteri,
        samplerParameterf,
        bindSampler,
        deleteSampler
    };
}

describe('WebGLSamplerManager', () => {
    it('reuses immutable sampler variants by descriptor instead of texture identity', () => {
        const fake = createManager();
        const firstTexture = new Texture({ anisotropic: 16 });
        const equivalentTexture = new Texture({ anisotropic: 16 });

        const first = fake.manager.bind(firstTexture, 0, false);
        const equivalent = fake.manager.bind(equivalentTexture, 1, false);

        expect(equivalent).toBe(first);
        expect(fake.createSampler).toHaveBeenCalledTimes(1);
        expect(fake.samplerParameterf).toHaveBeenCalledWith(first, 0x84fe, 8);

        equivalentTexture.wrapS = fake.gl.CLAMP_TO_EDGE;
        const changed = fake.manager.bind(equivalentTexture, 2, false);
        expect(changed).not.toBe(first);
        expect(fake.createSampler).toHaveBeenCalledTimes(2);

        equivalentTexture.wrapS = firstTexture.wrapS;
        expect(fake.manager.bind(equivalentTexture, 3, false)).toBe(first);
        expect(fake.createSampler).toHaveBeenCalledTimes(2);
    });

    it('isolates ordinary and comparison sampling for the same texture', () => {
        const fake = createManager();
        const texture = new Texture();

        const ordinary = fake.manager.bind(texture, 0, false);
        const comparison = fake.manager.bind(texture, 1, true, fake.gl.GEQUAL);

        expect(comparison).not.toBe(ordinary);
        expect(fake.createSampler).toHaveBeenCalledTimes(2);
        expect(fake.samplerParameteri).toHaveBeenCalledWith(
            ordinary,
            fake.gl.TEXTURE_COMPARE_MODE,
            fake.gl.NONE
        );
        expect(fake.samplerParameteri).toHaveBeenCalledWith(
            comparison,
            fake.gl.TEXTURE_COMPARE_MODE,
            fake.gl.COMPARE_REF_TO_TEXTURE
        );
        expect(fake.samplerParameteri).toHaveBeenCalledWith(
            comparison,
            fake.gl.TEXTURE_COMPARE_FUNC,
            fake.gl.GEQUAL
        );
    });

    it('deduplicates sampler bindings per texture unit', () => {
        const fake = createManager();
        const texture = new Texture();

        const ordinary = fake.manager.bind(texture, 4, false);
        expect(fake.manager.bind(texture, 4, false)).toBe(ordinary);
        expect(fake.bindSampler).toHaveBeenCalledTimes(1);
        expect(fake.bindSampler).toHaveBeenLastCalledWith(4, ordinary);

        const comparison = fake.manager.bind(texture, 4, true);
        expect(fake.manager.bind(texture, 4, true)).toBe(comparison);
        expect(fake.bindSampler).toHaveBeenCalledTimes(2);
        expect(fake.bindSampler).toHaveBeenLastCalledWith(4, comparison);

        fake.manager.resetBindings();
        fake.manager.bind(texture, 4, true);
        expect(fake.bindSampler).toHaveBeenCalledTimes(3);
    });

    it('never evicts bound LRU entries and trims them after their unit is replaced', () => {
        const fake = createManager();
        const texture = new Texture();
        const samplers = Array.from({ length: 257 }, (_, index) =>
            fake.manager.bind(texture, index, true, 0x1000 + index)
        );

        expect(fake.createSampler).toHaveBeenCalledTimes(257);
        expect(fake.deleteSampler).not.toHaveBeenCalled();

        fake.manager.bind(texture, 0, true, 0x1001);

        expect(fake.createSampler).toHaveBeenCalledTimes(257);
        expect(fake.deleteSampler).toHaveBeenCalledTimes(1);
        expect(fake.deleteSampler).toHaveBeenCalledWith(samplers[0]);
        expect(fake.deleteSampler).not.toHaveBeenCalledWith(samplers[1]);
    });

    it('deletes every cached sampler exactly once and clears binding state', () => {
        const fake = createManager();
        const texture = new Texture();
        const ordinary = fake.manager.bind(texture, 0, false);
        const comparison = fake.manager.bind(texture, 1, true);

        fake.manager.destroy();

        expect(fake.deleteSampler).toHaveBeenCalledTimes(2);
        expect(fake.deleteSampler).toHaveBeenCalledWith(ordinary);
        expect(fake.deleteSampler).toHaveBeenCalledWith(comparison);

        fake.manager.destroy();
        expect(fake.deleteSampler).toHaveBeenCalledTimes(2);

        const recreated = fake.manager.bind(texture, 0, false);
        expect(recreated).not.toBe(ordinary);
        expect(fake.createSampler).toHaveBeenCalledTimes(3);
        expect(fake.bindSampler).toHaveBeenCalledTimes(3);
        expect(fake.bindSampler).toHaveBeenLastCalledWith(0, recreated);
    });
});
