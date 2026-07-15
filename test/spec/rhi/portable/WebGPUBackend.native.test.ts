import { RHIBufferUsage, RHITextureUsage } from '../../../../src/render/rhi/core';
import { expect, it } from 'vitest';
import { createWebGPUDevice } from '../../../../src/render/rhi/backends/webgpu';
import { expectRHIPhase2Conformance, runRHIPhase2Conformance } from './RHIPhase2Conformance';

const nativeWebGPUAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

it.skipIf(!nativeWebGPUAvailable)(
    'executes the shared Phase 2 scene matrix on native WebGPU',
    async testContext => {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter === null) {
            testContext.skip();
            return;
        }
        const device = await createWebGPUDevice({ adapter });
        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        const surfaceFormat = navigator.gpu.getPreferredCanvasFormat();
        if (surfaceFormat !== 'rgba8unorm' && surfaceFormat !== 'bgra8unorm') {
            throw new Error(`Unsupported preferred WebGPU canvas format: ${surfaceFormat}`);
        }
        const progress: string[] = [];
        try {
            const result = await runRHIPhase2Conformance({
                device,
                canvas,
                surfaceFormat,
                progress
            });
            expectRHIPhase2Conformance(result);
        } catch (error) {
            const tail = progress.slice(-8).join(' -> ') || 'before the first recorded command';
            throw new Error(`Native WebGPU conformance failed after: ${tail}`, { cause: error });
        } finally {
            device.destroy();
            canvas.remove();
        }
    }
);

it.skipIf(!nativeWebGPUAvailable)(
    'generates readable 2D and cube mip levels in one native WebGPU frame',
    async testContext => {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter === null) {
            testContext.skip();
            return;
        }
        const device = await createWebGPUDevice({ adapter });
        const textureUsage =
            RHITextureUsage.COPY_DST |
            RHITextureUsage.COPY_SRC |
            RHITextureUsage.TEXTURE_BINDING |
            RHITextureUsage.RENDER_ATTACHMENT;
        const twoDimensional = device.createTexture({
            label: 'native generated 2D',
            size: { width: 4, height: 4 },
            mipLevelCount: 3,
            format: 'rgba8unorm',
            usage: textureUsage
        });
        const cube = device.createTexture({
            label: 'native generated cube',
            size: { width: 2, height: 2, depthOrArrayLayers: 6 },
            mipLevelCount: 2,
            viewDimension: 'cube',
            format: 'rgba8unorm',
            usage: textureUsage
        });
        const twoDimensionalReadback = device.createBuffer({
            size: 256,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        const cubeReadback = device.createBuffer({
            size: 256,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        const red = new Uint8Array(4 * 4 * 4);
        for (let offset = 0; offset < red.length; offset += 4) {
            red[offset] = 255;
            red[offset + 3] = 255;
        }
        const cubePixels = new Uint8Array(6 * 2 * 2 * 4);
        for (let layer = 0; layer < 6; layer += 1) {
            for (let pixel = 0; pixel < 4; pixel += 1) {
                const offset = (layer * 4 + pixel) * 4;
                cubePixels[offset + (layer % 3)] = 255;
                cubePixels[offset + 3] = 255;
            }
        }

        try {
            const frame = device.graphicsQueue.beginFrame();
            frame.writeTexture(
                { texture: twoDimensional },
                red,
                { bytesPerRow: 16 },
                { width: 4, height: 4 }
            );
            frame.generateMipmaps(twoDimensional);
            frame.writeTexture(
                { texture: cube },
                cubePixels,
                { bytesPerRow: 8, rowsPerImage: 2 },
                { width: 2, height: 2, depthOrArrayLayers: 6 }
            );
            frame.generateMipmaps(cube);
            frame.copyTextureToBuffer(
                { texture: twoDimensional, mipLevel: 2 },
                { buffer: twoDimensionalReadback, bytesPerRow: 256 },
                { width: 1, height: 1 }
            );
            frame.copyTextureToBuffer(
                { texture: cube, mipLevel: 1, origin: { z: 2 } },
                { buffer: cubeReadback, bytesPerRow: 256 },
                { width: 1, height: 1 }
            );
            await device.graphicsQueue.endFrame(frame).done;
            await Promise.all([
                twoDimensionalReadback.mapAsync('read'),
                cubeReadback.mapAsync('read')
            ]);
            expect([
                ...new Uint8Array(twoDimensionalReadback.getMappedRange()).slice(0, 4)
            ]).toEqual([255, 0, 0, 255]);
            expect([...new Uint8Array(cubeReadback.getMappedRange()).slice(0, 4)]).toEqual([
                0, 0, 255, 255
            ]);
            twoDimensionalReadback.unmap();
            cubeReadback.unmap();
        } finally {
            twoDimensionalReadback.destroy();
            cubeReadback.destroy();
            twoDimensional.destroy();
            cube.destroy();
            device.destroy();
        }
    }
);
