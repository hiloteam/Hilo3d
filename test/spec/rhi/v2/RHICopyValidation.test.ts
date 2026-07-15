import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    getRHITextureFormatBlockInfo,
    getRHIExternalImageSourceDimensions,
    resolveRHIExternalImageSourceDimensionsInto,
    validateRHICopyExternalImageToTexture,
    validateRHICopyBufferToBuffer,
    validateRHICopyBufferToTexture,
    validateRHICopyTextureToBuffer,
    validateRHICopyTextureToTexture,
    validateRHIGenerateMipmaps
} from '../../../../src/render/rhi/core/RHICopyValidation';
import type { RHICommandContext } from '../../../../src/render/rhi/core/RHICommands';
import type { RHIBuffer, RHITexture } from '../../../../src/render/rhi/core/RHIResources';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHIBufferUsageFlags,
    type RHITextureFormat,
    type RHITextureUsageFlags
} from '../../../../src/render/rhi/core/RHITypes';
import { RHIValidationError } from '../../../../src/render/rhi/core/RHIValidation';
import { FakeWebGPURHIBackend, type FakeRHIDevice, type FakeRHIBackend } from './FakeRHIBackend';

function expectValidationCode(action: () => unknown, code: RHIValidationError['code']): void {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(RHIValidationError);
        expect((error as RHIValidationError).code).toBe(code);
        return;
    }
    throw new Error(`expected RHIValidationError(${code})`);
}

