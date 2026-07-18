import { describe, expect, it } from 'vitest';
import { RHIBufferUsage, RHITextureUsage } from '../../../../src/render/rhi/core';
import { createWebGL2RHIDevice } from '../../../../src/render/rhi/backends/webgl2';
import { createFakeWebGL2 } from '../FakeWebGL2';

function enableBC(fake: ReturnType<typeof createFakeWebGL2>): void {
    fake.call('getExtension').mockImplementation((name: string) =>
        name === 'WEBGL_compressed_texture_s3tc' || name === 'WEBGL_compressed_texture_s3tc_srgb'
            ? {}
            : null
    );
}

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
        enableBC(fake);
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

    it('rejects partial multi-block-row writes before native compressed uploads', () => {
        const fake = createFakeWebGL2();
        enableBC(fake);
        const device = createWebGL2RHIDevice(fake.gl);
        const texture = device.createTexture({
            label: 'BC1 partial destination',
            size: { width: 8, height: 16 },
            format: 'bc1-rgba-unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        const source = device.createBuffer({
            label: 'BC1 partial source',
            size: 272,
            usage: RHIBufferUsage.COPY_SRC
        });
        fake.call('bufferSubData').mockClear();
        fake.call('compressedTexSubImage2D').mockClear();

        const frame = device.graphicsQueue.beginFrame();
        expect(() => {
            frame.writeTexture(
                { texture, origin: { y: 4 } },
                new Uint8Array(32),
                { bytesPerRow: 16, rowsPerImage: 2 },
                { width: 8, height: 8 }
            );
        }).toThrow(/complete mip slices only/u);
        expect(() => {
            frame.copyBufferToTexture(
                { buffer: source, bytesPerRow: 256, rowsPerImage: 2 },
                { texture, origin: { y: 4 } },
                { width: 8, height: 8 }
            );
        }).toThrow(/complete mip slices only/u);

        expect(frame.diagnostics.commandCount).toBe(0);
        expect(fake.call('bufferSubData')).not.toHaveBeenCalled();
        expect(fake.call('compressedTexSubImage2D')).not.toHaveBeenCalled();
        device.graphicsQueue.endFrame(frame);
        source.destroy();
        texture.destroy();
        device.destroy();
    });

    it('keeps complete compressed mip slices available for individual array layers', () => {
        const fake = createFakeWebGL2();
        enableBC(fake);
        const device = createWebGL2RHIDevice(fake.gl);
        const texture = device.createTexture({
            label: 'BC1 array slice',
            size: { width: 8, height: 8, depthOrArrayLayers: 3 },
            viewDimension: '2d-array',
            format: 'bc1-rgba-unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        fake.call('compressedTexSubImage3D').mockClear();

        const frame = device.graphicsQueue.beginFrame();
        frame.writeTexture(
            { texture, origin: { z: 1 } },
            new Uint8Array(32),
            { bytesPerRow: 16, rowsPerImage: 2 },
            { width: 8, height: 8 }
        );
        device.graphicsQueue.endFrame(frame);

        expect(fake.call('compressedTexSubImage3D')).toHaveBeenCalledWith(
            fake.gl.TEXTURE_2D_ARRAY,
            0,
            0,
            0,
            1,
            8,
            8,
            1,
            0x83f1,
            32,
            0
        );
        texture.destroy();
        device.destroy();
    });
});
