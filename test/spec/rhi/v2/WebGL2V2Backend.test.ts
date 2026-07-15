import { describe, expect, it, vi } from 'vitest';
import { RendererDiagnostics } from '../../../../src/render/RendererDiagnostics';
import {
    RHIBufferUsage,
    RHIValidationError,
    RHIShaderStage,
    RHITextureUsage,
    type RHIBuffer,
    type RHIExecutionInteropHost,
    type RHIGraphicsPipeline,
    type RHISurface,
    type RHITexture
} from '../../../../src/render/rhi/core';
import {
    type WebGL2RHIDevice,
    type WebGL2NativeExtension,
    createWebGL2RHIDevice
} from '../../../../src/render/rhi/backends/webgl2';

function prepareIndexedPipeline(pipeline: RHIGraphicsPipeline, buffer: RHIBuffer): void {
    pipeline.prepareVertexInput({
        vertexBuffers: [],
        indexBuffer: { buffer, format: 'uint16', offset: 0 }
    });
}

interface RecordingControl {
    readonly calls: string[];
    readonly callArguments?: { readonly name: string; readonly args: readonly unknown[] }[];
    failDraw: boolean;
    stickyDrawError?: boolean;
    drawErrorPending?: boolean;
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
                const name = String(property);
                control.calls.push(name);
                control.callArguments?.push({ name, args });
                if (name === 'getError' && control.drawErrorPending === true) {
                    control.drawErrorPending = false;
                    return target.INVALID_OPERATION;
                }
                if (control.failDraw && (name === 'drawArrays' || name === 'drawElements')) {
                    throw new Error('injected native draw failure');
                }
                const result: unknown = Reflect.apply(value, target, args);
                if (
                    control.stickyDrawError === true &&
                    (name === 'drawArrays' || name === 'drawElements')
                ) {
                    control.drawErrorPending = true;
                }
                return result;
            };
        }
    });
}

