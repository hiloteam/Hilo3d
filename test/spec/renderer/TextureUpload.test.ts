import { expect, it, vi } from 'vitest';
import { Renderer, Texture, constants } from '../../../src/Hilo3d';
import type { RHIDevice } from '../../../src/render/rhi/core';

it('uploads textures in a real graph frame without draws, validates before submission and retries', async () => {
    const renderer = await Renderer.create({
        backend: 'webgl2',
        domElement: document.createElement('canvas'),
        width: 4,
        height: 4
    });
    const texture = new Texture({
        width: 2,
        height: 2,
        image: new Uint8Array(4),
        minFilter: constants.LINEAR
    });
    const { device } = renderer.getExtension('rhi') as { device: RHIDevice };
    const begin = vi.spyOn(device.graphicsQueue, 'beginFrame');
    try {
        await expect(renderer.uploadTextures([texture])).rejects.toThrow();
        expect(begin).not.toHaveBeenCalled();
        texture.image = new Uint8Array(16).fill(255);
        await renderer.uploadTextures([texture, texture]);
        expect(begin).toHaveBeenCalledTimes(1);
        await renderer.uploadTextures([]);
        expect(begin).toHaveBeenCalledTimes(1);
        let nested: Promise<void> | undefined;
        expect(() => {
            renderer.renderFrame(() => {
                nested = renderer.uploadTextures([texture]);
                void nested.catch(() => {
                    /* Asserted below after the synchronous outer failure. */
                });
            });
        }).toThrow(/aborted/);
        await expect(nested).rejects.toThrow(/active/);
        await renderer.uploadTextures([texture]);
    } finally {
        texture.destroy();
        renderer.destroy();
    }
});
