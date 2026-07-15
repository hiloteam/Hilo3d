import { describe, expect, it } from 'vitest';
import { RHITextureUsage } from '../../../../src/render/rhi/core';
import { createWebGL2RHIDevice } from '../../../../src/render/rhi/backends/webgl2';
import { createFakeWebGL2 } from '../FakeWebGL2';

describe('RHI WebGL2 compressed textures', () => {
    it('exposes only extension-backed compression families', () => {
        const unavailable = createFakeWebGL2();
        const unavailableDevice = createWebGL2RHIDevice(unavailable.gl);
        expect(unavailableDevice.capabilities.features.has('texture-compression-bc')).toBe(false);
        expect(unavailableDevice.capabilities.features.has('texture-compression-etc2')).toBe(false);
        expect(unavailableDevice.capabilities.features.has('texture-compression-astc')).toBe(false);
        expect(
            unavailableDevice.capabilities.getTextureFormatCapabilities('etc2-rgb8unorm').sampled
        ).toBe(false);
        unavailableDevice.destroy();

        const available = createFakeWebGL2();
        available.call('getExtension').mockImplementation((name: string) => {
            if (
                name === 'WEBGL_compressed_texture_s3tc' ||
                name === 'WEBGL_compressed_texture_s3tc_srgb'
            ) {
                return {};
            }
            return null;
        });
        const availableDevice = createWebGL2RHIDevice(available.gl);
        expect(availableDevice.capabilities.features.has('texture-compression-bc')).toBe(true);
        expect(
            availableDevice.capabilities.getTextureFormatCapabilities('bc1-rgba-unorm').sampled
        ).toBe(true);
        expect(
            availableDevice.capabilities.getTextureFormatCapabilities('bc1-rgba-unorm-srgb').sampled
        ).toBe(true);
        availableDevice.destroy();
    });

    it('uploads a logical edge mip through compressedTexSubImage2D', () => {
        const fake = createFakeWebGL2();
        fake.call('getExtension').mockImplementation((name: string) =>
            name === 'WEBGL_compressed_texture_s3tc' ||
            name === 'WEBGL_compressed_texture_s3tc_srgb'
                ? {}
                : null
        );
        const device = createWebGL2RHIDevice(fake.gl);
        const texture = device.createTexture({
            label: 'BC1 edge mip',
            size: { width: 4, height: 4 },
            mipLevelCount: 2,
            format: 'bc1-rgba-unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });

        const frame = device.graphicsQueue.beginFrame();
        frame.writeTexture(
            { texture, mipLevel: 1 },
            new Uint8Array(8),
            { bytesPerRow: 8 },
            { width: 2, height: 2 }
        );
        device.graphicsQueue.endFrame(frame);

        expect(fake.call('texStorage2D')).toHaveBeenCalledWith(fake.gl.TEXTURE_2D, 2, 0x83f1, 4, 4);
        expect(fake.call('compressedTexSubImage2D')).toHaveBeenCalledWith(
            fake.gl.TEXTURE_2D,
            1,
            0,
            0,
            2,
            2,
            0x83f1,
            8,
            0
        );
        texture.destroy();
        device.destroy();
    });
});
