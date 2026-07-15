import { describe, expect, it } from 'vitest';
import GeometryData from '../../../src/geometry/GeometryData';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHIBuffer,
    type RHIDevice,
    type RHIGraphicsPipeline
} from '../../../src/render/rhi/core';
import { createWebGL2RHIDevice } from '../../../src/render/rhi/backends/webgl2';
import { PreparedDrawCache, type PreparedDraw } from '../../../src/render/renderer/PreparedDraw';
import { mapRHIFloat32PositionLayout } from '../../../src/render/renderer/RHIDescriptorMapping';
import {
    ShaderArtifactCompiler,
    type CompiledShaderArtifactPair
} from '../../../src/render/renderer/ShaderArtifactCompiler';
import {
    compileShaderBindingLayout,
    type ShaderBindingLayoutPlan
} from '../../../src/render/renderer/ShaderBindingLayoutCompiler';
import Shader from '../../../src/shader/Shader';
import { FakeWebGPURHIBackend } from '../rhi/v2/FakeRHIBackend';

const WIDTH = 8;
const HEIGHT = 8;
const BYTES_PER_ROW = 256;
const TRIANGLE_POSITIONS = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);

const VERTEX_SOURCE = `#version 300 es
in vec3 position;
void main() {
    gl_Position = vec4(position, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
out vec4 color;
void main() {
    color = vec4(1.0, 0.0, 0.0, 1.0);
}`;

interface PipelineSlice {
    readonly pipeline: RHIGraphicsPipeline;
    readonly vertexBuffer: RHIBuffer;
    readonly bindingPlan: Readonly<ShaderBindingLayoutPlan>;
    readonly positionLocation: number;
}

interface RecordingControl {
    readonly calls: string[];
}

function recordingContext(
    context: WebGL2RenderingContext,
    control: RecordingControl
): WebGL2RenderingContext {
    return new Proxy(context, {
        get(target, property) {
            const value: unknown = Reflect.get(target, property, target);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
                control.calls.push(String(property));
                return Reflect.apply(value, target, args) as unknown;
            };
        }
    });
}

function createShader(): Shader {
    return new Shader({ vs: VERTEX_SOURCE, fs: FRAGMENT_SOURCE });
}

function createPipelineSlice(
    device: RHIDevice,
    artifact: CompiledShaderArtifactPair
): PipelineSlice {
    const positionInput = artifact.metadata.vertexInputs.find(input => input.name === 'position');
    if (!positionInput) throw new Error('Compiled shader lost the position input');
    const position = new GeometryData(TRIANGLE_POSITIONS, 3);
    const vertexLayout = mapRHIFloat32PositionLayout(position, positionInput.location);
    const bindingPlan = compileShaderBindingLayout(
        artifact,
        device.capabilities.limits.maxBindGroups
    );
    const bindGroupLayouts = bindingPlan.bindGroupLayoutDescriptors.map(descriptor =>
        device.createBindGroupLayout(descriptor)
    );
    const layout = device.createPipelineLayout({ bindGroupLayouts });
    const vertex = device.createShader({ artifact: artifact.vertex });
    const fragment = device.createShader({ artifact: artifact.fragment });
    const pipeline = device.createGraphicsPipeline({
        label: 'shader artifact integration pipeline',
        layout,
        vertex: { shader: vertex, buffers: [vertexLayout] },
        fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        multisample: { count: 1 }
    });
    const vertexBuffer = device.createBuffer({
        label: 'shader artifact integration positions',
        size: TRIANGLE_POSITIONS.byteLength,
        usage: RHIBufferUsage.VERTEX,
        initialData: TRIANGLE_POSITIONS
    });
    return { pipeline, vertexBuffer, bindingPlan, positionLocation: positionInput.location };
}

function prepareTriangle(slice: PipelineSlice, device: RHIDevice): PreparedDraw {
    const prepared = new PreparedDrawCache<object>(1, 1).prepare(
        {},
        {
            geometry: 1,
            materialVariant: 1,
            renderState: 1,
            resourceBindings: 1,
            target: 1,
            deviceGeneration: device.generation
        },
        draw => {
            draw.setPipeline(slice.pipeline);
            draw.setVertexBuffer(0, slice.vertexBuffer);
            draw.setDraw(3);
        }
    );
    prepared.prepareVertexInput();
    return prepared;
}