describe('RHI v2 copy validation', () => {
    let backend: FakeRHIBackend;
    let device: FakeRHIDevice;
    let context: RHICommandContext;

    beforeEach(() => {
        backend = new FakeWebGPURHIBackend();
        device = backend.createDevice();
        context = device.graphicsQueue.beginFrame();
    });

    afterEach(() => {
        if (context.state === 'open') device.graphicsQueue.abortFrame(context);
        backend.destroy();
    });

    function createBuffer(
        size: number,
        usage: RHIBufferUsageFlags,
        mappedAtCreation = false
    ): RHIBuffer {
        return device.createBuffer({ size, usage, mappedAtCreation });
    }

    function createTexture(
        format: RHITextureFormat,
        usage: RHITextureUsageFlags,
        size: {
            readonly width: number;
            readonly height: number;
            readonly depthOrArrayLayers?: number;
        },
        mipLevelCount = 1
    ): RHITexture {
        return device.createTexture({ size, mipLevelCount, format, usage });
    }

    it('validates aligned, in-bounds, non-overlapping unmapped buffer ranges', () => {
        const source = createBuffer(32, RHIBufferUsage.COPY_SRC);
        const destination = createBuffer(32, RHIBufferUsage.COPY_DST);
        expect(() => {
            validateRHICopyBufferToBuffer(context, source, 4, destination, 8, 8);
        }).not.toThrow();

        expectValidationCode(() => {
            validateRHICopyBufferToBuffer(context, source, 2, destination, 8, 8);
        }, 'invalid-descriptor');
        expectValidationCode(() => {
            validateRHICopyBufferToBuffer(context, source, 28, destination, 0, 8);
        }, 'out-of-bounds');

        const shared = createBuffer(32, RHIBufferUsage.COPY_SRC | RHIBufferUsage.COPY_DST);
        expectValidationCode(() => {
            validateRHICopyBufferToBuffer(context, shared, 0, shared, 4, 8);
        }, 'invalid-descriptor');
        expect(() => {
            validateRHICopyBufferToBuffer(context, shared, 0, shared, 8, 8);
        }).not.toThrow();

        const mapped = createBuffer(16, RHIBufferUsage.COPY_SRC, true);
        expectValidationCode(() => {
            validateRHICopyBufferToBuffer(context, mapped, 0, destination, 0, 8);
        }, 'invalid-state');
    });

    it('validates mip levels, origins, aspects, and dimension-aware texture bounds', () => {
        const source = createBuffer(4, RHIBufferUsage.COPY_SRC);
        const destination = createTexture(
            'rgba8unorm',
            RHITextureUsage.COPY_DST,
            { width: 8, height: 4, depthOrArrayLayers: 3 },
            4
        );
        expect(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: source },
                { texture: destination, mipLevel: 2, origin: { x: 1, z: 2 } },
                { width: 1 }
            );
        }).not.toThrow();

        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: source },
                { texture: destination, mipLevel: 4 },
                { width: 1 }
            );
        }, 'out-of-bounds');
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: source },
                { texture: destination, mipLevel: 2, origin: { x: 2 } },
                { width: 1 }
            );
        }, 'out-of-bounds');
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: source },
                { texture: destination, mipLevel: 2, origin: { z: 3 } },
                { width: 1 }
            );
        }, 'out-of-bounds');
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: source },
                { texture: destination, aspect: 'depth-only' },
                { width: 1 }
            );
        }, 'invalid-descriptor');
    });

    it('uses bytesPerRow, rowsPerImage, and the unpadded last row for capacity', () => {
        const destination = createTexture('rgba8unorm', RHITextureUsage.COPY_DST, {
            width: 4,
            height: 2,
            depthOrArrayLayers: 2
        });
        const exact = createBuffer(784, RHIBufferUsage.COPY_SRC);
        expect(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: exact, bytesPerRow: 256, rowsPerImage: 2 },
                { texture: destination },
                { width: 4, height: 2, depthOrArrayLayers: 2 }
            );
        }).not.toThrow();

        const oneByteShort = createBuffer(783, RHIBufferUsage.COPY_SRC);
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: oneByteShort, bytesPerRow: 256, rowsPerImage: 2 },
                { texture: destination },
                { width: 4, height: 2, depthOrArrayLayers: 2 }
            );
        }, 'out-of-bounds');

        const roomy = createBuffer(2048, RHIBufferUsage.COPY_SRC);
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: roomy },
                { texture: destination },
                { width: 4, height: 2, depthOrArrayLayers: 2 }
            );
        }, 'invalid-descriptor');
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: roomy, bytesPerRow: 256 },
                { texture: destination },
                { width: 4, height: 2, depthOrArrayLayers: 2 }
            );
        }, 'invalid-descriptor');
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: roomy, bytesPerRow: 260, rowsPerImage: 2 },
                { texture: destination },
                { width: 4, height: 2, depthOrArrayLayers: 2 }
            );
        }, 'invalid-descriptor');
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: roomy, offset: 2, bytesPerRow: 256, rowsPerImage: 2 },
                { texture: destination },
                { width: 4, height: 2, depthOrArrayLayers: 2 }
            );
        }, 'invalid-descriptor');
    });

    it('applies the same layout capacity and ownership checks to texture-to-buffer copies', () => {
        const source = createTexture('rgba8unorm', RHITextureUsage.COPY_SRC, {
            width: 4,
            height: 2,
            depthOrArrayLayers: 2
        });
        const exact = createBuffer(784, RHIBufferUsage.COPY_DST);
        expect(() => {
            validateRHICopyTextureToBuffer(
                context,
                { texture: source },
                { buffer: exact, bytesPerRow: 256, rowsPerImage: 2 },
                { width: 4, height: 2, depthOrArrayLayers: 2 }
            );
        }).not.toThrow();

        const oneByteShort = createBuffer(783, RHIBufferUsage.COPY_DST);
        expectValidationCode(() => {
            validateRHICopyTextureToBuffer(
                context,
                { texture: source },
                { buffer: oneByteShort, bytesPerRow: 256, rowsPerImage: 2 },
                { width: 4, height: 2, depthOrArrayLayers: 2 }
            );
        }, 'out-of-bounds');

        const foreignDevice = backend.createDevice();
        const foreignTexture = foreignDevice.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST
        });
        const localDestination = createBuffer(4, RHIBufferUsage.COPY_DST);
        expectValidationCode(() => {
            validateRHICopyTextureToBuffer(
                context,
                { texture: foreignTexture, aspect: 'depth-only' },
                { buffer: localDestination },
                { width: 1 }
            );
        }, 'wrong-device');
    });

    it('uses compressed block dimensions and permits partial blocks only at mip edges', () => {
        expect(getRHITextureFormatBlockInfo('bc1-rgba-unorm')).toEqual({
            blockWidth: 4,
            blockHeight: 4,
            bytesPerBlock: 8
        });
        const destination = createTexture('bc1-rgba-unorm', RHITextureUsage.COPY_DST, {
            width: 10,
            height: 6
        });
        const exact = createBuffer(272, RHIBufferUsage.COPY_SRC);
        expect(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: exact, bytesPerRow: 256 },
                { texture: destination, origin: { x: 4 } },
                { width: 6, height: 6 }
            );
        }).not.toThrow();

        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: exact, bytesPerRow: 256 },
                { texture: destination, origin: { x: 2 } },
                { width: 6, height: 6 }
            );
        }, 'invalid-descriptor');
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: exact, bytesPerRow: 256 },
                { texture: destination },
                { width: 6, height: 6 }
            );
        }, 'invalid-descriptor');

        const oneByteShort = createBuffer(271, RHIBufferUsage.COPY_SRC);
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: oneByteShort, bytesPerRow: 256 },
                { texture: destination, origin: { x: 4 } },
                { width: 6, height: 6 }
            );
        }, 'out-of-bounds');
    });

    it('uses aspect-specific depth/stencil footprints and rejects opaque depth copies', () => {
        const depthStencil = createTexture('depth32float-stencil8', RHITextureUsage.COPY_DST, {
            width: 2,
            height: 2
        });
        const depthBytes = createBuffer(264, RHIBufferUsage.COPY_SRC);
        const stencilBytes = createBuffer(258, RHIBufferUsage.COPY_SRC);

        expect(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: depthBytes, bytesPerRow: 256 },
                { texture: depthStencil, aspect: 'depth-only' },
                { width: 2, height: 2 }
            );
        }).not.toThrow();
        expect(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: stencilBytes, bytesPerRow: 256 },
                { texture: depthStencil, aspect: 'stencil-only' },
                { width: 2, height: 2 }
            );
        }).not.toThrow();
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: depthBytes, bytesPerRow: 256 },
                { texture: depthStencil },
                { width: 2, height: 2 }
            );
        }, 'invalid-descriptor');

        const opaqueDepthStencil = createTexture('depth24plus-stencil8', RHITextureUsage.COPY_DST, {
            width: 2,
            height: 2
        });
        expectValidationCode(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: depthBytes, bytesPerRow: 256 },
                { texture: opaqueDepthStencil, aspect: 'depth-only' },
                { width: 2, height: 2 }
            );
        }, 'unsupported-format');
        expect(() => {
            validateRHICopyBufferToTexture(
                context,
                { buffer: stencilBytes, bytesPerRow: 256 },
                { texture: opaqueDepthStencil, aspect: 'stencil-only' },
                { width: 2, height: 2 }
            );
        }).not.toThrow();
    });

    it('validates texture copy compatibility, overlap, and full depth subresources', () => {
        const source = createTexture('rgba8unorm', RHITextureUsage.COPY_SRC, {
            width: 4,
            height: 4
        });
        const srgbDestination = createTexture('rgba8unorm-srgb', RHITextureUsage.COPY_DST, {
            width: 4,
            height: 4
        });
        expect(() => {
            validateRHICopyTextureToTexture(
                context,
                { texture: source },
                { texture: srgbDestination },
                { width: 4, height: 4 }
            );
        }).not.toThrow();

        const incompatible = createTexture('bgra8unorm', RHITextureUsage.COPY_DST, {
            width: 4,
            height: 4
        });
        expectValidationCode(() => {
            validateRHICopyTextureToTexture(
                context,
                { texture: source },
                { texture: incompatible },
                { width: 4, height: 4 }
            );
        }, 'incompatible-layout');

        const layered = createTexture(
            'rgba8unorm',
            RHITextureUsage.COPY_SRC | RHITextureUsage.COPY_DST,
            { width: 4, height: 4, depthOrArrayLayers: 2 }
        );
        expect(() => {
            validateRHICopyTextureToTexture(
                context,
                { texture: layered, origin: { z: 0 } },
                { texture: layered, origin: { z: 1 } },
                { width: 4, height: 4 }
            );
        }).not.toThrow();
        expectValidationCode(() => {
            validateRHICopyTextureToTexture(
                context,
                { texture: layered },
                { texture: layered },
                { width: 4, height: 4 }
            );
        }, 'invalid-descriptor');

        const depthSource = createTexture('depth32float', RHITextureUsage.COPY_SRC, {
            width: 4,
            height: 4
        });
        const depthDestination = createTexture('depth32float', RHITextureUsage.COPY_DST, {
            width: 4,
            height: 4
        });
        expectValidationCode(() => {
            validateRHICopyTextureToTexture(
                context,
                { texture: depthSource },
                { texture: depthDestination },
                { width: 2, height: 4 }
            );
        }, 'invalid-descriptor');
    });

    it('rejects foreign resources and ended command contexts before copy layout work', () => {
        const foreignDevice = backend.createDevice();
        const foreignSource = foreignDevice.createBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_SRC
        });
        const destination = createBuffer(4, RHIBufferUsage.COPY_DST);
        expectValidationCode(() => {
            validateRHICopyBufferToBuffer(context, foreignSource, 0, destination, 0, 4);
        }, 'wrong-device');

        device.graphicsQueue.abortFrame(context);
        expectValidationCode(() => {
            validateRHICopyBufferToBuffer(context, destination, 0, destination, 0, 4);
        }, 'invalid-state');
    });

    it('validates external source dimensions, source origin, destination usage/format, and bounds', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 3;
        expect(getRHIExternalImageSourceDimensions(canvas)).toEqual({ width: 4, height: 3 });
        const dimensions = { width: 0, height: 0 };
        resolveRHIExternalImageSourceDimensionsInto(canvas, dimensions);
        expect(dimensions).toEqual({ width: 4, height: 3 });
        canvas.width = 5;
        resolveRHIExternalImageSourceDimensionsInto(canvas, dimensions);
        expect(dimensions).toEqual({ width: 5, height: 3 });
        canvas.width = 4;
        const destination = createTexture(
            'rgba8unorm',
            RHITextureUsage.COPY_DST | RHITextureUsage.RENDER_ATTACHMENT,
            { width: 4, height: 4, depthOrArrayLayers: 2 },
            2
        );
        expect(() => {
            validateRHICopyExternalImageToTexture(
                device,
                { source: canvas, origin: { x: 1, y: 1 }, flipY: true },
                {
                    texture: destination,
                    origin: { x: 1, y: 1, z: 1 },
                    premultipliedAlpha: true
                },
                { width: 3, height: 2 }
            );
        }).not.toThrow();

        expectValidationCode(() => {
            validateRHICopyExternalImageToTexture(
                device,
                { source: canvas, origin: { x: 2 } },
                { texture: destination },
                { width: 3, height: 1 }
            );
        }, 'out-of-bounds');
        expectValidationCode(() => {
            validateRHICopyExternalImageToTexture(
                device,
                { source: canvas },
                { texture: destination },
                { width: 1, depthOrArrayLayers: 2 }
            );
        }, 'invalid-descriptor');

        const wrongUsage = createTexture('rgba8unorm', RHITextureUsage.TEXTURE_BINDING, {
            width: 4,
            height: 3
        });
        expectValidationCode(() => {
            validateRHICopyExternalImageToTexture(
                device,
                { source: canvas },
                { texture: wrongUsage },
                { width: 4, height: 3 }
            );
        }, 'invalid-descriptor');
        const missingRenderUsage = createTexture('rgba8unorm', RHITextureUsage.COPY_DST, {
            width: 4,
            height: 3
        });
        expectValidationCode(() => {
            validateRHICopyExternalImageToTexture(
                device,
                { source: canvas },
                { texture: missingRenderUsage },
                { width: 4, height: 3 }
            );
        }, 'invalid-descriptor');
        const wrongFormat = createTexture(
            'rgba16float',
            RHITextureUsage.COPY_DST | RHITextureUsage.RENDER_ATTACHMENT,
            { width: 4, height: 3 }
        );
        expectValidationCode(() => {
            validateRHICopyExternalImageToTexture(
                device,
                { source: canvas },
                { texture: wrongFormat },
                { width: 4, height: 3 }
            );
        }, 'unsupported-format');

        const unloaded = document.createElement('img');
        expectValidationCode(() => {
            getRHIExternalImageSourceDimensions(unloaded);
        }, 'invalid-state');
    });

    it('allows consecutive external pre-pass copies and rejects them after encoded work', () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const destination = createTexture(
            'rgba8unorm',
            RHITextureUsage.COPY_DST | RHITextureUsage.RENDER_ATTACHMENT,
            { width: 1, height: 1 }
        );
        context.copyExternalImageToTexture(
            { source: canvas },
            { texture: destination },
            { width: 1 }
        );
        context.copyExternalImageToTexture(
            { source: canvas, flipY: true },
            { texture: destination, premultipliedAlpha: true },
            { width: 1 }
        );
        const buffer = createBuffer(4, RHIBufferUsage.COPY_DST);
        context.writeBuffer(buffer, 0, new Uint8Array(4));
        expectValidationCode(() => {
            context.copyExternalImageToTexture(
                { source: canvas },
                { texture: destination },
                { width: 1 }
            );
        }, 'invalid-state');
    });

    it('validates the portable 2D/cube color mipmap-generation contract', () => {
        const usage = RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT;
        const twoDimensional = device.createTexture({
            size: { width: 4, height: 2 },
            mipLevelCount: 3,
            format: 'rgba8unorm',
            usage
        });
        const cube = device.createTexture({
            size: { width: 4, height: 4, depthOrArrayLayers: 6 },
            mipLevelCount: 3,
            viewDimension: 'cube',
            format: 'rgba16float',
            usage
        });
        expect(() => {
            validateRHIGenerateMipmaps(device, twoDimensional);
        }).not.toThrow();
        expect(() => {
            context.generateMipmaps(twoDimensional);
        }).not.toThrow();
        expect(() => {
            validateRHIGenerateMipmaps(device, cube);
        }).not.toThrow();
        expect(() => {
            context.generateMipmaps(cube);
        }).not.toThrow();

        const missingUsage = device.createTexture({
            size: { width: 4, height: 4 },
            mipLevelCount: 3,
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        expectValidationCode(() => {
            validateRHIGenerateMipmaps(device, missingUsage);
        }, 'invalid-descriptor');

        const singleLevel = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage
        });
        expectValidationCode(() => {
            validateRHIGenerateMipmaps(device, singleLevel);
        }, 'invalid-descriptor');

        const integer = device.createTexture({
            size: { width: 4, height: 4 },
            mipLevelCount: 3,
            format: 'rgba8uint',
            usage
        });
        expectValidationCode(() => {
            validateRHIGenerateMipmaps(device, integer);
        }, 'unsupported-format');

        const depth = device.createTexture({
            size: { width: 4, height: 4 },
            mipLevelCount: 3,
            format: 'depth32float',
            usage
        });
        expectValidationCode(() => {
            validateRHIGenerateMipmaps(device, depth);
        }, 'unsupported-format');

        const volume = device.createTexture({
            size: { width: 4, height: 4, depthOrArrayLayers: 4 },
            mipLevelCount: 3,
            dimension: '3d',
            viewDimension: '3d',
            format: 'rgba8unorm',
            usage
        });
        expectValidationCode(() => {
            validateRHIGenerateMipmaps(device, volume);
        }, 'unsupported-feature');
    });
});
