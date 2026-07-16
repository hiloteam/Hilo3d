import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RHIGraphicsShaderArtifactInput } from '../../../../src/render/rhi/core';

const backend = vi.hoisted(() => ({
    webglDevice: { backend: 'webgl2', createSurface: vi.fn() },
    webgpuDevice: { backend: 'webgpu', createSurface: vi.fn() },
    createWebGL2: vi.fn(),
    createWebGPU: vi.fn(),
    probeWebGL2: vi.fn(),
    probeWebGPU: vi.fn()
}));
const mipmapShaderArtifacts = vi.hoisted(
    () =>
        Object.freeze({
            vertex: Object.freeze({
                backend: 'webgpu',
                stage: 'vertex',
                code: '',
                entryPoint: 'main',
                reflection: Object.freeze({
                    bindings: Object.freeze([]),
                    vertexInputs: Object.freeze([])
                }),
                cacheKey: 1
            }),
            fragment: Object.freeze({
                backend: 'webgpu',
                stage: 'fragment',
                code: '',
                entryPoint: 'main',
                reflection: Object.freeze({
                    bindings: Object.freeze([]),
                    fragmentOutputs: Object.freeze([])
                }),
                cacheKey: 2
            })
        }) satisfies Readonly<RHIGraphicsShaderArtifactInput>
);

vi.mock('../../../../src/render/rhi/backends/webgl2', () => ({
    createWebGL2RHIDevice: backend.createWebGL2,
    isWebGL2RHIAvailable: backend.probeWebGL2
}));

vi.mock('../../../../src/render/rhi/backends/webgpu', () => ({
    createWebGPUDevice: backend.createWebGPU,
    isWebGPURHIAvailable: backend.probeWebGPU
}));

import {
    constructRHIDevice,
    createRHIDevice,
    isRHIBackendSupported,
    type WebGPURHIDeviceCreateOptions
} from '../../../../src/render/rhi/RHIFactory';

describe('RHI factory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        backend.createWebGL2.mockReturnValue(backend.webglDevice);
        backend.createWebGPU.mockResolvedValue(backend.webgpuDevice);
        backend.probeWebGL2.mockReturnValue(true);
        backend.probeWebGPU.mockResolvedValue(true);
    });

    it('constructs a concrete WebGL2 device without implicitly creating a surface', () => {
        const canvas = document.createElement('canvas');
        const context = { alpha: false, antialias: false };
        const device = constructRHIDevice('webgl2', {
            canvas,
            context,
            label: 'headless device'
        });

        expect(device).toBe(backend.webglDevice);
        expect(backend.createWebGL2).toHaveBeenCalledWith(canvas, {
            alpha: false,
            antialias: false,
            label: 'headless device'
        });
        expect(backend.webglDevice.createSurface).not.toHaveBeenCalled();
    });

    it('snapshots asynchronous WebGPU options and returns the concrete device', async () => {
        const requiredFeatures = ['timestamp-query'] as const;
        const requiredLimits = { maxTextureDimension2D: 4096 };
        const pending = createRHIDevice('webgpu', {
            powerPreference: 'high-performance',
            requiredFeatures,
            requiredLimits,
            label: 'portable device',
            mipmapShaderArtifacts
        });
        requiredLimits.maxTextureDimension2D = 1;

        await expect(pending).resolves.toBe(backend.webgpuDevice);
        expect(backend.createWebGPU).toHaveBeenCalledWith({
            powerPreference: 'high-performance',
            requiredFeatures: ['timestamp-query'],
            requiredLimits: { maxTextureDimension2D: 4096 },
            label: 'portable device',
            mipmapShaderArtifacts
        });
        expect(backend.webgpuDevice.createSurface).not.toHaveBeenCalled();
    });

    it('rejects WebGPU creation without the required mipmap artifacts', async () => {
        await expect(createRHIDevice('webgpu', {} as WebGPURHIDeviceCreateOptions)).rejects.toThrow(
            /requires GLSL\/Naga-prepared mipmap shader artifacts/u
        );
        expect(backend.createWebGPU).not.toHaveBeenCalled();
    });

    it('keeps support probes resource-free and rejects unknown backends', async () => {
        const canvas = document.createElement('canvas');
        await expect(
            isRHIBackendSupported('webgl2', { canvas, context: { depth: false } })
        ).resolves.toBe(true);
        await expect(
            isRHIBackendSupported('webgpu', { requiredFeatures: ['float32-filterable'] })
        ).resolves.toBe(true);

        expect(backend.probeWebGL2).toHaveBeenCalledWith(canvas, { depth: false });
        expect(backend.probeWebGPU).toHaveBeenCalledWith({
            requiredFeatures: ['float32-filterable']
        });
        expect(backend.createWebGL2).not.toHaveBeenCalled();
        expect(backend.createWebGPU).not.toHaveBeenCalled();
        await expect(
            createRHIDevice('invalid' as 'webgpu', { mipmapShaderArtifacts })
        ).rejects.toThrow(/Unsupported RHI backend/u);
    });
});