function createColorTarget(device: RHIDevice) {
    return device.createTexture({
        label: 'shader artifact integration color',
        size: { width: WIDTH, height: HEIGHT },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
    });
}

describe('ShaderArtifactCompiler to RHI integration', () => {
    it('draws a compiler-produced WebGL2 artifact and reads the center pixel', async () => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('webgl2');
        if (context === null) return;
        const control: RecordingControl = { calls: [] };
        const device = createWebGL2RHIDevice(recordingContext(context, control));
        try {
            const artifact = new ShaderArtifactCompiler().compile(createShader(), 'webgl2');
            const slice = createPipelineSlice(device, artifact);
            const prepared = prepareTriangle(slice, device);
            const preparedVertexArrayCount = control.calls.filter(
                call => call === 'createVertexArray'
            ).length;
            expect(preparedVertexArrayCount).toBe(1);
            expect(device.vertexInputCacheMetrics).toMatchObject({
                hits: 0,
                misses: 0,
                evictions: 0,
                size: 1,
                highWater: 1
            });
            const color = createColorTarget(device);
            const readback = device.createBuffer({
                label: 'shader artifact integration readback',
                size: HEIGHT * BYTES_PER_ROW,
                usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
            });

            expect(artifact.metadata.samplers).toEqual([]);
            expect(slice.bindingPlan.uniformBlocks).toEqual([]);
            expect(slice.positionLocation).toBe(0);
            const bindAttribute = control.calls.indexOf('bindAttribLocation');
            const linkProgram = control.calls.indexOf('linkProgram');
            expect(bindAttribute).toBeGreaterThanOrEqual(0);
            expect(bindAttribute).toBeLessThan(linkProgram);

            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass({
                label: 'shader artifact integration pass',
                colorAttachments: [
                    {
                        view: color.createView(),
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'store'
                    }
                ]
            });
            prepared.execute(pass);
            expect(control.calls.filter(call => call === 'createVertexArray')).toHaveLength(
                preparedVertexArrayCount
            );
            expect(device.vertexInputCacheMetrics).toMatchObject({
                hits: 0,
                misses: 1,
                evictions: 0,
                size: 1,
                highWater: 1
            });
            pass.end();
            frame.copyTextureToBuffer(
                { texture: color },
                { buffer: readback, bytesPerRow: BYTES_PER_ROW },
                { width: WIDTH, height: HEIGHT }
            );
            const submission = device.graphicsQueue.endFrame(frame);
            await submission.done;
            await readback.mapAsync('read');
            const bytes = new Uint8Array(readback.getMappedRange());
            const centerOffset = Math.floor(HEIGHT / 2) * BYTES_PER_ROW + Math.floor(WIDTH / 2) * 4;
            expect([...bytes.slice(centerOffset, centerOffset + 4)]).toEqual([255, 0, 0, 255]);
            readback.unmap();
        } finally {
            device.destroy();
        }
    });

    it('executes the real Naga WebGPU artifact through the same descriptor and PreparedDraw path', async () => {
        const compiler = new ShaderArtifactCompiler();
        await compiler.initialize();
        const artifact = compiler.compile(createShader(), 'webgpu');
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        try {
            const slice = createPipelineSlice(device, artifact);
            const prepared = prepareTriangle(slice, device);
            const color = createColorTarget(device);

            expect(artifact.vertex.code).toContain('@vertex');
            expect(artifact.fragment.code).toContain('@fragment');
            expect(artifact.metadata.samplers).toEqual([]);
            expect(slice.bindingPlan.uniformBlocks).toEqual([]);
            expect(slice.positionLocation).toBe(0);

            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass({
                label: 'shader artifact integration pass',
                colorAttachments: [
                    {
                        view: color.createView(),
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'store'
                    }
                ]
            });
            prepared.execute(pass);
            pass.end();
            const submission = device.graphicsQueue.endFrame(frame);

            expect(backend.executionLog).toEqual([
                'render-pass:shader artifact integration pass:begin',
                `pipeline:${String(slice.pipeline.id)}`,
                `vertex-buffer:0:${String(slice.vertexBuffer.id)}`,
                'draw:3',
                'render-pass:end'
            ]);
            backend.completeNextSubmission();
            await submission.done;
        } finally {
            backend.destroy();
        }
    });
});
