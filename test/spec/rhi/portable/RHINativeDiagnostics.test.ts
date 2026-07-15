import { describe, expect, it } from 'vitest';
import { RendererDiagnostics } from '../../../../src/render/RendererDiagnostics';
import { createWebGL2RHIDevice } from '../../../../src/render/rhi/backends/webgl2';
import { WebGPUDevice } from '../../../../src/render/rhi/backends/webgpu';
import { RHIBufferUsage, RHITextureUsage } from '../../../../src/render/rhi/core/RHITypes';
import { createFakeWebGL2 } from '../FakeWebGL2';
import { createStructuredWebGPUMock } from './StructuredWebGPUMock';

function createWebGLPipeline(device: ReturnType<typeof createWebGL2RHIDevice>) {
    const vertex = device.createShader({
        artifact: {
            backend: 'webgl2',
            stage: 'vertex',
            code: `#version 300 es
void main() { gl_Position = vec4(0.0); }`,
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 1
        }
    });
    const fragment = device.createShader({
        artifact: {
            backend: 'webgl2',
            stage: 'fragment',
            code: `#version 300 es
precision highp float;
out vec4 color;
void main() { color = vec4(1.0); }`,
            entryPoint: 'main',
            reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
            cacheKey: 2
        }
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    return device.createGraphicsPipeline({
        layout,
        vertex: { shader: vertex, buffers: [] },
        fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
        primitive: {}
    });
}

function createWebGPUPipeline(device: WebGPUDevice) {
    const vertex = device.createShader({
        artifact: {
            backend: 'webgpu',
            stage: 'vertex',
            code: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 11
        }
    });
    const fragment = device.createShader({
        artifact: {
            backend: 'webgpu',
            stage: 'fragment',
            code: '@fragment fn main() -> @location(0) vec4f { return vec4f(1); }',
            entryPoint: 'main',
            reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
            cacheKey: 12
        }
    });
    const bindGroupLayout = device.createBindGroupLayout({ entries: [] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const bindGroup = device.createBindGroup({ layout: bindGroupLayout, entries: [] });
    const pipeline = device.createGraphicsPipeline({
        layout,
        vertex: { shader: vertex },
        fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
        primitive: {}
    });
    return { bindGroup, bindGroupLayout, fragment, layout, pipeline, vertex };
}

describe('RHI native object diagnostics', () => {
    it('balances every WebGL2 native object at explicit device destruction', () => {
        const fake = createFakeWebGL2();
        const diagnostics = new RendererDiagnostics();
        const device = createWebGL2RHIDevice(fake.gl, { diagnosticsSink: diagnostics });
        const transferDestination = device.createBuffer({
            size: 256,
            usage: RHIBufferUsage.COPY_DST
        });
        const color = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage:
                RHITextureUsage.RENDER_ATTACHMENT |
                RHITextureUsage.COPY_DST |
                RHITextureUsage.COPY_SRC
        });
        device.createTexture({
            size: { width: 4, height: 4 },
            sampleCount: 4,
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        device.createSampler();
        const pipeline = createWebGLPipeline(device);
        const frame = device.graphicsQueue.beginFrame();
        frame.writeTexture(
            { texture: color },
            new Uint8Array(4 * 4 * 4),
            { bytesPerRow: 16 },
            { width: 4, height: 4 }
        );
        frame.copyTextureToBuffer(
            { texture: color },
            { buffer: transferDestination, bytesPerRow: 256 },
            { width: 4, height: 1 }
        );
        const pass = frame.beginRenderPass({
            colorAttachments: [
                {
                    view: color.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        pass.draw(3);
        pass.end();
        device.graphicsQueue.endFrame(frame);

        expect(diagnostics.snapshot().nativeObjects).toMatchObject({
            buffer: { created: 2, destroyed: 0, live: 2, highWater: 2 },
            texture: { created: 1, destroyed: 0, live: 1, highWater: 1 },
            sampler: { created: 1, destroyed: 0, live: 1, highWater: 1 },
            shaderModule: { created: 2, destroyed: 0, live: 2, highWater: 2 },
            program: { created: 1, destroyed: 0, live: 1, highWater: 1 },
            framebuffer: { created: 2, destroyed: 0, live: 2, highWater: 2 },
            renderbuffer: { created: 1, destroyed: 0, live: 1, highWater: 1 },
            vertexArray: { created: 1, destroyed: 0, live: 1, highWater: 1 }
        });

        device.destroy();

        const afterDestroy = diagnostics.snapshot().nativeObjects;
        for (const kind of [
            'buffer',
            'texture',
            'sampler',
            'shaderModule',
            'program',
            'framebuffer',
            'renderbuffer',
            'vertexArray'
        ] as const) {
            expect(afterDestroy[kind].destroyed).toBe(afterDestroy[kind].created);
            expect(afterDestroy[kind].live).toBe(0);
        }
    });

    it('settles WebGL2 lifetimes on context loss and remains balanced after replacement', async () => {
        const diagnostics = new RendererDiagnostics();
        const firstFake = createFakeWebGL2();
        const first = createWebGL2RHIDevice(firstFake.gl, { diagnosticsSink: diagnostics });
        first.createBuffer({ size: 16, usage: RHIBufferUsage.COPY_DST });
        const firstUploadTexture = first.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.COPY_DST
        });
        const firstFrame = first.graphicsQueue.beginFrame();
        firstFrame.writeTexture(
            { texture: firstUploadTexture },
            new Uint8Array(16),
            { bytesPerRow: 8 },
            { width: 2, height: 2 }
        );
        first.graphicsQueue.endFrame(firstFrame);

        const lostEvent = new Event('webglcontextlost', { cancelable: true });
        firstFake.canvas.dispatchEvent(lostEvent);
        await first.lost;

        expect(lostEvent.defaultPrevented).toBe(true);
        expect(diagnostics.snapshot().nativeObjects).toMatchObject({
            buffer: { created: 2, destroyed: 2, live: 0 },
            texture: { created: 1, destroyed: 1, live: 0 }
        });

        first.destroy();
        const replacementFake = createFakeWebGL2();
        const replacement = createWebGL2RHIDevice(replacementFake.gl, {
            diagnosticsSink: diagnostics
        });
        replacement.createBuffer({ size: 16, usage: RHIBufferUsage.COPY_DST });
        const replacementUploadTexture = replacement.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.COPY_DST
        });
        const replacementFrame = replacement.graphicsQueue.beginFrame();
        replacementFrame.writeTexture(
            { texture: replacementUploadTexture },
            new Uint8Array(16),
            { bytesPerRow: 8 },
            { width: 2, height: 2 }
        );
        replacement.graphicsQueue.endFrame(replacementFrame);
        replacement.destroy();

        expect(diagnostics.snapshot().nativeObjects).toMatchObject({
            buffer: { created: 4, destroyed: 4, live: 0 },
            texture: { created: 2, destroyed: 2, live: 0 }
        });
    });

    it('reports WebGPU destroyable allocations and creation-only native handles honestly', async () => {
        const mock = createStructuredWebGPUMock();
        const diagnostics = new RendererDiagnostics();
        const device = new WebGPUDevice(mock.device, diagnostics);
        const uploadDestination = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        const texture = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        texture.createView();
        device.createSampler();
        createWebGPUPipeline(device);
        const frame = device.graphicsQueue.beginFrame();
        frame.writeBuffer(uploadDestination, 0, new Uint8Array(4));
        const submission = device.graphicsQueue.endFrame(frame);
        await submission.done;

        expect(diagnostics.snapshot().nativeObjects).toMatchObject({
            buffer: { created: 2, destroyed: 0, live: 2, highWater: 2 },
            texture: { created: 1, destroyed: 0, live: 1, highWater: 1 },
            textureView: { created: 1, destroyed: null, live: null, highWater: null },
            sampler: { created: 1, destroyed: null, live: null, highWater: null },
            shaderModule: { created: 2, destroyed: null, live: null, highWater: null },
            pipeline: { created: 1, destroyed: null, live: null, highWater: null },
            bindGroupLayout: { created: 1, destroyed: null, live: null, highWater: null },
            pipelineLayout: { created: 1, destroyed: null, live: null, highWater: null },
            bindGroup: { created: 1, destroyed: null, live: null, highWater: null },
            commandEncoder: { created: 1, destroyed: null, live: null, highWater: null },
            commandBuffer: { created: 1, destroyed: null, live: null, highWater: null }
        });

        device.destroy();

        expect(diagnostics.snapshot().nativeObjects).toMatchObject({
            buffer: { created: 2, destroyed: 2, live: 0 },
            texture: { created: 1, destroyed: 1, live: 0 }
        });
    });

    it('settles WebGPU allocations on loss and remains balanced after replacement', async () => {
        const diagnostics = new RendererDiagnostics();
        const firstMock = createStructuredWebGPUMock();
        const first = new WebGPUDevice(firstMock.device, diagnostics);
        const firstUploadBuffer = first.createBuffer({
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        first.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const firstUploadFrame = first.graphicsQueue.beginFrame();
        firstUploadFrame.writeBuffer(firstUploadBuffer, 0, new Uint8Array(4));
        await first.graphicsQueue.endFrame(firstUploadFrame).done;

        firstMock.loseDevice();
        await first.lost;

        expect(diagnostics.snapshot().nativeObjects).toMatchObject({
            buffer: { created: 2, destroyed: 2, live: 0 },
            texture: { created: 1, destroyed: 1, live: 0 }
        });

        first.destroy();
        const replacementMock = createStructuredWebGPUMock();
        const replacement = new WebGPUDevice(replacementMock.device, diagnostics);
        const replacementUploadBuffer = replacement.createBuffer({
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        replacement.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const replacementUploadFrame = replacement.graphicsQueue.beginFrame();
        replacementUploadFrame.writeBuffer(replacementUploadBuffer, 0, new Uint8Array(4));
        await replacement.graphicsQueue.endFrame(replacementUploadFrame).done;
        replacement.destroy();

        expect(diagnostics.snapshot().nativeObjects).toMatchObject({
            buffer: { created: 4, destroyed: 4, live: 0 },
            texture: { created: 2, destroyed: 2, live: 0 }
        });
    });
});