function createSolidPipeline(
    device: WebGL2RHIDevice,
    sampleCount = 1,
    depthFormat?: 'depth24plus',
    inactiveColorTarget = false
): RHIGraphicsPipeline {
    const vertex = device.createShader({
        artifact: {
            backend: 'webgl2',
            stage: 'vertex',
            code: `#version 300 es
const vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`,
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
void main() { color = vec4(1.0, 0.0, 0.0, 1.0); }`,
            entryPoint: 'main',
            reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
            cacheKey: 2
        }
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    return device.createGraphicsPipeline({
        layout,
        vertex: { shader: vertex, buffers: [] },
        fragment: {
            shader: fragment,
            targets: [
                { format: 'rgba8unorm' },
                ...(inactiveColorTarget
                    ? ([{ format: 'rgba8unorm' as const, writeMask: 0 }] as const)
                    : [])
            ]
        },
        primitive: { topology: 'triangle-list' },
        ...(depthFormat === undefined
            ? {}
            : { depthStencil: { format: depthFormat, depthWriteEnabled: true } }),
        multisample: { count: sampleCount }
    });
}

function createVertexPipeline(device: WebGL2RHIDevice): RHIGraphicsPipeline {
    const vertex = device.createShader({
        artifact: {
            backend: 'webgl2',
            stage: 'vertex',
            code: `#version 300 es
layout(location = 0) in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`,
            entryPoint: 'main',
            reflection: {
                bindings: [],
                vertexInputs: [{ location: 0, name: 'position' }]
            },
            cacheKey: 91
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
            cacheKey: 92
        }
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    return device.createGraphicsPipeline({
        layout,
        vertex: {
            shader: vertex,
            buffers: [
                {
                    arrayStride: 8,
                    attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 0 }]
                }
            ]
        },
        fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' }
    });
}

function createPreparedBindingPipeline(device: WebGL2RHIDevice, dynamicUniform = false) {
    const groupLayout = device.createBindGroupLayout({
        entries: [
            {
                binding: 5,
                visibility: RHIShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: dynamicUniform,
                    minBindingSize: 16
                }
            },
            {
                binding: 9,
                visibility: RHIShaderStage.FRAGMENT,
                texture: { sampleType: 'float', viewDimension: '2d' }
            },
            {
                binding: 2,
                visibility: RHIShaderStage.FRAGMENT,
                sampler: { type: 'filtering' }
            }
        ]
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] });
    const vertex = device.createShader({
        artifact: {
            backend: 'webgl2',
            stage: 'vertex',
            code: `#version 300 es
const vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`,
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 101
        }
    });
    const fragment = device.createShader({
        artifact: {
            backend: 'webgl2',
            stage: 'fragment',
            code: `#version 300 es
precision highp float;
layout(std140) uniform Globals { vec4 tint; };
uniform sampler2D sourceTexture;
out vec4 color;
void main() { color = tint + texture(sourceTexture, vec2(0.5)); }`,
            entryPoint: 'main',
            reflection: {
                bindings: [
                    { group: 0, binding: 5, kind: 'uniform-buffer' },
                    { group: 0, binding: 9, kind: 'sampled-texture' },
                    { group: 0, binding: 2, kind: 'sampler' }
                ],
                fragmentOutputs: [{ location: 0 }]
            },
            preparedBindings: {
                uniformBlocks: [{ name: 'Globals', group: 0, binding: 5 }],
                combinedSamplers: [
                    {
                        name: 'sourceTexture',
                        group: 0,
                        textureBinding: 9,
                        samplerBinding: 2,
                        arrayIndex: 0
                    }
                ]
            },
            cacheKey: 102
        }
    });
    const pipeline = device.createGraphicsPipeline({
        layout,
        vertex: { shader: vertex, buffers: [] },
        fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' }
    });
    return { groupLayout, pipeline };
}

function createColorPass(device: WebGL2RHIDevice) {
    const texture = device.createTexture({
        size: { width: 8, height: 8 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
    });
    return {
        texture,
        descriptor: {
            colorAttachments: [
                {
                    view: texture.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear' as const,
                    storeOp: 'store' as const
                }
            ]
        }
    };
}

function createInteropHost(device: WebGL2RHIDevice, surface: RHISurface) {
    let viewport = null as Parameters<RHIExecutionInteropHost['setPresentationViewport']>[0];
    let executionCount = 0;
    const host: RHIExecutionInteropHost = {
        get executionDevice() {
            return device;
        },
        get presentationSurface() {
            return surface;
        },
        assertPresentationMutationAllowed() {
            return undefined;
        },
        executeRetainedPresentation() {
            executionCount++;
        },
        setPresentationViewport(value) {
            viewport = value;
        }
    };
    return {
        host,
        get viewport() {
            return viewport;
        },
        get executionCount() {
            return executionCount;
        }
    };
}

function createExternalColorFramebuffer(
    gl: WebGL2RenderingContext,
    width: number,
    height: number
): { readonly framebuffer: WebGLFramebuffer; readonly texture: WebGLTexture } {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('External framebuffer fixture is incomplete');
    }
    return { framebuffer, texture };
}

function readFramebufferPixel(
    gl: WebGL2RenderingContext,
    framebuffer: WebGLFramebuffer,
    x: number,
    y: number
): number[] {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
}

async function readTexturePixel(
    device: WebGL2RHIDevice,
    texture: RHITexture,
    mipLevel = 0,
    arrayLayer = 0
): Promise<number[]> {
    const width = Math.max(1, Math.floor(texture.width / 2 ** mipLevel));
    const height = Math.max(1, Math.floor(texture.height / 2 ** mipLevel));
    const bytesPerRow = 256;
    const readback = device.createBuffer({
        size: height * bytesPerRow,
        usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
    });
    const frame = device.graphicsQueue.beginFrame();
    frame.copyTextureToBuffer(
        { texture, mipLevel, origin: { z: arrayLayer } },
        { buffer: readback, bytesPerRow },
        { width, height }
    );
    device.graphicsQueue.endFrame(frame);
    await readback.mapAsync('read');
    const bytes = new Uint8Array(readback.getMappedRange());
    const offset = Math.floor(height / 2) * bytesPerRow + Math.floor(width / 2) * 4;
    const pixel = [...bytes.slice(offset, offset + 4)];
    readback.unmap();
    readback.destroy();
    return pixel;
}

describe('RHI v2 WebGL2 immediate backend', () => {
    it('deduplicates scalar numeric state and uniform ranges across reset boundaries', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const uniform = device.createBuffer({ size: 16, usage: RHIBufferUsage.UNIFORM });
        const frame = device.graphicsQueue.beginFrame();
        control.calls.length = 0;

        const applyState = (): void => {
            device.state.setViewport(0.25, 0.5, 7.5, 6.75);
            device.state.setScissor(1, 2, 3, 4);
            device.state.setDepthRange(0.125, 0.875);
            device.state.setBlendColor(0.1, 0.2, 0.3, 0.4);
            device.state.setStencilFace(
                native.FRONT,
                native.ALWAYS,
                7,
                0xffffffff,
                native.KEEP,
                native.REPLACE,
                native.INCR
            );
            device.state.setStencilFace(
                native.BACK,
                native.NEVER,
                9,
                0x7fffffff,
                native.ZERO,
                native.DECR,
                native.INVERT
            );
            device.state.bindUniformBufferRange(0, uniform.native, 0, 16);
        };

        applyState();
        const nativeCallsAfterFirstApply = frame.diagnostics.nativeStateCalls;
        expect(nativeCallsAfterFirstApply).toBe(10);
        applyState();
        expect(frame.diagnostics.nativeStateCalls).toBe(nativeCallsAfterFirstApply);
        expect(control.calls.filter(name => name === 'viewport')).toHaveLength(1);
        expect(control.calls.filter(name => name === 'scissor')).toHaveLength(1);
        expect(control.calls.filter(name => name === 'depthRange')).toHaveLength(1);
        expect(control.calls.filter(name => name === 'blendColor')).toHaveLength(1);
        expect(control.calls.filter(name => name === 'stencilFuncSeparate')).toHaveLength(2);
        expect(control.calls.filter(name => name === 'stencilOpSeparate')).toHaveLength(2);
        expect(control.calls.filter(name => name === 'bindBufferRange')).toHaveLength(1);

        device.state.reset();
        applyState();
        expect(frame.diagnostics.nativeStateCalls).toBe(nativeCallsAfterFirstApply * 2);
        expect(control.calls.filter(name => name === 'viewport')).toHaveLength(2);
        expect(control.calls.filter(name => name === 'stencilFuncSeparate')).toHaveLength(4);
        expect(control.calls.filter(name => name === 'bindBufferRange')).toHaveLength(2);
        device.graphicsQueue.abortFrame(frame);
        device.destroy();
    });

    it('rebinds the generic uniform target after an indexed range changes it', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const upload = device.createBuffer({ size: 16, usage: RHIBufferUsage.UNIFORM });
        const draw = device.createBuffer({ size: 16, usage: RHIBufferUsage.UNIFORM });

        device.state.bindBuffer(native.UNIFORM_BUFFER, upload.native);
        device.state.bindUniformBufferRange(0, draw.native, 0, 16);
        control.calls.length = 0;
        device.state.bindBuffer(native.UNIFORM_BUFFER, upload.native);

        expect(control.calls.filter(name => name === 'bindBuffer')).toHaveLength(1);
        expect(native.getParameter(native.UNIFORM_BUFFER_BINDING)).toBe(upload.native);
        device.destroy();
    });

    it('reads reused viewport and scissor records directly on every command', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = { calls: [], callArguments, failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const descriptor = createColorPass(device).descriptor;
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(descriptor);
        callArguments.length = 0;

        let recordValidationError: unknown;
        try {
            pass.setViewportRecord({
                x: Number.NaN,
                y: 0,
                width: 8,
                height: 8,
                minDepth: 0,
                maxDepth: 1
            });
        } catch (error) {
            recordValidationError = error;
        }
        expect(recordValidationError).toMatchObject({
            code: 'invalid-descriptor',
            path: 'renderPass.viewport'
        });

        const viewport = {
            x: 0.25,
            y: 0.5,
            width: 7.5,
            height: 6.75,
            minDepth: 0.125,
            maxDepth: 0.875
        };
        pass.setViewportRecord(viewport);
        viewport.x = 1;
        viewport.y = 2;
        viewport.width = 6;
        viewport.height = 5;
        viewport.minDepth = 0.25;
        viewport.maxDepth = 0.75;
        pass.setViewportRecord(viewport);

        const scissor = { x: 1, y: 2, width: 3, height: 4 };
        pass.setScissorRectRecord(scissor);
        scissor.x = 2;
        scissor.y = 1;
        scissor.width = 4;
        scissor.height = 3;
        pass.setScissorRectRecord(scissor);

        expect(
            callArguments.filter(call => call.name === 'viewport').map(call => call.args)
        ).toEqual([
            [0.25, 0.5, 7.5, 6.75],
            [1, 2, 6, 5]
        ]);
        expect(
            callArguments.filter(call => call.name === 'depthRange').map(call => call.args)
        ).toEqual([
            [0.125, 0.875],
            [0.25, 0.75]
        ]);
        expect(
            callArguments.filter(call => call.name === 'scissor').map(call => call.args)
        ).toEqual([
            [1, 2, 3, 4],
            [2, 1, 4, 3]
        ]);

        pass.end();
        device.graphicsQueue.endFrame(frame);
        device.destroy();
    });

    it('reads reused vertex, index, and draw records directly on every command', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = { calls: [], callArguments, failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createVertexPipeline(device);
        const vertexBuffer = device.createBuffer({
            size: 32,
            usage: RHIBufferUsage.VERTEX,
            initialData: new Float32Array([-1, -1, 1, -1, 0, 1, 0.5, 0.5])
        });
        const indexBuffer = device.createBuffer({
            size: 12,
            usage: RHIBufferUsage.INDEX,
            initialData: new Uint16Array([0, 1, 2, 1, 2, 0])
        });
        const vertexInputBinding = { buffer: vertexBuffer, offset: 0 };
        const vertexInput = {
            vertexBuffers: [vertexInputBinding],
            indexBuffer: null as {
                buffer: typeof indexBuffer;
                format: 'uint16';
                offset: number;
            } | null
        };
        pipeline.prepareVertexInput(vertexInput);
        vertexInputBinding.offset = 8;
        pipeline.prepareVertexInput(vertexInput);
        vertexInput.indexBuffer = {
            buffer: indexBuffer,
            format: 'uint16',
            offset: 0
        };
        pipeline.prepareVertexInput(vertexInput);
        vertexInput.indexBuffer.offset = 2;
        pipeline.prepareVertexInput(vertexInput);

        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(createColorPass(device).descriptor);
        pass.setPipeline(pipeline);
        callArguments.length = 0;
        const vertexRecord = {
            slot: 0,
            buffer: vertexBuffer,
            offset: 0,
            size: undefined as number | undefined
        };
        const indexRecord = {
            buffer: indexBuffer,
            format: 'uint16' as const,
            offset: 0,
            size: undefined as number | undefined
        };
        const drawRecord = {
            elementCount: 3,
            instanceCount: 1,
            firstElement: 0,
            baseVertex: 0,
            firstInstance: 0
        };

        expect(() => {
            pass.setVertexBuffer(-1, vertexBuffer);
        }).toThrow(
            expect.objectContaining({ code: 'out-of-bounds', path: 'renderPass.vertexBuffer' })
        );
        expect(() => {
            pass.setVertexBufferRecord({ ...vertexRecord, slot: -1 });
        }).toThrow(
            expect.objectContaining({ code: 'out-of-bounds', path: 'renderPass.vertexBuffer' })
        );
        expect(() => {
            pass.setIndexBuffer(indexBuffer, 'uint16', 1, 2);
        }).toThrow(
            expect.objectContaining({ code: 'out-of-bounds', path: 'renderPass.indexBuffer' })
        );
        expect(() => {
            pass.setIndexBufferRecord({ ...indexRecord, offset: 1, size: 2 });
        }).toThrow(
            expect.objectContaining({ code: 'out-of-bounds', path: 'renderPass.indexBuffer' })
        );
        expect(() => {
            pass.drawIndexed(3, 1, 0, 1, 0);
        }).toThrow(
            expect.objectContaining({
                code: 'unsupported-feature',
                path: 'renderPass.drawIndexed.baseVertex'
            })
        );
        expect(() => {
            pass.drawIndexedRecord({ ...drawRecord, baseVertex: 1 });
        }).toThrow(
            expect.objectContaining({
                code: 'unsupported-feature',
                path: 'renderPass.drawIndexed.baseVertex'
            })
        );

        pass.setVertexBufferRecord(vertexRecord);
        pass.drawRecord(drawRecord);
        vertexRecord.offset = 8;
        pass.setVertexBufferRecord(vertexRecord);
        pass.drawRecord(drawRecord);
        pass.setIndexBufferRecord(indexRecord);
        pass.drawIndexedRecord(drawRecord);
        pass.setViewportRecord({ x: 0, y: 0, width: 4, height: 4, minDepth: 0, maxDepth: 1 });
        control.stickyDrawError = true;
        indexRecord.offset = 2;
        pass.setIndexBufferRecord(indexRecord);
        pass.drawIndexedRecord(drawRecord);

        expect(
            callArguments.filter(call => call.name === 'drawArrays').map(call => call.args)
        ).toEqual([
            [native.TRIANGLES, 0, 3],
            [native.TRIANGLES, 0, 3]
        ]);
        expect(
            callArguments.filter(call => call.name === 'drawElements').map(call => call.args)
        ).toEqual([
            [native.TRIANGLES, 3, native.UNSIGNED_SHORT, 0],
            [native.TRIANGLES, 3, native.UNSIGNED_SHORT, 2]
        ]);
        expect(frame.diagnostics.drawCount).toBe(4);
        expect(frame.diagnostics.vertexBufferSwitches).toBe(2);

        expect(() => {
            pass.end();
        }).toThrow(/renderPass\.drawBatch failed/u);
        expect(frame.state).toBe('aborted');
        expect(pass.state).toBe('aborted');
        control.stickyDrawError = false;
        device.destroy();
    });

    it('reuses pass backing at its high-water mark and snapshots mutable descriptors', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const { texture } = createColorPass(device);
        const attachment: {
            view: ReturnType<RHITexture['createView']>;
            clearValue: { r: number; g: number; b: number; a: number };
            loadOp: 'clear';
            storeOp: 'store' | 'discard';
        } = {
            view: texture.createView(),
            clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
            loadOp: 'clear',
            storeOp: 'discard'
        };
        const descriptor = { colorAttachments: [attachment] };
        const firstFrame = device.graphicsQueue.beginFrame();
        const firstPass = firstFrame.beginRenderPass(descriptor);
        expect(firstFrame.diagnostics.frameArenaGrowths).toBeGreaterThan(0);
        expect(firstFrame.diagnostics.transientAllocations).toBeGreaterThan(0);
        attachment.storeOp = 'store';
        firstPass.end();
        const growthAfterWarmup = firstFrame.diagnostics.frameArenaGrowths;
        const allocationsAfterWarmup = firstFrame.diagnostics.transientAllocations;
        expect(control.calls.filter(name => name === 'invalidateFramebuffer')).toHaveLength(1);
        expect(() => {
            firstPass.end();
        }).toThrow(RHIValidationError);

        attachment.storeOp = 'discard';
        const secondPass = firstFrame.beginRenderPass(descriptor);
        expect(() => {
            firstPass.end();
        }).toThrow(RHIValidationError);
        expect(firstFrame.diagnostics.frameArenaGrowths).toBe(growthAfterWarmup);
        expect(firstFrame.diagnostics.transientAllocations).toBe(allocationsAfterWarmup);
        secondPass.end();
        device.graphicsQueue.endFrame(firstFrame);

        const abortedFrame = device.graphicsQueue.beginFrame();
        const abortedPass = abortedFrame.beginRenderPass(descriptor);
        device.graphicsQueue.abortFrame(abortedFrame);
        expect(abortedPass.state).toBe('aborted');
        expect(() => {
            abortedPass.end();
        }).toThrow(RHIValidationError);

        const steadyFrame = device.graphicsQueue.beginFrame();
        steadyFrame.beginRenderPass(descriptor).end();
        expect(steadyFrame.diagnostics.frameArenaGrowths).toBe(0);
        expect(steadyFrame.diagnostics.transientAllocations).toBe(0);
        device.graphicsQueue.endFrame(steadyFrame);
        device.destroy();
    });

    it('reuses color, depth, and stencil clear scratch across stable render passes', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = {
            calls: [],
            callArguments,
            failDraw: false
        };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const color = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const depthStencil = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'depth24plus-stencil8',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        callArguments.length = 0;

        const render = () => {
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass({
                colorAttachments: [
                    {
                        view: color.createView(),
                        clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'store'
                    }
                ],
                depthStencilAttachment: {
                    view: depthStencil.createView(),
                    depthClearValue: 0.5,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                    stencilClearValue: 3,
                    stencilLoadOp: 'clear',
                    stencilStoreOp: 'store'
                }
            });
            pass.end();
            device.graphicsQueue.endFrame(frame);
        };

        render();
        render();
        const floatClears = callArguments.filter(call => call.name === 'clearBufferfv');
        const integerClears = callArguments.filter(call => call.name === 'clearBufferiv');
        expect(floatClears).toHaveLength(4);
        expect(integerClears).toHaveLength(2);
        expect(floatClears[0]?.args[2]).toBe(floatClears[2]?.args[2]);
        expect(floatClears[1]?.args[2]).toBe(floatClears[3]?.args[2]);
        expect(integerClears[0]?.args[2]).toBe(integerClears[1]?.args[2]);
        device.destroy();
    });

    it('reuses native upload and copy objects across frames and snapshots direct inputs', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const diagnostics = new RendererDiagnostics();
        const device = createWebGL2RHIDevice(recordingContext(native, control), {
            diagnosticsSink: diagnostics
        });
        const source = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.COPY_SRC
        });
        const destination = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.COPY_SRC
        });
        const readback = device.createBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        control.calls.length = 0;

        const upload = async (value: number) => {
            const pixels = new Uint8Array([value, 0, 0, 255]);
            const frame = device.graphicsQueue.beginFrame();
            frame.writeTexture({ texture: source }, pixels, {}, { width: 1 });
            pixels.fill(0);
            frame.copyTextureToTexture({ texture: source }, { texture: destination }, { width: 1 });
            frame.copyTextureToBuffer({ texture: destination }, { buffer: readback }, { width: 1 });
            await device.graphicsQueue.endFrame(frame).done;
            return frame.diagnostics;
        };

        const first = await upload(10);
        const createdAfterWarmup = diagnostics.snapshot().nativeObjects;
        const nativeBufferCreates = control.calls.filter(name => name === 'createBuffer').length;
        const nativeFramebufferCreates = control.calls.filter(
            name => name === 'createFramebuffer'
        ).length;
        const second = await upload(20);
        const third = await upload(30);

        expect(first.frameArenaGrowths).toBe(1);
        expect(second.frameArenaGrowths).toBe(0);
        expect(second.transientAllocations).toBe(0);
        expect(third.frameArenaGrowths).toBe(0);
        expect(third.transientAllocations).toBe(0);
        expect(control.calls.filter(name => name === 'createBuffer')).toHaveLength(
            nativeBufferCreates
        );
        expect(control.calls.filter(name => name === 'createFramebuffer')).toHaveLength(
            nativeFramebufferCreates
        );
        expect(diagnostics.snapshot().nativeObjects.buffer.created).toBe(
            createdAfterWarmup.buffer.created
        );
        expect(diagnostics.snapshot().nativeObjects.framebuffer.created).toBe(
            createdAfterWarmup.framebuffer.created
        );

        await readback.mapAsync('read');
        expect([...new Uint8Array(readback.getMappedRange())]).toEqual([30, 0, 0, 255]);
        readback.unmap();
        device.destroy();
        expect(diagnostics.snapshot().nativeObjects.buffer.live).toBe(0);
        expect(diagnostics.snapshot().nativeObjects.framebuffer.live).toBe(0);
    });

    it('keeps an explicit one-layer 2D-array view on the native array texture target', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = {
            calls: [],
            callArguments,
            failDraw: false
        };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const texture = device.createTexture({
            size: { width: 1, height: 1, depthOrArrayLayers: 1 },
            viewDimension: '2d-array',
            format: 'r8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        const allocation = callArguments.find(call => call.name === 'texStorage3D');
        expect(allocation?.args).toEqual([native.TEXTURE_2D_ARRAY, 1, native.R8, 1, 1, 1]);

        callArguments.length = 0;
        const frame = device.graphicsQueue.beginFrame();
        frame.writeTexture({ texture }, new Uint8Array([7]), {}, { width: 1 });
        await device.graphicsQueue.endFrame(frame).done;
        expect(callArguments.find(call => call.name === 'texSubImage3D')?.args.slice(0, 8)).toEqual(
            [native.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1]
        );

        device.destroy();
    });

    it('generates 2D and cube mip levels in command order while restoring texture state', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const usage =
            RHITextureUsage.COPY_DST |
            RHITextureUsage.COPY_SRC |
            RHITextureUsage.TEXTURE_BINDING |
            RHITextureUsage.RENDER_ATTACHMENT;
        const texture = device.createTexture({
            size: { width: 4, height: 4 },
            mipLevelCount: 3,
            format: 'rgba8unorm',
            usage
        });
        const red = new Uint8Array(4 * 4 * 4);
        for (let offset = 0; offset < red.length; offset += 4) {
            red[offset] = 255;
            red[offset + 3] = 255;
        }
        control.calls.length = 0;
        const frame = device.graphicsQueue.beginFrame();
        frame.writeTexture({ texture }, red, { bytesPerRow: 16 }, { width: 4, height: 4 });
        frame.generateMipmaps(texture);
        await device.graphicsQueue.endFrame(frame).done;
        expect(control.calls.indexOf('generateMipmap')).toBeGreaterThan(
            control.calls.indexOf('texSubImage2D')
        );
        expect(await readTexturePixel(device, texture, 1)).toEqual([255, 0, 0, 255]);
        expect(await readTexturePixel(device, texture, 2)).toEqual([255, 0, 0, 255]);

        const previous = native.createTexture();
        device.state.bindTexture(0, native.TEXTURE_2D, previous);
        device.state.activeTexture(3);
        const regeneration = device.graphicsQueue.beginFrame();
        regeneration.generateMipmaps(texture);
        device.graphicsQueue.endFrame(regeneration);
        expect(native.getParameter(native.ACTIVE_TEXTURE)).toBe(native.TEXTURE3);
        native.activeTexture(native.TEXTURE0);
        expect(native.getParameter(native.TEXTURE_BINDING_2D)).toBe(previous);
        native.activeTexture(native.TEXTURE3);

        const cube = device.createTexture({
            size: { width: 2, height: 2, depthOrArrayLayers: 6 },
            mipLevelCount: 2,
            viewDimension: 'cube',
            format: 'rgba8unorm',
            usage
        });
        const cubePixels = new Uint8Array(6 * 2 * 2 * 4);
        for (let layer = 0; layer < 6; layer += 1) {
            for (let pixel = 0; pixel < 4; pixel += 1) {
                const offset = (layer * 4 + pixel) * 4;
                cubePixels[offset + (layer % 3)] = 255;
                cubePixels[offset + 3] = 255;
            }
        }
        const cubeFrame = device.graphicsQueue.beginFrame();
        cubeFrame.writeTexture(
            { texture: cube },
            cubePixels,
            { bytesPerRow: 8, rowsPerImage: 2 },
            { width: 2, height: 2, depthOrArrayLayers: 6 }
        );
        cubeFrame.generateMipmaps(cube);
        await device.graphicsQueue.endFrame(cubeFrame).done;
        expect(await readTexturePixel(device, cube, 1, 0)).toEqual([255, 0, 0, 255]);
        expect(await readTexturePixel(device, cube, 1, 1)).toEqual([0, 255, 0, 255]);
        expect(await readTexturePixel(device, cube, 1, 2)).toEqual([0, 0, 255, 255]);

        native.deleteTexture(previous);
        device.destroy();
    });

    it('uploads an external source subregion with canonical pixel-unpack state and restores it', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = {
            calls: [],
            callArguments,
            failDraw: false
        };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const source = document.createElement('canvas');
        source.width = 4;
        source.height = 3;
        const destination = device.createTexture({
            size: { width: 4, height: 3 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.RENDER_ATTACHMENT
        });
        const previousUnpackBuffer = native.createBuffer();
        const previousTexture = native.createTexture();
        device.state.bindBuffer(native.PIXEL_UNPACK_BUFFER, previousUnpackBuffer);
        device.state.bindTexture(0, native.TEXTURE_2D, previousTexture);
        device.state.activeTexture(3);
        device.state.setPixelStore(native.UNPACK_ALIGNMENT, 2);
        device.state.setPixelStore(native.UNPACK_ROW_LENGTH, 0);
        device.state.setPixelStore(native.UNPACK_FLIP_Y_WEBGL, 0);
        control.calls.length = 0;
        callArguments.length = 0;

        const context = device.graphicsQueue.beginFrame();
        context.copyExternalImageToTexture(
            { source, origin: { x: 1, y: 1 }, flipY: true },
            { texture: destination, premultipliedAlpha: true },
            { width: 3, height: 2 }
        );
        context.copyExternalImageToTexture(
            { source, origin: { x: 0, y: 0 } },
            { texture: destination },
            { width: 1, height: 1 }
        );
        device.graphicsQueue.endFrame(context);

        const uploads = callArguments.filter(call => call.name === 'texSubImage2D');
        expect(uploads).toHaveLength(2);
        const upload = uploads[0];
        expect(upload?.args).toEqual([
            native.TEXTURE_2D,
            0,
            0,
            0,
            3,
            2,
            native.RGBA,
            native.UNSIGNED_BYTE,
            source
        ]);
        expect(callArguments).toContainEqual({
            name: 'pixelStorei',
            args: [native.UNPACK_ROW_LENGTH, 4]
        });
        expect(callArguments).toContainEqual({
            name: 'pixelStorei',
            args: [native.UNPACK_SKIP_PIXELS, 1]
        });
        expect(callArguments).toContainEqual({
            name: 'pixelStorei',
            args: [native.UNPACK_SKIP_ROWS, 1]
        });
        expect(callArguments).toContainEqual({
            name: 'pixelStorei',
            args: [native.UNPACK_FLIP_Y_WEBGL, 1]
        });
        expect(callArguments).toContainEqual({
            name: 'pixelStorei',
            args: [native.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1]
        });
        expect(native.getParameter(native.UNPACK_ALIGNMENT)).toBe(2);
        expect(native.getParameter(native.UNPACK_ROW_LENGTH)).toBe(0);
        expect(native.getParameter(native.UNPACK_FLIP_Y_WEBGL)).toBe(false);
        expect(native.getParameter(native.PIXEL_UNPACK_BUFFER_BINDING)).toBe(previousUnpackBuffer);
        expect(native.getParameter(native.ACTIVE_TEXTURE)).toBe(native.TEXTURE3);
        native.activeTexture(native.TEXTURE0);
        expect(native.getParameter(native.TEXTURE_BINDING_2D)).toBe(previousTexture);
        native.activeTexture(native.TEXTURE3);

        native.deleteBuffer(previousUnpackBuffer);
        native.deleteTexture(previousTexture);
        device.destroy();
    });

    it('converts top-left texture copy origins to bottom-left readPixels coordinates per mip', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = {
            calls: [],
            callArguments,
            failDraw: false
        };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const texture = device.createTexture({
            size: { width: 8, height: 8 },
            mipLevelCount: 2,
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_SRC | RHITextureUsage.RENDER_ATTACHMENT
        });
        const readback = device.createBuffer({
            size: 8,
            usage: RHIBufferUsage.COPY_DST
        });
        control.calls.length = 0;
        callArguments.length = 0;

        const context = device.graphicsQueue.beginFrame();
        context.copyTextureToBuffer(
            { texture, mipLevel: 1, origin: { x: 1, y: 1 } },
            { buffer: readback },
            { width: 2, height: 1 }
        );
        device.graphicsQueue.endFrame(context);

        const readPixels = callArguments.find(call => call.name === 'readPixels');
        expect(readPixels?.args).toEqual([1, 2, 2, 1, native.RGBA, native.UNSIGNED_BYTE, 0]);

        const multiRowReadback = device.createBuffer({
            size: 520,
            usage: RHIBufferUsage.COPY_DST
        });
        callArguments.length = 0;
        const multiRowContext = device.graphicsQueue.beginFrame();
        multiRowContext.copyTextureToBuffer(
            { texture, mipLevel: 1, origin: { x: 1, y: 0 } },
            { buffer: multiRowReadback, bytesPerRow: 256 },
            { width: 2, height: 3 }
        );
        device.graphicsQueue.endFrame(multiRowContext);
        expect(
            callArguments.filter(call => call.name === 'readPixels').map(call => call.args)
        ).toEqual([
            [1, 3, 2, 1, native.RGBA, native.UNSIGNED_BYTE, 0],
            [1, 2, 2, 1, native.RGBA, native.UNSIGNED_BYTE, 256],
            [1, 1, 2, 1, native.RGBA, native.UNSIGNED_BYTE, 512]
        ]);
        multiRowReadback.destroy();
        device.destroy();
    });

    it('binds reflected vertex-input locations before linking the native program', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const vertex = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'vertex',
                code: `#version 300 es
in vec3 position;
void main() { gl_Position = vec4(position, 1.0); }`,
                entryPoint: 'main',
                reflection: {
                    bindings: [],
                    vertexInputs: [{ location: 3, name: 'position' }]
                },
                cacheKey: 101
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
                cacheKey: 102
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });

        control.calls.length = 0;
        device.createGraphicsPipeline({
            layout,
            vertex: {
                shader: vertex,
                buffers: [
                    {
                        arrayStride: 12,
                        attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 3 }]
                    }
                ]
            },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list' }
        });

        expect(control.calls.indexOf('bindAttribLocation')).toBeGreaterThanOrEqual(0);
        expect(control.calls.indexOf('bindAttribLocation')).toBeLessThan(
            control.calls.indexOf('linkProgram')
        );
        device.destroy();
    });

    it('binds per-vertex and instanced matrix columns to consecutive WebGL attributes', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = {
            calls: [],
            callArguments,
            failDraw: false
        };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const vertex = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'vertex',
                code: `#version 300 es
in vec3 position;
in mat3 basis;
in mat4 instanceTransform;
void main() {
    gl_Position = instanceTransform * vec4(basis * position, 1.0);
}`,
                entryPoint: 'main',
                reflection: {
                    bindings: [],
                    vertexInputs: [
                        { location: 0, name: 'position' },
                        { location: 1, name: 'basis' },
                        { location: 2 },
                        { location: 3 },
                        { location: 4, name: 'instanceTransform' },
                        { location: 5 },
                        { location: 6 },
                        { location: 7 }
                    ]
                },
                cacheKey: 103
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
                cacheKey: 104
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
        const pipeline = device.createGraphicsPipeline({
            layout,
            vertex: {
                shader: vertex,
                buffers: [
                    {
                        arrayStride: 48,
                        stepMode: 'vertex',
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 0 },
                            { format: 'float32x3', offset: 12, shaderLocation: 1 },
                            { format: 'float32x3', offset: 24, shaderLocation: 2 },
                            { format: 'float32x3', offset: 36, shaderLocation: 3 }
                        ]
                    },
                    {
                        arrayStride: 64,
                        stepMode: 'instance',
                        attributes: [
                            { format: 'float32x4', offset: 0, shaderLocation: 4 },
                            { format: 'float32x4', offset: 16, shaderLocation: 5 },
                            { format: 'float32x4', offset: 32, shaderLocation: 6 },
                            { format: 'float32x4', offset: 48, shaderLocation: 7 }
                        ]
                    }
                ]
            },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list' }
        });
        const vertices = device.createBuffer({
            size: 144,
            usage: RHIBufferUsage.VERTEX,
            initialData: new Float32Array(36)
        });
        const instances = device.createBuffer({
            size: 64,
            usage: RHIBufferUsage.VERTEX,
            initialData: new Float32Array(16)
        });

        callArguments.length = 0;
        pipeline.prepareVertexInput({
            vertexBuffers: [
                { buffer: vertices, offset: 0 },
                { buffer: instances, offset: 0 }
            ],
            indexBuffer: null
        });

        expect(
            callArguments.filter(call => call.name === 'vertexAttribPointer').map(call => call.args)
        ).toEqual([
            [0, 3, native.FLOAT, false, 48, 0],
            [1, 3, native.FLOAT, false, 48, 12],
            [2, 3, native.FLOAT, false, 48, 24],
            [3, 3, native.FLOAT, false, 48, 36],
            [4, 4, native.FLOAT, false, 64, 0],
            [5, 4, native.FLOAT, false, 64, 16],
            [6, 4, native.FLOAT, false, 64, 32],
            [7, 4, native.FLOAT, false, 64, 48]
        ]);
        expect(
            callArguments.filter(call => call.name === 'vertexAttribDivisor').map(call => call.args)
        ).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
            [4, 1],
            [5, 1],
            [6, 1],
            [7, 1]
        ]);
        expect(native.getError()).toBe(native.NO_ERROR);
        device.destroy();
    });

    it('executes native calls at command time and never replays them at endFrame', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);
        const passDescriptor = createColorPass(device).descriptor;
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(passDescriptor);
        pass.setPipeline(pipeline);
        pass.draw(3);

        const drawsBeforeEnd = control.calls.filter(call => call === 'drawArrays').length;
        expect(drawsBeforeEnd).toBe(1);
        pass.end();
        device.graphicsQueue.endFrame(frame);
        expect(control.calls.filter(call => call === 'drawArrays')).toHaveLength(drawsBeforeEnd);
        device.destroy();
    });

    it('counts native vertex-input and framebuffer hits and releases cache entries', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);
        const { texture, descriptor } = createColorPass(device);

        const firstFrame = device.graphicsQueue.beginFrame();
        const firstPass = firstFrame.beginRenderPass(descriptor);
        firstPass.setPipeline(pipeline);
        firstPass.draw(3);
        firstPass.end();
        device.graphicsQueue.endFrame(firstFrame);

        const secondFrame = device.graphicsQueue.beginFrame();
        const secondPass = secondFrame.beginRenderPass(descriptor);
        secondPass.setPipeline(pipeline);
        secondPass.draw(3);
        secondPass.end();
        device.graphicsQueue.endFrame(secondFrame);
        const afterSecondFramebufferRequests =
            device.framebufferCacheMetrics.hits + device.framebufferCacheMetrics.misses;
        const afterSecondVertexRequests =
            device.vertexInputCacheMetrics.hits + device.vertexInputCacheMetrics.misses;

        const thirdFrame = device.graphicsQueue.beginFrame();
        const thirdPass = thirdFrame.beginRenderPass(descriptor);
        thirdPass.setPipeline(pipeline);
        thirdPass.draw(3);
        thirdPass.end();
        device.graphicsQueue.endFrame(thirdFrame);

        expect(device.framebufferCacheMetrics).toMatchObject({
            hits: 2,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });
        expect(device.vertexInputCacheMetrics).toMatchObject({
            hits: 2,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });
        expect(
            device.framebufferCacheMetrics.hits +
                device.framebufferCacheMetrics.misses -
                afterSecondFramebufferRequests
        ).toBe(1);
        expect(
            device.vertexInputCacheMetrics.hits +
                device.vertexInputCacheMetrics.misses -
                afterSecondVertexRequests
        ).toBe(1);

        texture.destroy();
        expect(device.framebufferCacheMetrics).toMatchObject({
            evictions: 1,
            size: 0,
            highWater: 1
        });
        pipeline.destroy();
        expect(device.vertexInputCacheMetrics).toMatchObject({
            evictions: 1,
            size: 0,
            highWater: 1
        });
        device.destroy();
    });

    it('automatically aborts a failed immediate frame and restores the queue', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);
        const passDescriptor = createColorPass(device).descriptor;
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(passDescriptor);
        pass.setPipeline(pipeline);
        control.failDraw = true;
        expect(() => {
            pass.draw(3);
        }).toThrow('injected native draw failure');
        expect(frame.state).toBe('aborted');
        expect(pass.state).toBe('aborted');
        expect(device.graphicsQueue.state).toBe('idle');

        control.failDraw = false;
        const recovery = device.graphicsQueue.beginFrame();
        expect(recovery.state).toBe('open');
        device.graphicsQueue.abortFrame(recovery);
        device.destroy();
    });

    it('checks sticky draw errors once at the pass boundary before end side effects', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);
        const color = createColorPass(device);
        const attachment = color.descriptor.colorAttachments[0];
        if (attachment === undefined) throw new Error('color attachment is unavailable');
        const passDescriptor = {
            colorAttachments: [{ ...attachment, storeOp: 'discard' as const }]
        };
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(passDescriptor);
        pass.setPipeline(pipeline);
        control.stickyDrawError = true;
        const checksBeforeDraw = control.calls.filter(name => name === 'getError').length;
        const invalidationsBeforeEnd = control.calls.filter(
            name => name === 'invalidateFramebuffer'
        ).length;

        pass.draw(3);
        expect(control.calls.filter(name => name === 'getError')).toHaveLength(checksBeforeDraw);
        expect(() => {
            pass.end();
        }).toThrow(/renderPass\.drawBatch failed/u);
        expect(control.calls.filter(name => name === 'invalidateFramebuffer')).toHaveLength(
            invalidationsBeforeEnd
        );
        expect(frame.state).toBe('aborted');
        expect(pass.state).toBe('aborted');
        expect(device.graphicsQueue.state).toBe('idle');

        control.stickyDrawError = false;
        const recovery = device.graphicsQueue.beginFrame();
        const recoveryPass = recovery.beginRenderPass(color.descriptor);
        recoveryPass.setPipeline(pipeline);
        recoveryPass.draw(3);
        recoveryPass.end();
        expect(() => device.graphicsQueue.endFrame(recovery)).not.toThrow();
        device.destroy();
    });

    it('checks sticky draw errors before later state and drains them on explicit abort', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);
        const passDescriptor = createColorPass(device).descriptor;

        const failedFrame = device.graphicsQueue.beginFrame();
        const failedPass = failedFrame.beginRenderPass(passDescriptor);
        failedPass.setPipeline(pipeline);
        control.stickyDrawError = true;
        failedPass.drawRecord({
            elementCount: 3,
            instanceCount: 1,
            firstElement: 0,
            baseVertex: 0,
            firstInstance: 0
        });
        const viewportCalls = control.calls.filter(name => name === 'viewport').length;
        expect(() => {
            failedPass.setViewportRecord({
                x: 1,
                y: 1,
                width: 4,
                height: 4,
                minDepth: 0,
                maxDepth: 1
            });
        }).toThrow(/renderPass\.drawBatch failed/u);
        expect(control.calls.filter(name => name === 'viewport')).toHaveLength(viewportCalls);
        expect(failedFrame.state).toBe('aborted');
        expect(failedPass.state).toBe('aborted');

        const abortedFrame = device.graphicsQueue.beginFrame();
        const abortedPass = abortedFrame.beginRenderPass(passDescriptor);
        abortedPass.setPipeline(pipeline);
        abortedPass.draw(3);
        expect(control.drawErrorPending).toBe(true);
        device.graphicsQueue.abortFrame(abortedFrame);
        expect(control.drawErrorPending).toBe(false);

        control.stickyDrawError = false;
        const recovery = device.graphicsQueue.beginFrame();
        const recoveryPass = recovery.beginRenderPass(passDescriptor);
        recoveryPass.setPipeline(pipeline);
        recoveryPass.draw(3);
        recoveryPass.end();
        expect(() => device.graphicsQueue.endFrame(recovery)).not.toThrow();
        device.destroy();
    });

    it('uses prepared bind-group entries and rejects every invalidated contained resource', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const { groupLayout, pipeline } = createPreparedBindingPipeline(device);
        const passDescriptor = createColorPass(device).descriptor;
        const createGroup = () => {
            const buffer = device.createBuffer({ size: 16, usage: RHIBufferUsage.UNIFORM });
            const texture = device.createTexture({
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            const view = texture.createView();
            const sampler = device.createSampler();
            const group = device.createBindGroup({
                layout: groupLayout,
                entries: [
                    { binding: 2, resource: sampler },
                    { binding: 5, resource: { buffer, size: 16 } },
                    { binding: 9, resource: view }
                ]
            });
            return { buffer, group, sampler, texture, view };
        };

        const valid = createGroup();
        const validFrame = device.graphicsQueue.beginFrame();
        const validPass = validFrame.beginRenderPass(passDescriptor);
        validPass.setPipeline(pipeline);
        validPass.setBindGroup(0, valid.group);
        validPass.draw(3);
        validPass.end();
        device.graphicsQueue.endFrame(validFrame);

        const expectInvalidated = (
            path: string,
            invalidate: (resources: ReturnType<typeof createGroup>) => void
        ) => {
            const resources = createGroup();
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass(passDescriptor);
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, resources.group);
            invalidate(resources);
            expect(() => {
                pass.draw(3);
            }).toThrow(expect.objectContaining({ code: 'destroyed-object', path }));
            expect(frame.state).toBe('aborted');
            expect(pass.state).toBe('aborted');
            expect(device.graphicsQueue.state).toBe('idle');
        };

        const expectRejectedBeforeSet = (
            path: string,
            invalidate: (resources: ReturnType<typeof createGroup>) => void
        ) => {
            const resources = createGroup();
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass(passDescriptor);
            pass.setPipeline(pipeline);
            invalidate(resources);
            expect(() => {
                pass.setBindGroup(0, resources.group);
            }).toThrow(expect.objectContaining({ code: 'destroyed-object', path }));
            device.graphicsQueue.abortFrame(frame);
        };

        expectInvalidated('buffer', resources => {
            resources.buffer.destroy();
        });
        expectInvalidated('textureView', resources => {
            resources.view.destroy();
        });
        expectInvalidated('textureView.texture', resources => {
            resources.texture.destroy();
        });
        expectInvalidated('sampler', resources => {
            resources.sampler.destroy();
        });
        expectRejectedBeforeSet('buffer', resources => {
            resources.buffer.destroy();
        });
        expectRejectedBeforeSet('textureView', resources => {
            resources.view.destroy();
        });
        expectRejectedBeforeSet('textureView.texture', resources => {
            resources.texture.destroy();
        });
        expectRejectedBeforeSet('sampler', resources => {
            resources.sampler.destroy();
        });
        device.destroy();
    });

    it('rejects vertex and index buffers destroyed after they are bound', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const passDescriptor = createColorPass(device).descriptor;

        const vertexPipeline = createVertexPipeline(device);
        const vertexBuffer = device.createBuffer({
            size: 24,
            usage: RHIBufferUsage.VERTEX,
            initialData: new Float32Array([-1, -1, 1, -1, 0, 1])
        });
        vertexPipeline.prepareVertexInput({
            vertexBuffers: [{ buffer: vertexBuffer, offset: 0 }],
            indexBuffer: null
        });
        const vertexFrame = device.graphicsQueue.beginFrame();
        const vertexPass = vertexFrame.beginRenderPass(passDescriptor);
        vertexPass.setPipeline(vertexPipeline);
        vertexPass.setVertexBuffer(0, vertexBuffer);
        vertexBuffer.destroy();
        expect(() => {
            vertexPass.draw(3);
        }).toThrow(
            expect.objectContaining({
                code: 'destroyed-object',
                path: 'renderPass.vertexBuffers[0]'
            })
        );
        expect(vertexFrame.state).toBe('aborted');

        const indexPipeline = createSolidPipeline(device);
        const indexBuffer = device.createBuffer({
            size: 6,
            usage: RHIBufferUsage.INDEX,
            initialData: new Uint16Array([0, 1, 2])
        });
        prepareIndexedPipeline(indexPipeline, indexBuffer);
        const indexFrame = device.graphicsQueue.beginFrame();
        const indexPass = indexFrame.beginRenderPass(passDescriptor);
        indexPass.setPipeline(indexPipeline);
        indexPass.setIndexBuffer(indexBuffer, 'uint16');
        indexBuffer.destroy();
        expect(() => {
            indexPass.drawIndexed(3);
        }).toThrow(
            expect.objectContaining({ code: 'destroyed-object', path: 'renderPass.indexBuffer' })
        );
        expect(indexFrame.state).toBe('aborted');
        device.destroy();
    });

    it('rejects pass attachment views and textures invalidated after beginRenderPass', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);

        const viewCase = createColorPass(device);
        const view = viewCase.descriptor.colorAttachments[0]?.view;
        if (view === undefined) throw new Error('color attachment view is unavailable');
        const viewFrame = device.graphicsQueue.beginFrame();
        const viewPass = viewFrame.beginRenderPass(viewCase.descriptor);
        viewPass.setPipeline(pipeline);
        const drawsBeforeInvalidation = control.calls.filter(name => name === 'drawArrays').length;
        view.destroy();
        expect(() => {
            viewPass.draw(3);
        }).toThrow(
            expect.objectContaining({
                code: 'destroyed-object',
                path: 'renderPass.colorAttachments[0].view'
            })
        );
        expect(control.calls.filter(name => name === 'drawArrays')).toHaveLength(
            drawsBeforeInvalidation
        );
        expect(viewFrame.state).toBe('aborted');

        const textureCase = createColorPass(device);
        const textureFrame = device.graphicsQueue.beginFrame();
        const texturePass = textureFrame.beginRenderPass(textureCase.descriptor);
        textureCase.texture.destroy();
        expect(() => {
            texturePass.end();
        }).toThrow(
            expect.objectContaining({
                code: 'destroyed-object',
                path: 'renderPass.colorAttachments[0].view.texture'
            })
        );
        expect(textureFrame.state).toBe('aborted');
        device.destroy();
    });

    it('uses the prepared dynamic-buffer plan without weakening offset validation', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const { groupLayout, pipeline } = createPreparedBindingPipeline(device, true);
        const alignment = device.capabilities.limits.minUniformBufferOffsetAlignment;
        const bufferSize = Math.max(16, alignment);
        const buffer = device.createBuffer({
            size: bufferSize,
            usage: RHIBufferUsage.UNIFORM
        });
        const texture = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const group = device.createBindGroup({
            layout: groupLayout,
            entries: [
                { binding: 9, resource: texture.createView() },
                { binding: 2, resource: device.createSampler() },
                { binding: 5, resource: { buffer, size: 16 } }
            ]
        });
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(createColorPass(device).descriptor);
        pass.setPipeline(pipeline);
        expect(() => {
            pass.setBindGroup(0, group);
        }).toThrow(
            expect.objectContaining({
                code: 'incompatible-layout',
                path: 'renderPass.dynamicOffsets'
            })
        );
        expect(() => {
            pass.setBindGroup(0, group, new Uint32Array(0));
        }).toThrow(
            expect.objectContaining({
                code: 'incompatible-layout',
                path: 'renderPass.dynamicOffsets'
            })
        );
        if (alignment > 1) {
            expect(() => {
                pass.setBindGroup(0, group, new Uint32Array([1]));
            }).toThrow(
                expect.objectContaining({
                    code: 'invalid-descriptor',
                    path: 'renderPass.dynamicOffsets'
                })
            );
        }
        const outOfBoundsOffset = Math.ceil(bufferSize / alignment) * alignment;
        expect(() => {
            pass.setBindGroup(0, group, new Uint32Array([outOfBoundsOffset]));
        }).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'renderPass.dynamicOffsets'
            })
        );
        pass.setBindGroup(0, group, new Uint32Array([0]));
        pass.draw(3);
        pass.end();
        device.graphicsQueue.endFrame(frame);
        device.destroy();
    });

    it('keeps static uniform blocks independent from surrounding dynamic offsets', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = { calls: [], callArguments, failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const groupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 3,
                    visibility: RHIShaderStage.FRAGMENT,
                    buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 }
                },
                {
                    binding: 2,
                    visibility: RHIShaderStage.FRAGMENT,
                    buffer: { type: 'uniform', minBindingSize: 16 }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 }
                }
            ]
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] });
        const vertex = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'vertex',
                code: `#version 300 es
const vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`,
                entryPoint: 'main',
                reflection: { bindings: [], vertexInputs: [] },
                cacheKey: 111
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'fragment',
                code: `#version 300 es
precision highp float;
layout(std140) uniform DynamicFirst { vec4 firstTint; };
layout(std140) uniform StaticMiddle { vec4 middleTint; };
layout(std140) uniform DynamicLast { vec4 lastTint; };
out vec4 color;
void main() { color = firstTint + middleTint + lastTint; }`,
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        { group: 0, binding: 1, kind: 'uniform-buffer' },
                        { group: 0, binding: 2, kind: 'uniform-buffer' },
                        { group: 0, binding: 3, kind: 'uniform-buffer' }
                    ],
                    fragmentOutputs: [{ location: 0 }]
                },
                preparedBindings: {
                    uniformBlocks: [
                        { name: 'DynamicFirst', group: 0, binding: 1 },
                        { name: 'StaticMiddle', group: 0, binding: 2 },
                        { name: 'DynamicLast', group: 0, binding: 3 }
                    ],
                    combinedSamplers: []
                },
                cacheKey: 112
            }
        });
        const pipeline = device.createGraphicsPipeline({
            layout,
            vertex: { shader: vertex, buffers: [] },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list' }
        });
        const alignment = device.capabilities.limits.minUniformBufferOffsetAlignment;
        const first = device.createBuffer({
            size: alignment + 16,
            usage: RHIBufferUsage.UNIFORM
        });
        const middle = device.createBuffer({ size: 16, usage: RHIBufferUsage.UNIFORM });
        const last = device.createBuffer({
            size: alignment * 2 + 16,
            usage: RHIBufferUsage.UNIFORM
        });
        const group = device.createBindGroup({
            layout: groupLayout,
            entries: [
                { binding: 2, resource: { buffer: middle, size: 16 } },
                { binding: 3, resource: { buffer: last, size: 16 } },
                { binding: 1, resource: { buffer: first, size: 16 } }
            ]
        });
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(createColorPass(device).descriptor);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group, new Uint32Array([alignment, alignment * 2]));
        const drawStart = callArguments.length;
        pass.draw(3);
        const uniformOffsets = callArguments
            .slice(drawStart)
            .filter(call => call.name === 'bindBufferRange')
            .map(call => call.args[3]);
        expect(uniformOffsets).toEqual([alignment, 0, alignment * 2]);
        pass.end();
        device.graphicsQueue.endFrame(frame);
        device.destroy();
    });

    it('rejects unsupported sampled array subviews while preparing the bind group', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const layout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'float', viewDimension: '2d-array' }
                }
            ]
        });
        const texture = device.createTexture({
            size: { width: 2, height: 2, depthOrArrayLayers: 2 },
            viewDimension: '2d-array',
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const restricted = texture.createView({
            dimension: '2d-array',
            baseArrayLayer: 1,
            arrayLayerCount: 1
        });
        expect(() =>
            device.createBindGroup({
                layout,
                entries: [{ binding: 0, resource: restricted }]
            })
        ).toThrow(
            expect.objectContaining({
                code: 'unsupported-feature',
                path: 'bindGroup.textureView'
            })
        );
        device.destroy();
    });

    it('binds real sampler-array elements to two units without steady reactivation', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], callArguments: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const groupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'float', viewDimension: '2d' }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                },
                {
                    binding: 2,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'float', viewDimension: '2d' }
                },
                {
                    binding: 3,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                }
            ]
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] });
        const vertex = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'vertex',
                code: `#version 300 es
const vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`,
                entryPoint: 'main',
                reflection: { bindings: [], vertexInputs: [] },
                cacheKey: 121
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'fragment',
                code: `#version 300 es
precision highp float;
uniform sampler2D maps[2];
out vec4 color;
void main() {
    color = texture(maps[0], vec2(0.25)) + texture(maps[1], vec2(0.75));
}`,
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        {
                            group: 0,
                            binding: 0,
                            kind: 'sampled-texture',
                            name: 'maps',
                            arrayIndex: 0
                        },
                        {
                            group: 0,
                            binding: 1,
                            kind: 'sampler',
                            name: 'maps',
                            arrayIndex: 0
                        },
                        {
                            group: 0,
                            binding: 2,
                            kind: 'sampled-texture',
                            name: 'maps',
                            arrayIndex: 1
                        },
                        {
                            group: 0,
                            binding: 3,
                            kind: 'sampler',
                            name: 'maps',
                            arrayIndex: 1
                        }
                    ],
                    fragmentOutputs: [{ location: 0 }]
                },
                preparedBindings: {
                    uniformBlocks: [],
                    combinedSamplers: [
                        {
                            name: 'maps',
                            group: 0,
                            textureBinding: 0,
                            samplerBinding: 1,
                            arrayIndex: 0
                        },
                        {
                            name: 'maps',
                            group: 0,
                            textureBinding: 2,
                            samplerBinding: 3,
                            arrayIndex: 1
                        }
                    ]
                },
                cacheKey: 122
            }
        });
        const pipeline = device.createGraphicsPipeline({
            layout,
            vertex: { shader: vertex, buffers: [] },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list' }
        });
        expect(
            control.callArguments
                ?.filter(call => call.name === 'getUniformLocation')
                .map(call => call.args[1])
        ).toEqual(['maps', 'maps[1]']);
        expect(
            control.callArguments
                ?.filter(call => call.name === 'uniform1i')
                .map(call => call.args[1])
        ).toEqual([0, 1]);
        const first = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const second = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const group = device.createBindGroup({
            layout: groupLayout,
            entries: [
                { binding: 0, resource: first.createView() },
                { binding: 1, resource: device.createSampler() },
                { binding: 2, resource: second.createView() },
                { binding: 3, resource: device.createSampler() }
            ]
        });
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(createColorPass(device).descriptor);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        const activeCallsAfterWarmup = control.calls.filter(
            name => name === 'activeTexture'
        ).length;
        pass.draw(3);
        expect(control.calls.filter(name => name === 'activeTexture')).toHaveLength(
            activeCallsAfterWarmup
        );
        pass.end();
        device.graphicsQueue.endFrame(frame);
        device.destroy();
    });

    it('keeps surfaces tied to the device context canvas and invalidates a lost generation', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const surface = device.createSurface(canvas);
        surface.configure({
            format: 'rgba8unorm',
            depthStencilFormat: 'depth24plus',
            width: 16,
            height: 8
        });
        const color = surface.getCurrentTexture();
        const depth = surface.getDepthStencilTexture();
        expect(color.lifetime).toBe('frame');
        expect(depth?.lifetime).toBe('persistent');
        if (depth === null) throw new Error('WebGL2 surface depth attachment is unavailable');
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass({
            colorAttachments: [
                {
                    view: color.createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                }
            ],
            depthStencilAttachment: {
                view: depth.createView(),
                depthLoadOp: 'clear',
                depthStoreOp: 'discard',
                depthClearValue: 1
            }
        });
        pass.end();
        device.graphicsQueue.endFrame(frame);
        surface.present();
        expect(() => device.createSurface(document.createElement('canvas'))).toThrow();

        const buffer = device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });
        const generation = device.generation;
        canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        await expect(device.lost).resolves.toMatchObject({
            reason: 'context-lost',
            generation
        });
        expect(device.generation).toBe(generation + 1);
        expect(device.graphicsQueue.state).toBe('lost');
        expect(buffer.destroyed).toBe(true);
        device.destroy();
    });

    it('uses WebGPU-shaped aligned mapping ranges and contained mapped views', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const initialData = new Uint8Array(32);
        for (let index = 0; index < initialData.length; index += 1) initialData[index] = index;
        const readable = device.createBuffer({
            size: 32,
            usage: RHIBufferUsage.MAP_READ | RHIBufferUsage.COPY_DST,
            initialData
        });

        await expect(readable.mapAsync('read', 4, 4)).rejects.toMatchObject({
            code: 'invalid-descriptor',
            path: 'buffer.map.offset'
        });
        await expect(readable.mapAsync('read', 8, 6)).rejects.toMatchObject({
            code: 'invalid-descriptor',
            path: 'buffer.map.size'
        });
        await readable.mapAsync('read', 8, 16);
        expect(() => readable.getMappedRange()).toThrow(
            expect.objectContaining({ code: 'out-of-bounds' })
        );
        expect([...new Uint8Array(readable.getMappedRange(16, 4))]).toEqual([16, 17, 18, 19]);
        expect(() => readable.getMappedRange(8, 6)).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor' })
        );
        readable.unmap();

        const writable = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.MAP_WRITE | RHIBufferUsage.COPY_SRC
        });
        await writable.mapAsync('write', 8, 8);
        new Uint8Array(writable.getMappedRange(8, 4)).set([9, 8, 7, 6]);
        writable.unmap();
        const readback = device.createBuffer({
            size: 8,
            usage: RHIBufferUsage.MAP_READ | RHIBufferUsage.COPY_DST
        });
        const frame = device.graphicsQueue.beginFrame();
        frame.copyBufferToBuffer(writable, 8, readback, 0, 4);
        device.graphicsQueue.endFrame(frame);
        await readback.mapAsync('read');
        expect([...new Uint8Array(readback.getMappedRange(0, 4))]).toEqual([9, 8, 7, 6]);
        readback.unmap();
        device.destroy();
    });

    it('preserves a cached VAO while allocating and uploading another index buffer', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = {
            calls: [],
            callArguments,
            failDraw: false
        };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);
        const { descriptor } = createColorPass(device);
        const primaryIndex = device.createBuffer({
            size: 8,
            usage: RHIBufferUsage.INDEX | RHIBufferUsage.COPY_DST,
            initialData: new Uint16Array([0, 1, 2, 0])
        });
        prepareIndexedPipeline(pipeline, primaryIndex);
        const preparedVertexArrayCreates = control.calls.filter(
            call => call === 'createVertexArray'
        ).length;

        const drawPrimary = () => {
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass(descriptor);
            pass.setPipeline(pipeline);
            pass.setIndexBuffer(primaryIndex, 'uint16');
            pass.drawIndexed(3);
            pass.end();
            device.graphicsQueue.endFrame(frame);
        };

        drawPrimary();
        expect(control.calls.filter(call => call === 'createVertexArray')).toHaveLength(
            preparedVertexArrayCreates
        );

        const allocationStart = callArguments.length;
        const secondaryIndex = device.createBuffer({
            size: 4,
            usage: RHIBufferUsage.INDEX | RHIBufferUsage.COPY_DST,
            initialData: new Uint16Array([0, 1])
        });
        const allocationCalls = callArguments.slice(allocationStart);
        expect(
            allocationCalls.some(
                call => call.name === 'bufferData' && call.args[0] === native.ELEMENT_ARRAY_BUFFER
            )
        ).toBe(true);
        expect(
            allocationCalls
                .filter(call => call.name === 'bindVertexArray')
                .map(call => call.args[0])
        ).toEqual([null]);

        const uploadStart = callArguments.length;
        const uploadFrame = device.graphicsQueue.beginFrame();
        uploadFrame.writeBuffer(secondaryIndex, 0, new Uint16Array([1, 0]));
        const uploadCalls = callArguments.slice(uploadStart);
        expect(
            uploadCalls.some(
                call => call.name === 'bufferSubData' && call.args[0] === native.COPY_WRITE_BUFFER
            )
        ).toBe(true);
        expect(
            uploadCalls.some(
                call => call.name === 'bindBuffer' && call.args[0] === native.ELEMENT_ARRAY_BUFFER
            )
        ).toBe(false);
        const redrawStart = callArguments.length;
        const uploadPass = uploadFrame.beginRenderPass(descriptor);
        uploadPass.setPipeline(pipeline);
        uploadPass.setIndexBuffer(primaryIndex, 'uint16');
        expect(() => {
            uploadPass.drawIndexed(3);
        }).not.toThrow();
        expect(
            callArguments
                .slice(redrawStart)
                .some(call => call.name === 'bindVertexArray' && call.args[0] !== null)
        ).toBe(true);
        uploadPass.end();
        device.graphicsQueue.endFrame(uploadFrame);
        device.destroy();
    });

    it('reconfigures stale VAO storage after its bound buffer is destroyed', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);
        const { descriptor } = createColorPass(device);
        const drawIndexed = (buffer: ReturnType<typeof device.createBuffer>): void => {
            prepareIndexedPipeline(pipeline, buffer);
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass(descriptor);
            pass.setPipeline(pipeline);
            pass.setIndexBuffer(buffer, 'uint16');
            pass.drawIndexed(3);
            pass.end();
            device.graphicsQueue.endFrame(frame);
        };
        const first = device.createBuffer({
            size: 8,
            usage: RHIBufferUsage.INDEX,
            initialData: new Uint16Array([0, 1, 2, 0])
        });
        drawIndexed(first);
        const nativeCreates = control.calls.filter(call => call === 'createVertexArray').length;

        first.destroy();
        const replacement = device.createBuffer({
            size: 8,
            usage: RHIBufferUsage.INDEX,
            initialData: new Uint16Array([0, 1, 2, 0])
        });
        drawIndexed(replacement);

        expect(control.calls.filter(call => call === 'createVertexArray')).toHaveLength(
            nativeCreates
        );
        expect(device.vertexInputCacheMetrics).toMatchObject({
            hits: 0,
            misses: 2,
            evictions: 1,
            size: 2,
            highWater: 2
        });
        device.destroy();
    });

    it('does not count preparation as a cache request and rejects an evicted VAO in draw', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const pipeline = createSolidPipeline(device);
        const { descriptor } = createColorPass(device);
        let first: RHIBuffer | null = null;
        for (let index = 0; index < 257; index += 1) {
            const buffer = device.createBuffer({ size: 8, usage: RHIBufferUsage.INDEX });
            first ??= buffer;
            prepareIndexedPipeline(pipeline, buffer);
        }
        expect(device.vertexInputCacheMetrics).toMatchObject({
            hits: 0,
            misses: 0,
            size: 256,
            highWater: 256
        });
        if (first === null) throw new Error('expected an index buffer');
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(descriptor);
        pass.setPipeline(pipeline);
        pass.setIndexBuffer(first, 'uint16');
        expect(() => {
            pass.drawIndexed(3);
        }).toThrow(/vertex input was not prepared/u);
        device.destroy();
    });

    it('does not restore a deleted tracked VAO after allocating an index buffer', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = {
            calls: [],
            callArguments,
            failDraw: false
        };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const pipeline = createSolidPipeline(device);
        const { descriptor } = createColorPass(device);
        const primaryIndex = device.createBuffer({
            size: 8,
            usage: RHIBufferUsage.INDEX,
            initialData: new Uint16Array([0, 1, 2, 0])
        });
        prepareIndexedPipeline(pipeline, primaryIndex);
        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass(descriptor);
        pass.setPipeline(pipeline);
        pass.setIndexBuffer(primaryIndex, 'uint16');
        pass.drawIndexed(3);
        pass.end();
        device.graphicsQueue.endFrame(frame);

        const trackedVertexArray = [...callArguments]
            .reverse()
            .find(call => call.name === 'bindVertexArray' && call.args[0] !== null)?.args[0] as
            WebGLVertexArrayObject | undefined;
        if (trackedVertexArray === undefined) throw new Error('expected a tracked vertex array');
        native.deleteVertexArray(trackedVertexArray);

        expect(() => {
            device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.INDEX,
                initialData: new Uint16Array([0, 1])
            });
        }).not.toThrow();
        expect(native.getError()).toBe(native.NO_ERROR);
        device.destroy();
    });

    it('renders an indexed textured triangle offscreen and reads it back in the same frame', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const groupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'float', viewDimension: '2d' }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                }
            ]
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] });
        const vertex = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'vertex',
                code: `#version 300 es
const vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`,
                entryPoint: 'main',
                reflection: { bindings: [], vertexInputs: [] },
                cacheKey: 11
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'fragment',
                code: `#version 300 es
precision highp float;
uniform sampler2D sourceTexture;
out vec4 color;
void main() { color = texture(sourceTexture, vec2(0.5)); }`,
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        { group: 0, binding: 0, kind: 'sampled-texture' },
                        { group: 0, binding: 1, kind: 'sampler' }
                    ],
                    fragmentOutputs: [{ location: 0 }]
                },
                preparedBindings: {
                    combinedSamplers: [
                        {
                            name: 'sourceTexture',
                            group: 0,
                            textureBinding: 0,
                            samplerBinding: 1,
                            arrayIndex: 0
                        }
                    ]
                },
                cacheKey: 12
            }
        });
        const pipeline = device.createGraphicsPipeline({
            layout,
            vertex: { shader: vertex, buffers: [] },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list' }
        });
        const sampled = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        const sampler = device.createSampler();
        const group = device.createBindGroup({
            layout: groupLayout,
            entries: [
                { binding: 0, resource: sampled.createView() },
                { binding: 1, resource: sampler }
            ]
        });
        const index = device.createBuffer({
            size: 8,
            usage: RHIBufferUsage.INDEX | RHIBufferUsage.COPY_DST
        });
        const color = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
        });
        const readback = device.createBuffer({
            size: 8 * 256,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        prepareIndexedPipeline(pipeline, index);

        const frame = device.graphicsQueue.beginFrame();
        frame.writeTexture(
            { texture: sampled },
            new Uint8Array([255, 0, 0, 255]),
            {},
            { width: 1 }
        );
        frame.writeBuffer(index, 0, new Uint16Array([0, 1, 2, 0]));
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
        pass.setBindGroup(0, group);
        pass.setIndexBuffer(index, 'uint16');
        pass.drawIndexed(3);
        pass.end();
        frame.copyTextureToBuffer(
            { texture: color },
            { buffer: readback, bytesPerRow: 256 },
            { width: 8, height: 8 }
        );
        const submission = device.graphicsQueue.endFrame(frame);
        await submission.done;
        await readback.mapAsync('read');
        const bytes = new Uint8Array(readback.getMappedRange());
        const center = 4 * 256 + 4 * 4;
        expect([...bytes.slice(center, center + 4)]).toEqual([255, 0, 0, 255]);
        readback.unmap();
        device.destroy();
    });

    it('renders independent values to multiple color attachments', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const vertex = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'vertex',
                code: `#version 300 es
const vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`,
                entryPoint: 'main',
                reflection: { bindings: [], vertexInputs: [] },
                cacheKey: 21
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'fragment',
                code: `#version 300 es
precision highp float;
layout(location = 0) out vec4 firstColor;
layout(location = 1) out vec4 secondColor;
void main() {
    firstColor = vec4(1.0, 0.0, 0.0, 1.0);
    secondColor = vec4(0.0, 1.0, 0.0, 1.0);
}`,
                entryPoint: 'main',
                reflection: {
                    bindings: [],
                    fragmentOutputs: [{ location: 0 }, { location: 1 }]
                },
                cacheKey: 22
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
        const pipeline = device.createGraphicsPipeline({
            layout,
            vertex: { shader: vertex, buffers: [] },
            fragment: {
                shader: fragment,
                targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }]
            },
            primitive: { topology: 'triangle-list' }
        });
        const first = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
        });
        const second = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
        });

        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass({
            colorAttachments: [
                {
                    view: first.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                },
                {
                    view: second.createView(),
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

        await expect(readTexturePixel(device, first)).resolves.toEqual([255, 0, 0, 255]);
        await expect(readTexturePixel(device, second)).resolves.toEqual([0, 255, 0, 255]);
        device.destroy();
    });

    it('ignores write state for an MRT attachment without a reflected fragment output', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const pipeline = createSolidPipeline(device, 1, undefined, true);
        const first = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
        });
        const second = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
        });

        const frame = device.graphicsQueue.beginFrame();
        const pass = frame.beginRenderPass({
            colorAttachments: [
                {
                    view: first.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                },
                {
                    view: second.createView(),
                    clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        pass.draw(3);
        pass.end();
        device.graphicsQueue.endFrame(frame);

        await expect(readTexturePixel(device, first)).resolves.toEqual([255, 0, 0, 255]);
        await expect(readTexturePixel(device, second)).resolves.toEqual([64, 128, 191, 255]);
        device.destroy();
    });

    it('resolves a multisampled render attachment when the format supports MSAA', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const sampleCount = device.capabilities
            .getTextureFormatCapabilities('rgba8unorm')
            .sampleCounts.find(count => count > 1);
        if (sampleCount === undefined) {
            device.destroy();
            return;
        }
        const source = device.createTexture({
            size: { width: 8, height: 8 },
            sampleCount,
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const resolved = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
        });
        const pipeline = createSolidPipeline(device, sampleCount);
        const descriptor = {
            colorAttachments: [
                {
                    view: source.createView(),
                    resolveTarget: resolved.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear' as const,
                    storeOp: 'store' as const
                }
            ]
        };
        control.calls.length = 0;
        const render = () => {
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass(descriptor);
            pass.setPipeline(pipeline);
            pass.draw(3);
            pass.end();
            device.graphicsQueue.endFrame(frame);
            return frame.diagnostics;
        };
        const firstDiagnostics = render();
        const framebufferCreates = control.calls.filter(
            name => name === 'createFramebuffer'
        ).length;
        const secondDiagnostics = render();
        const thirdDiagnostics = render();
        expect(firstDiagnostics.frameArenaGrowths).toBeGreaterThan(0);
        expect(secondDiagnostics.frameArenaGrowths).toBe(0);
        expect(secondDiagnostics.transientAllocations).toBe(0);
        expect(thirdDiagnostics.frameArenaGrowths).toBe(0);
        expect(thirdDiagnostics.transientAllocations).toBe(0);
        expect(control.calls.filter(name => name === 'createFramebuffer')).toHaveLength(
            framebufferCreates
        );

        await expect(readTexturePixel(device, resolved)).resolves.toEqual([255, 0, 0, 255]);
        device.destroy();
    });

    it('resolves a multisampled render attachment into the default framebuffer', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2', { alpha: false, antialias: false });
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const sampleCount = device.capabilities
            .getTextureFormatCapabilities('rgba8unorm')
            .sampleCounts.find(count => count > 1);
        if (sampleCount === undefined) {
            device.destroy();
            return;
        }
        const surface = device.createSurface(canvas);
        surface.configure({
            format: 'rgba8unorm',
            depthStencilFormat: 'depth24plus',
            width: 8,
            height: 8
        });
        const source = device.createTexture({
            size: { width: 8, height: 8 },
            sampleCount,
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const depth = device.createTexture({
            size: { width: 8, height: 8 },
            sampleCount,
            format: 'depth24plus',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const pipeline = createSolidPipeline(device, sampleCount, 'depth24plus');
        const sourceView = source.createView();
        const depthView = depth.createView();
        control.calls.length = 0;
        const render = () => {
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass({
                colorAttachments: [
                    {
                        view: sourceView,
                        resolveTarget: surface.getCurrentTexture().createView(),
                        clearValue: { r: 0, g: 0, b: 0, a: 1 },
                        loadOp: 'clear',
                        storeOp: 'discard'
                    }
                ],
                depthStencilAttachment: {
                    view: depthView,
                    depthClearValue: 1,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'discard'
                }
            });
            pass.setPipeline(pipeline);
            pass.draw(3);
            pass.end();
            device.graphicsQueue.endFrame(frame);
            const pixel = new Uint8Array(4);
            native.readPixels(4, 4, 1, 1, native.RGBA, native.UNSIGNED_BYTE, pixel);
            surface.present();
            return [...pixel];
        };

        expect(render()).toEqual([255, 0, 0, 255]);
        const framebufferCreates = control.calls.filter(
            name => name === 'createFramebuffer'
        ).length;
        const renderbufferCreates = control.calls.filter(
            name => name === 'createRenderbuffer'
        ).length;
        expect(render()).toEqual([255, 0, 0, 255]);
        expect(render()).toEqual([255, 0, 0, 255]);
        expect(control.calls.filter(name => name === 'createFramebuffer')).toHaveLength(
            framebufferCreates
        );
        expect(control.calls.filter(name => name === 'createRenderbuffer')).toHaveLength(
            renderbufferCreates
        );
        device.destroy();
    });

    it('samples a cube and renders to a selected cube mip face', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const device = createWebGL2RHIDevice(native);
        const groupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'float', viewDimension: 'cube' }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                }
            ]
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] });
        const vertex = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'vertex',
                code: `#version 300 es
const vec2 p[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(p[gl_VertexID], 0.0, 1.0); }`,
                entryPoint: 'main',
                reflection: { bindings: [], vertexInputs: [] },
                cacheKey: 31
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgl2',
                stage: 'fragment',
                code: `#version 300 es
precision highp float;
uniform samplerCube sourceCube;
out vec4 color;
void main() { color = textureLod(sourceCube, vec3(1.0, 0.0, 0.0), 0.0); }`,
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        { group: 0, binding: 0, kind: 'sampled-texture' },
                        { group: 0, binding: 1, kind: 'sampler' }
                    ],
                    fragmentOutputs: [{ location: 0 }]
                },
                preparedBindings: {
                    combinedSamplers: [
                        {
                            name: 'sourceCube',
                            group: 0,
                            textureBinding: 0,
                            samplerBinding: 1,
                            arrayIndex: 0
                        }
                    ]
                },
                cacheKey: 32
            }
        });
        const pipeline = device.createGraphicsPipeline({
            layout,
            vertex: { shader: vertex, buffers: [] },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list' }
        });
        const cube = device.createTexture({
            size: { width: 4, height: 4, depthOrArrayLayers: 6 },
            mipLevelCount: 3,
            viewDimension: 'cube',
            format: 'rgba8unorm',
            usage:
                RHITextureUsage.COPY_DST |
                RHITextureUsage.COPY_SRC |
                RHITextureUsage.TEXTURE_BINDING |
                RHITextureUsage.RENDER_ATTACHMENT
        });
        const sampler = device.createSampler({
            minFilter: 'nearest',
            magFilter: 'nearest',
            mipmapFilter: 'nearest'
        });
        const group = device.createBindGroup({
            layout: groupLayout,
            entries: [
                { binding: 0, resource: cube.createView() },
                { binding: 1, resource: sampler }
            ]
        });
        const output = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
        });
        const positiveX = new Uint8Array(4 * 4 * 4);
        for (let offset = 0; offset < positiveX.length; offset += 4) {
            positiveX[offset] = 255;
            positiveX[offset + 3] = 255;
        }

        const frame = device.graphicsQueue.beginFrame();
        frame.writeTexture(
            { texture: cube, origin: { z: 0 } },
            positiveX,
            { bytesPerRow: 16 },
            { width: 4, height: 4 }
        );
        const pass = frame.beginRenderPass({
            colorAttachments: [
                {
                    view: output.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
        device.graphicsQueue.endFrame(frame);
        await expect(readTexturePixel(device, output)).resolves.toEqual([255, 0, 0, 255]);

        const mipFace = cube.createView({
            dimension: '2d',
            baseMipLevel: 1,
            mipLevelCount: 1,
            baseArrayLayer: 4,
            arrayLayerCount: 1
        });
        const mipFrame = device.graphicsQueue.beginFrame();
        const mipPass = mipFrame.beginRenderPass({
            colorAttachments: [
                {
                    view: mipFace,
                    clearValue: { r: 0, g: 1, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        mipPass.end();
        device.graphicsQueue.endFrame(mipFrame);
        await expect(readTexturePixel(device, cube, 1, 4)).resolves.toEqual([0, 255, 0, 255]);
        device.destroy();
    });

    it('resolves native interop without exposing raw GL or invalidating cached state', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const surface = device.createSurface(canvas);
        surface.configure({ format: 'rgba8unorm', width: 8, height: 8 });
        const interop = createInteropHost(device, surface);
        device.state.setViewport(0, 0, 8, 8);
        const callsBeforeResolve = control.calls.filter(name => name === 'viewport').length;
        const extension = device.resolveInteropExtension(
            'webgl2-native',
            interop.host
        ) as WebGL2NativeExtension | null;
        if (extension === null) {
            throw new Error('Expected WebGL2 native extension');
        }

        expect(extension).not.toHaveProperty('gl');
        expect(device.resolveInteropExtension('webgl2-native', interop.host)).toBe(extension);
        device.state.setViewport(0, 0, 8, 8);
        expect(control.calls.filter(name => name === 'viewport')).toHaveLength(callsBeforeResolve);

        const frame = device.graphicsQueue.beginFrame();
        expect(() => {
            extension.viewport();
        }).toThrow(/frame-open/u);
        await expect(extension.makeXRCompatible()).rejects.toThrow(/frame-open/u);
        expect(() => extension.createXRWebGLLayer({})).toThrow(/frame-open/u);
        device.graphicsQueue.abortFrame(frame);
        device.destroy();
    });

    it('leases controlled XR operations and resets canonical state before and after them', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const control: RecordingControl = { calls: [], failDraw: false };
        let resolveCompatibility: (() => void) | undefined;
        const compatibility = new Promise<void>(resolve => {
            resolveCompatibility = resolve;
        });
        const context = new Proxy(recordingContext(native, control), {
            get(target, property, receiver) {
                if (property === 'makeXRCompatible') {
                    return () => {
                        device.state.setViewport(0, 0, 8, 8);
                        return compatibility;
                    };
                }
                return Reflect.get(target, property, receiver) as unknown;
            }
        });
        const device = createWebGL2RHIDevice(context);
        const surface = device.createSurface(canvas);
        surface.configure({ format: 'rgba8unorm', width: 8, height: 8 });
        const interop = createInteropHost(device, surface);
        const extension = device.resolveInteropExtension(
            'webgl2-native',
            interop.host
        ) as WebGL2NativeExtension | null;
        if (extension === null) {
            throw new Error('Expected WebGL2 native extension');
        }
        device.state.setViewport(0, 0, 8, 8);
        const pending = extension.makeXRCompatible();
        expect(control.calls.filter(name => name === 'viewport')).toHaveLength(2);
        expect(() => device.graphicsQueue.beginFrame()).toThrow(/pending/u);
        await expect(extension.makeXRCompatible()).rejects.toThrow(/pending/u);
        resolveCompatibility?.();
        await pending;
        device.state.setViewport(0, 0, 8, 8);
        expect(control.calls.filter(name => name === 'viewport')).toHaveLength(3);

        let layerContext: unknown;
        vi.stubGlobal(
            'XRWebGLLayer',
            class {
                readonly isTestLayer = true;

                constructor(_session: object, gl: unknown) {
                    layerContext = gl;
                    device.state.setViewport(0, 0, 8, 8);
                }
            }
        );
        const layer = extension.createXRWebGLLayer({}, { alpha: true });
        expect(layer).toBeTypeOf('object');
        expect(layerContext).toBe(context);
        device.state.setViewport(0, 0, 8, 8);
        expect(control.calls.filter(name => name === 'viewport')).toHaveLength(5);
        vi.unstubAllGlobals();
        device.destroy();
    });

    it('rejects a controlled XR operation completed by a stale device generation', async () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        let resolveCompatibility: (() => void) | undefined;
        const compatibility = new Promise<void>(resolve => {
            resolveCompatibility = resolve;
        });
        const control: RecordingControl = { calls: [], failDraw: false };
        const context = new Proxy(recordingContext(native, control), {
            get(target, property) {
                if (property === 'makeXRCompatible') return () => compatibility;
                return Reflect.get(target, property, target) as unknown;
            }
        });
        const device = createWebGL2RHIDevice(context);
        const surface = device.createSurface(canvas);
        surface.configure({ format: 'rgba8unorm', width: 8, height: 8 });
        const interop = createInteropHost(device, surface);
        const extension = device.resolveInteropExtension(
            'webgl2-native',
            interop.host
        ) as WebGL2NativeExtension | null;
        if (extension === null) {
            throw new Error('Expected WebGL2 native extension');
        }

        const pending = extension.makeXRCompatible();
        canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        resolveCompatibility?.();
        await expect(pending).rejects.toThrow(/lease became stale|stale WebGL2/u);
        device.destroy();
    });

    it('binds external presentation through canonical state and restores the system surface', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2');
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = { calls: [], callArguments, failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const surface = device.createSurface(canvas);
        surface.configure({
            format: 'rgba8unorm',
            depthStencilFormat: 'depth24plus',
            width: 8,
            height: 8
        });
        const interop = createInteropHost(device, surface);
        const extension = device.resolveInteropExtension(
            'webgl2-native',
            interop.host
        ) as WebGL2NativeExtension | null;
        if (extension === null) {
            throw new Error('Expected WebGL2 native extension');
        }
        const external = createExternalColorFramebuffer(native, 16, 8);

        const configuredDepth = surface.getDepthStencilTexture();
        expect(() => {
            extension.bindExternalFramebuffer(
                external.framebuffer,
                device.capabilities.limits.maxTextureDimension2D + 1,
                8
            );
        }).toThrow();
        expect(surface.configuration).toMatchObject({ width: 8, height: 8 });
        expect(surface.getDepthStencilTexture()).toBe(configuredDepth);

        extension.bindExternalFramebuffer(external.framebuffer, 16, 8);
        expect(surface.configuration).toMatchObject({ width: 16, height: 8 });
        expect(surface.getDepthStencilTexture()).toMatchObject({ width: 16, height: 8 });
        expect(interop.viewport).toMatchObject({ x: 0, y: 0, width: 16, height: 8 });

        const clearEye = (x: number, color: { r: number; g: number; b: number; a: number }) => {
            extension.viewport(x, 0, 8, 8);
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass({
                colorAttachments: [
                    {
                        view: surface.getCurrentTexture().createView(),
                        clearValue: color,
                        loadOp: 'clear',
                        storeOp: 'store'
                    }
                ]
            });
            pass.end();
            device.graphicsQueue.endFrame(frame);
            surface.present();
        };

        clearEye(0, { r: 1, g: 0, b: 0, a: 1 });
        clearEye(8, { r: 0, g: 0, b: 1, a: 1 });
        expect(readFramebufferPixel(native, external.framebuffer, 4, 4)).toEqual([255, 0, 0, 255]);
        expect(readFramebufferPixel(native, external.framebuffer, 12, 4)).toEqual([0, 0, 255, 255]);

        const firstClear = callArguments.findIndex(call => call.name === 'clearBufferfv');
        expect(
            callArguments
                .slice(0, firstClear)
                .some(
                    call =>
                        call.name === 'scissor' &&
                        call.args[0] === 0 &&
                        call.args[1] === 0 &&
                        call.args[2] === 8 &&
                        call.args[3] === 8
                )
        ).toBe(true);
        expect(
            callArguments.some(
                call =>
                    call.name === 'drawBuffers' &&
                    Array.isArray(call.args[0]) &&
                    call.args[0][0] === native.COLOR_ATTACHMENT0
            )
        ).toBe(true);

        extension.viewport(0, 0, 8, 8);
        const discardFrame = device.graphicsQueue.beginFrame();
        const discardPass = discardFrame.beginRenderPass({
            colorAttachments: [
                {
                    view: surface.getCurrentTexture().createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'discard'
                }
            ]
        });
        discardPass.end();
        device.graphicsQueue.endFrame(discardFrame);
        surface.present();
        expect(
            callArguments.filter(call => call.name === 'invalidateFramebuffer').at(-1)
        ).toMatchObject({ args: [native.FRAMEBUFFER, [native.COLOR_ATTACHMENT0]] });

        extension.state.bindSystemFramebuffer();
        expect(surface.configuration).toMatchObject({ width: 8, height: 8 });
        expect(surface.getDepthStencilTexture()).toMatchObject({ width: 8, height: 8 });
        expect(interop.viewport).toBeNull();
        expect(native.getParameter(native.FRAMEBUFFER_BINDING)).toBeNull();
        expect(callArguments.at(-1)).toMatchObject({ name: 'drawBuffers', args: [[native.BACK]] });

        native.deleteFramebuffer(external.framebuffer);
        native.deleteTexture(external.texture);
        device.destroy();
    });

    it('limits multisample external resolves to each eye rectangle', () => {
        const canvas = document.createElement('canvas');
        const native = canvas.getContext('webgl2', { alpha: false, antialias: false });
        if (native === null) return;
        const callArguments: { readonly name: string; readonly args: readonly unknown[] }[] = [];
        const control: RecordingControl = { calls: [], callArguments, failDraw: false };
        const device = createWebGL2RHIDevice(recordingContext(native, control));
        const sampleCount = device.capabilities
            .getTextureFormatCapabilities('rgba8unorm')
            .sampleCounts.find(count => count > 1);
        if (sampleCount === undefined) {
            device.destroy();
            return;
        }
        const surface = device.createSurface(canvas);
        surface.configure({ format: 'rgba8unorm', width: 8, height: 8 });
        const interop = createInteropHost(device, surface);
        const extension = device.resolveInteropExtension(
            'webgl2-native',
            interop.host
        ) as WebGL2NativeExtension | null;
        if (extension === null) {
            throw new Error('Expected WebGL2 native extension');
        }
        const external = createExternalColorFramebuffer(native, 16, 8);
        extension.bindExternalFramebuffer(external.framebuffer, 16, 8);
        const source = device.createTexture({
            size: { width: 16, height: 8 },
            sampleCount,
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const sourceView = source.createView();

        const clearAndResolveEye = (
            x: number,
            color: { r: number; g: number; b: number; a: number }
        ) => {
            extension.viewport(x, 0, 8, 8);
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass({
                colorAttachments: [
                    {
                        view: sourceView,
                        resolveTarget: surface.getCurrentTexture().createView(),
                        clearValue: color,
                        loadOp: 'clear',
                        storeOp: 'discard'
                    }
                ]
            });
            pass.end();
            device.graphicsQueue.endFrame(frame);
            surface.present();
        };

        clearAndResolveEye(0, { r: 1, g: 0, b: 0, a: 1 });
        clearAndResolveEye(8, { r: 0, g: 1, b: 0, a: 1 });
        expect(readFramebufferPixel(native, external.framebuffer, 4, 4)).toEqual([255, 0, 0, 255]);
        expect(readFramebufferPixel(native, external.framebuffer, 12, 4)).toEqual([0, 255, 0, 255]);
        expect(
            callArguments
                .filter(call => call.name === 'blitFramebuffer')
                .map(call => call.args.slice(0, 8))
        ).toEqual([
            [0, 0, 8, 8, 0, 0, 8, 8],
            [8, 0, 16, 8, 8, 0, 16, 8]
        ]);

        extension.state.bindSystemFramebuffer();
        native.deleteFramebuffer(external.framebuffer);
        native.deleteTexture(external.texture);
        device.destroy();
    });

    it('contains no software command list or replay queue', () => {
        const sources = import.meta.glob<string>(
            '../../../../src/render/rhi/backends/webgl2/**/*.ts',
            { eager: true, query: '?raw', import: 'default' }
        );
        const combined = Object.values(sources).join('\n');
        expect(combined).not.toMatch(/commands\s*\.\s*push|commandBuffer|replay/iu);
    });
});
