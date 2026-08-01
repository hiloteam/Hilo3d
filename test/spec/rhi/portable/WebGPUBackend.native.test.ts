import { RHIBufferUsage, RHIShaderStage, RHITextureUsage } from '../../../../src/render/rhi/core';
import { ShaderArtifactCompiler } from '../../../../src/render/renderer/ShaderArtifactCompiler';
import { prepareWebGPUMipmapShaderArtifacts } from '../../../../src/render/renderer/WebGPUMipmapShader';
import { expect, it } from 'vitest';
import { createWebGPUDevice } from '../../../../src/render/rhi/backends/webgpu';
import ComputeShader from '../../../../src/render/compute/ComputeShader';
import { WgslComputeShaderCompiler } from '../../../../src/render/shader/WgslComputeCompiler';
import { expectRHIPhase2Conformance, runRHIPhase2Conformance } from './RHIPhase2Conformance';

const nativeWebGPUAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;

it.skipIf(!nativeWebGPUAvailable)(
    'validates and executes a Direct WGSL f16 compute pipeline on capable native WebGPU',
    async testContext => {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter?.features.has('shader-f16')) {
            testContext.skip();
            return;
        }
        const compiler = new WgslComputeShaderCompiler();
        await compiler.initialize();
        const compiled = compiler.compile(
            new ComputeShader({
                source: `
enable f16;
struct Output { value: f16, }
@group(0) @binding(0) var<storage, read_write> output: Output;
@compute @workgroup_size(1) fn main() { output.value = 1.5h; }
`,
                workgroupSize: [1],
                bindings: [
                    {
                        name: 'output',
                        group: 0,
                        binding: 0,
                        kind: 'storage-buffer',
                        access: 'write-discard'
                    }
                ]
            })
        );
        const device = await createWebGPUDevice({ adapter, requiredFeatures: ['shader-f16'] });
        const output = device.createBuffer({
            size: 4,
            usage: RHIBufferUsage.STORAGE | RHIBufferUsage.COPY_SRC
        });
        const readback = device.createBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        try {
            const shader = device.createShader({
                artifact: {
                    backend: 'webgpu',
                    stage: 'compute',
                    code: compiled.source,
                    entryPoint: compiled.entryPoint,
                    reflection: compiled.reflection,
                    cacheKey: compiled.cacheKey
                }
            });
            const bindGroupLayout = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: RHIShaderStage.COMPUTE,
                        buffer: { type: 'storage', minBindingSize: 2 }
                    }
                ]
            });
            const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
            const pipeline = device.createComputePipeline({ layout, compute: { shader } });
            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [{ binding: 0, resource: { buffer: output } }]
            });
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(1);
            pass.end();
            frame.copyBufferToBuffer(output, 0, readback, 0, 4);
            await device.graphicsQueue.endFrame(frame).done;
            await readback.mapAsync('read');
            expect(new Uint16Array(readback.getMappedRange())[0]).toBe(0x3e00);
            readback.unmap();
            bindGroup.destroy();
            pipeline.destroy();
            layout.destroy();
            bindGroupLayout.destroy();
            shader.destroy();
        } finally {
            output.destroy();
            readback.destroy();
            device.destroy();
        }
    }
);

it.skipIf(!nativeWebGPUAvailable)(
    'executes the shared offscreen Phase 2 scene matrix on native WebGPU',
    async testContext => {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter === null) {
            testContext.skip();
            return;
        }
        const compiler = new ShaderArtifactCompiler();
        await compiler.initialize();
        const device = await createWebGPUDevice({
            adapter,
            mipmapShaderArtifacts: prepareWebGPUMipmapShaderArtifacts(compiler)
        });
        const canvas = document.createElement('canvas');
        const progress: string[] = [];
        try {
            const result = await runRHIPhase2Conformance({
                device,
                canvas,
                surfaceMode: 'omit',
                progress
            });
            expectRHIPhase2Conformance(result);
        } catch (error) {
            const tail = progress.slice(-8).join(' -> ') || 'before the first recorded command';
            throw new Error(`Native WebGPU conformance failed after: ${tail}`, { cause: error });
        } finally {
            device.destroy();
        }
    }
);

it.skipIf(!nativeWebGPUAvailable)(
    'executes clearBuffer and an indirect compute dispatch on native WebGPU',
    async testContext => {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter === null) {
            testContext.skip();
            return;
        }
        const device = await createWebGPUDevice({ adapter });
        const output = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.STORAGE | RHIBufferUsage.COPY_SRC | RHIBufferUsage.COPY_DST,
            initialData: new Uint32Array([99, 99, 99, 99])
        });
        const indirect = device.createBuffer({
            size: 12,
            usage: RHIBufferUsage.INDIRECT,
            initialData: new Uint32Array([4, 1, 1])
        });
        const readback = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        try {
            const shader = device.createShader({
                artifact: {
                    backend: 'webgpu',
                    stage: 'compute',
                    code: `
@group(0) @binding(0) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    output[id.x] = id.x + 1u;
}`,
                    entryPoint: 'main',
                    reflection: {
                        bindings: [
                            {
                                group: 0,
                                binding: 0,
                                kind: 'storage-buffer',
                                minBindingSize: 16
                            }
                        ],
                        workgroupSize: [1, 1, 1],
                        workgroupStorageSize: 0,
                        overrides: []
                    },
                    cacheKey: 1
                }
            });
            const bindGroupLayout = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: RHIShaderStage.COMPUTE,
                        buffer: { type: 'storage', minBindingSize: 16 }
                    }
                ]
            });
            const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
            const pipeline = device.createComputePipeline({ layout, compute: { shader } });
            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [{ binding: 0, resource: { buffer: output } }]
            });

            const frame = device.graphicsQueue.beginFrame();
            frame.clearBuffer(output);
            const pass = frame.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroupsIndirect(indirect);
            pass.end();
            frame.copyBufferToBuffer(output, 0, readback, 0, 16);
            await device.graphicsQueue.endFrame(frame).done;
            await readback.mapAsync('read');
            expect([...new Uint32Array(readback.getMappedRange())]).toEqual([1, 2, 3, 4]);
            readback.unmap();
        } finally {
            output.destroy();
            indirect.destroy();
            readback.destroy();
            device.destroy();
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
        const compiler = new ShaderArtifactCompiler();
        await compiler.initialize();
        const device = await createWebGPUDevice({
            adapter,
            mipmapShaderArtifacts: prepareWebGPUMipmapShaderArtifacts(compiler)
        });
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
