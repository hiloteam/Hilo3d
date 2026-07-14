import { afterEach, describe, expect, it, vi } from 'vitest';
import { RHIBufferUsage, RHIShaderStage, RHITextureUsage } from '../../../src/render/rhi/RHI';
import { createWebGLRHI, type WebGLRHI } from '../../../src/render/rhi/webgl2/WebGLRHI';
import { createFakeWebGL2, type FakeWebGL2 } from './FakeWebGL2';
import { describeRHIContract } from './RHIContract';

interface ReadyWebGL2 {
    readonly fake: FakeWebGL2;
    readonly rhi: WebGLRHI;
}

const activeRhis: WebGLRHI[] = [];

async function createReadyWebGL2(
    options: Partial<{
        readonly width: number;
        readonly height: number;
        readonly alpha: boolean;
        readonly antialias: boolean;
        readonly diagnostics: boolean;
    }> = {},
    configureFake?: (fake: FakeWebGL2) => void
): Promise<ReadyWebGL2> {
    const fake = createFakeWebGL2();
    configureFake?.(fake);
    const rhi = await createWebGLRHI({
        canvas: fake.canvas,
        width: options.width ?? 16,
        height: options.height ?? 8,
        ...(options.alpha === undefined ? {} : { alpha: options.alpha }),
        ...(options.antialias === undefined ? {} : { antialias: options.antialias }),
        ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics })
    });
    activeRhis.push(rhi);
    return { fake, rhi };
}

function createUniformDrawSetup(fake: FakeWebGL2, rhi: WebGLRHI, hasDynamicOffset: boolean) {
    const { device } = rhi;
    fake.call('getProgramParameter').mockImplementation(
        (_program: WebGLProgram, parameter: GLenum) => {
            if (parameter === fake.gl.LINK_STATUS) return true;
            if (parameter === fake.gl.ACTIVE_UNIFORM_BLOCKS) return 1;
            return 0;
        }
    );
    fake.call('getActiveUniformBlockName').mockReturnValue('TestBlock');
    const layout = device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: RHIShaderStage.VERTEX,
                buffer: { type: 'uniform', hasDynamicOffset }
            }
        ]
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const vertex = device.createShaderModule({
        code: '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
        language: 'glsl',
        stage: 'vertex',
        preparedBindings: {
            uniformBlocks: [{ name: 'TestBlock', group: 0, binding: 0 }]
        }
    });
    const fragment = device.createShaderModule({
        code: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
        language: 'glsl',
        stage: 'fragment'
    });
    const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: vertex },
        fragment: { module: fragment, targets: [{ format: 'bgra8unorm' }] }
    });
    const buffer = device.createBuffer({
        size: 1024,
        usage: RHIBufferUsage.UNIFORM
    });
    const binding = { buffer, offset: 0, size: 256 };
    const group = device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: binding }]
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: rhi.surface.getCurrentTexture().createView(),
                loadOp: 'load',
                storeOp: 'store'
            }
        ]
    });
    pass.setPipeline(pipeline);
    return { binding, encoder, group, pass };
}

afterEach(() => {
    for (const rhi of activeRhis.splice(0)) rhi.destroy();
    vi.restoreAllMocks();
});

describeRHIContract('WebGL2', 'webgl2', async () => {
    const ready = await createReadyWebGL2({ diagnostics: true });
    return {
        rhi: ready.rhi,
        backend: 'webgl2',
        getSubmissionCount: () => ready.rhi.diagnostics?.submissions ?? 0
    };
});

describe('WebGLRHI native mapping', () => {
    it('requests only WebGL2 with explicit context and surface options', async () => {
        const { fake, rhi } = await createReadyWebGL2({
            width: 40,
            height: 20,
            alpha: false,
            antialias: true
        });

        expect(fake.getContext).toHaveBeenCalledOnce();
        expect(fake.getContext).toHaveBeenCalledWith(
            'webgl2',
            expect.objectContaining({
                alpha: false,
                antialias: true
            })
        );
        expect(fake.getContext.mock.calls[0]?.[1]).not.toHaveProperty('powerPreference');
        expect(fake.canvas.width).toBe(40);
        expect(fake.canvas.height).toBe(20);
        expect(rhi.surface).toMatchObject({
            backend: 'webgl2',
            width: 40,
            height: 20,
            format: 'bgra8unorm'
        });
    });

    it('keeps unsupported storage and alternate texture views out of WebGL', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        expect(() =>
            rhi.device.createBuffer({ size: 16, usage: RHIBufferUsage.STORAGE })
        ).toThrow();
        expect(() =>
            rhi.device.createTexture({
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.STORAGE_BINDING
            })
        ).toThrow();
        expect(() =>
            rhi.device.createTexture({
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING,
                viewFormats: ['rgba8unorm-srgb']
            })
        ).toThrow();
        expect(() =>
            rhi.device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: RHIShaderStage.FRAGMENT,
                        storageTexture: {
                            access: 'write-only',
                            format: 'rgba8unorm'
                        }
                    }
                ]
            })
        ).toThrow();
        expect(fake.call('createBuffer')).not.toHaveBeenCalled();
        expect(fake.call('createTexture')).not.toHaveBeenCalled();
    });

    it('reports format capabilities and gates float attachments on EXT_color_buffer_float', async () => {
        const withoutExtension = await createReadyWebGL2();
        expect(
            withoutExtension.rhi.device.getTextureFormatCapabilities('rgba16float')
        ).toMatchObject({
            sampled: true,
            renderable: false,
            storage: false,
            sampleCounts: []
        });
        expect(
            withoutExtension.rhi.device.getTextureFormatCapabilities('bgra8unorm')
        ).toMatchObject({
            sampled: false,
            filterable: false,
            renderable: false,
            storage: false,
            sampleCounts: []
        });
        expect(() =>
            withoutExtension.rhi.device.createTexture({
                size: { width: 4, height: 4 },
                format: 'bgra8unorm',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            })
        ).toThrow(/canvas surface pseudo-format/iu);
        expect(() =>
            withoutExtension.rhi.device.createTexture({
                size: { width: 4, height: 4 },
                format: 'rgba16float',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            })
        ).toThrow(/EXT_color_buffer_float|render attachment/iu);

        const withExtension = await createReadyWebGL2({}, fake => {
            fake.call('getExtension').mockImplementation((name: string) => {
                if (name === 'EXT_color_buffer_float') return {};
                if (name === 'EXT_texture_filter_anisotropic') {
                    return {
                        MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
                        TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe
                    };
                }
                return null;
            });
        });
        const capabilities = withExtension.rhi.device.getTextureFormatCapabilities('rgba16float');
        expect(capabilities.renderable).toBe(true);
        expect(capabilities.sampleCounts).toEqual([1, 4]);
        expect(() =>
            withExtension.rhi.device.createTexture({
                size: { width: 4, height: 4 },
                format: 'rgba16float',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            })
        ).not.toThrow();
    });

    it('keeps six-layer textures as arrays and rejects non-native sampled subviews', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        const texture = rhi.device.createTexture({
            size: { width: 8, height: 8, depthOrArrayLayers: 6 },
            mipLevelCount: 3,
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT
        });
        expect(texture.createView().dimension).toBe('2d-array');
        expect(fake.call('texStorage3D')).toHaveBeenCalledWith(
            fake.gl.TEXTURE_2D_ARRAY,
            3,
            fake.gl.RGBA8,
            8,
            8,
            6
        );
        expect(() => texture.createView({ dimension: 'cube', arrayLayerCount: 6 })).toThrow(
            /cube views are unsupported/iu
        );

        const subview = texture.createView({
            dimension: '2d',
            baseMipLevel: 1,
            mipLevelCount: 1,
            baseArrayLayer: 2,
            arrayLayerCount: 1
        });
        const layout = rhi.device.createBindGroupLayout({
            entries: [
                {
                    binding: 5,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { viewDimension: '2d' }
                }
            ]
        });
        expect(() =>
            rhi.device.createBindGroup({
                layout,
                entries: [{ binding: 5, resource: subview }]
            })
        ).toThrow(/full native texture view/iu);
    });

    it('matches native BufferSource units without copying typed views', async () => {
        const { fake, rhi } = await createReadyWebGL2({ diagnostics: true });
        const buffer = rhi.device.createBuffer({
            size: 64,
            usage: RHIBufferUsage.COPY_DST
        });
        const wordBacking = new ArrayBuffer(24);
        const words = new Uint16Array(wordBacking, 4, 6);
        words.set([0x0102, 0x0304, 0x0506, 0x0708]);
        const floatBacking = new ArrayBuffer(32);
        const floats = new Float32Array(floatBacking, 8, 4);
        floats.set([1, 2, 3, 4]);
        const viewBacking = new ArrayBuffer(20);
        const view = new DataView(viewBacking, 4, 12);
        fake.call('bufferSubData').mockClear();

        rhi.device.queue.writeBuffer(buffer, 4, words, 1, 2);
        rhi.device.queue.writeBuffer(buffer, 8, floats, 1, 2);
        rhi.device.queue.writeBuffer(buffer, 16, floats, 2);
        rhi.device.queue.writeBuffer(buffer, 24, view, 2, 4);
        expect(() => {
            rhi.device.queue.writeBuffer(buffer, 0, words, 5, 2);
        }).toThrow(/range/iu);
        expect(() => {
            rhi.device.queue.writeBuffer(buffer, 0, words, 0, 1);
        }).toThrow(/multiples of 4/iu);

        expect(fake.call('bufferSubData')).toHaveBeenCalledTimes(4);
        const writes = fake.call('bufferSubData').mock.calls as unknown as readonly [
            GLenum,
            number,
            Uint8Array
        ][];
        expect(writes.map(call => call.slice(0, 2))).toEqual([
            [fake.gl.COPY_WRITE_BUFFER, 4],
            [fake.gl.COPY_WRITE_BUFFER, 8],
            [fake.gl.COPY_WRITE_BUFFER, 16],
            [fake.gl.COPY_WRITE_BUFFER, 24]
        ]);
        expect(writes[0]?.[2]).toMatchObject({
            buffer: words.buffer,
            byteOffset: words.byteOffset + Uint16Array.BYTES_PER_ELEMENT,
            byteLength: 2 * Uint16Array.BYTES_PER_ELEMENT
        });
        expect(writes[1]?.[2]).toMatchObject({
            buffer: floats.buffer,
            byteOffset: floats.byteOffset + Float32Array.BYTES_PER_ELEMENT,
            byteLength: 2 * Float32Array.BYTES_PER_ELEMENT
        });
        expect(writes[2]?.[2]).toMatchObject({
            buffer: floats.buffer,
            byteOffset: floats.byteOffset + 2 * Float32Array.BYTES_PER_ELEMENT,
            byteLength: 2 * Float32Array.BYTES_PER_ELEMENT
        });
        expect(writes[3]?.[2]).toMatchObject({
            buffer: view.buffer,
            byteOffset: view.byteOffset + 2,
            byteLength: 4
        });
        expect(rhi.diagnostics?.bufferUploads).toBe(4);
    });

    it('caches texture bindings independently for every unit and target', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        const texture2D = {} as WebGLTexture;
        const textureCube = {} as WebGLTexture;
        rhi.state.invalidate();
        fake.call('activeTexture').mockClear();
        fake.call('bindTexture').mockClear();

        rhi.state.bindTexture(0, fake.gl.TEXTURE_2D, texture2D);
        rhi.state.bindTexture(0, fake.gl.TEXTURE_CUBE_MAP, textureCube);
        rhi.state.bindTexture(0, fake.gl.TEXTURE_2D, texture2D);
        rhi.state.bindTexture(0, fake.gl.TEXTURE_CUBE_MAP, textureCube);

        expect(fake.call('activeTexture')).toHaveBeenCalledOnce();
        expect(fake.call('bindTexture')).toHaveBeenCalledTimes(2);
        expect(fake.call('bindTexture')).toHaveBeenNthCalledWith(1, fake.gl.TEXTURE_2D, texture2D);
        expect(fake.call('bindTexture')).toHaveBeenNthCalledWith(
            2,
            fake.gl.TEXTURE_CUBE_MAP,
            textureCube
        );
        expect(rhi.state.getBoundTexture(0, fake.gl.TEXTURE_2D)).toBe(texture2D);
        expect(rhi.state.getBoundTexture(0, fake.gl.TEXTURE_CUBE_MAP)).toBe(textureCube);
    });

    it('validates bind-group texture sample types and sampler filtering classes', async () => {
        const { rhi } = await createReadyWebGL2();
        const { device } = rhi;
        const uintTexture = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8uint',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const float32Texture = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba32float',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const defaultFloatLayout = device.createBindGroupLayout({
            entries: [{ binding: 0, visibility: RHIShaderStage.FRAGMENT, texture: {} }]
        });
        expect(() =>
            device.createBindGroup({
                layout: defaultFloatLayout,
                entries: [{ binding: 0, resource: uintTexture.createView() }]
            })
        ).toThrow(/float sample type/iu);
        expect(() =>
            device.createBindGroup({
                layout: defaultFloatLayout,
                entries: [{ binding: 0, resource: float32Texture.createView() }]
            })
        ).toThrow(/float sample type/iu);

        const uintLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'uint' }
                }
            ]
        });
        const unfilterableFloatLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'unfilterable-float' }
                }
            ]
        });
        expect(() =>
            device.createBindGroup({
                layout: uintLayout,
                entries: [{ binding: 0, resource: uintTexture.createView() }]
            })
        ).not.toThrow();
        expect(() =>
            device.createBindGroup({
                layout: unfilterableFloatLayout,
                entries: [{ binding: 0, resource: float32Texture.createView() }]
            })
        ).not.toThrow();

        const nonFilteringSamplerLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'non-filtering' }
                }
            ]
        });
        expect(() =>
            device.createBindGroup({
                layout: nonFilteringSamplerLayout,
                entries: [{ binding: 0, resource: device.createSampler({ minFilter: 'linear' }) }]
            })
        ).toThrow(/non-filtering sampler/iu);
        expect(() =>
            device.createBindGroup({
                layout: nonFilteringSamplerLayout,
                entries: [{ binding: 0, resource: device.createSampler() }]
            })
        ).not.toThrow();

        const comparisonSamplerLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'comparison' }
                }
            ]
        });
        expect(() =>
            device.createBindGroup({
                layout: comparisonSamplerLayout,
                entries: [{ binding: 0, resource: device.createSampler() }]
            })
        ).toThrow(/comparison type/iu);
        expect(() =>
            device.createBindGroup({
                layout: comparisonSamplerLayout,
                entries: [{ binding: 0, resource: device.createSampler({ compare: 'less' }) }]
            })
        ).not.toThrow();
    });

    it('cleans up native samplers when configuration fails', async () => {
        const { fake, rhi } = await createReadyWebGL2({ diagnostics: true });
        fake.call('createSampler').mockClear();
        fake.call('deleteSampler').mockClear();

        for (let attempt = 0; attempt < 2; attempt++) {
            expect(() => rhi.device.createSampler({ maxAnisotropy: 16 })).toThrow(
                /maxAnisotropy/iu
            );
        }

        expect(fake.call('createSampler')).toHaveBeenCalledTimes(2);
        expect(fake.call('deleteSampler')).toHaveBeenCalledTimes(2);
        expect(rhi.diagnostics?.samplersCreated).toBe(0);
    });

    it('deduplicates immutable sampler, layout, and pipeline creation only', async () => {
        const { fake, rhi } = await createReadyWebGL2({ diagnostics: true });
        const { device } = rhi;
        const samplerDescriptor = { minFilter: 'linear' as const, magFilter: 'linear' as const };
        expect(device.createSampler(samplerDescriptor)).toBe(
            device.createSampler(samplerDescriptor)
        );

        const layoutDescriptor = { entries: [] };
        const layout = device.createBindGroupLayout(layoutDescriptor);
        expect(device.createBindGroupLayout(layoutDescriptor)).toBe(layout);
        const pipelineLayoutDescriptor = { bindGroupLayouts: [layout] };
        const pipelineLayout = device.createPipelineLayout(pipelineLayoutDescriptor);
        expect(device.createPipelineLayout(pipelineLayoutDescriptor)).toBe(pipelineLayout);
        const vertex = device.createShaderModule({
            code: '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
            language: 'glsl',
            stage: 'vertex'
        });
        const fragment = device.createShaderModule({
            code: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
            language: 'glsl',
            stage: 'fragment'
        });
        const pipelineDescriptor = {
            layout: pipelineLayout,
            vertex: { module: vertex },
            fragment: { module: fragment, targets: [{ format: 'bgra8unorm' as const }] }
        };
        expect(device.createRenderPipeline(pipelineDescriptor)).toBe(
            device.createRenderPipeline(pipelineDescriptor)
        );

        const firstGroup = device.createBindGroup({ layout, entries: [] });
        const secondGroup = device.createBindGroup({ layout, entries: [] });
        const firstBuffer = device.createBuffer({ size: 16, usage: RHIBufferUsage.VERTEX });
        const secondBuffer = device.createBuffer({ size: 16, usage: RHIBufferUsage.VERTEX });
        expect(secondGroup).not.toBe(firstGroup);
        expect(secondBuffer).not.toBe(firstBuffer);
        expect(fake.call('createSampler')).toHaveBeenCalledOnce();
        expect(fake.call('createProgram')).toHaveBeenCalledOnce();
        expect(fake.call('createBuffer')).toHaveBeenCalledTimes(2);
        expect(rhi.diagnostics?.snapshot()).toMatchObject({
            samplersCreated: 1,
            pipelinesCreated: 1,
            bindGroupsCreated: 2,
            buffersCreated: 2
        });
    });

    it('maps reversed GL reflection by prepared binding names, never enumeration order', async () => {
        const materialLocation = {} as WebGLUniformLocation;
        const colorLocation = {} as WebGLUniformLocation;
        const { fake, rhi } = await createReadyWebGL2({}, configuredFake => {
            configuredFake
                .call('getProgramParameter')
                .mockImplementation((_program: WebGLProgram, parameter: GLenum) => {
                    if (parameter === configuredFake.gl.LINK_STATUS) return true;
                    if (parameter === configuredFake.gl.ACTIVE_UNIFORM_BLOCKS) return 2;
                    if (parameter === configuredFake.gl.ACTIVE_UNIFORMS) return 2;
                    return 0;
                });
            configuredFake
                .call('getActiveUniformBlockName')
                .mockImplementation((_program: WebGLProgram, index: number) =>
                    index === 0 ? 'MaterialBlock' : 'FrameBlock'
                );
            configuredFake
                .call('getActiveUniform')
                .mockImplementation((_program: WebGLProgram, index: number) => ({
                    name: index === 0 ? 'uNormal' : 'uColor',
                    size: 1,
                    type: configuredFake.gl.SAMPLER_2D
                }));
            configuredFake
                .call('getUniformLocation')
                .mockImplementation((_program: WebGLProgram, name: string) =>
                    name === 'uNormal' ? materialLocation : colorLocation
                );
        });
        const { device } = rhi;
        const group0Layout = device.createBindGroupLayout({
            entries: [
                { binding: 9, visibility: RHIShaderStage.FRAGMENT, sampler: {} },
                { binding: 7, visibility: RHIShaderStage.VERTEX, buffer: {} },
                { binding: 3, visibility: RHIShaderStage.FRAGMENT, texture: {} }
            ]
        });
        const group1Layout = device.createBindGroupLayout({
            entries: [
                { binding: 11, visibility: RHIShaderStage.FRAGMENT, texture: {} },
                { binding: 2, visibility: RHIShaderStage.VERTEX, buffer: {} },
                { binding: 4, visibility: RHIShaderStage.FRAGMENT, sampler: {} }
            ]
        });
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [group0Layout, group1Layout]
        });
        const vertex = device.createShaderModule({
            code: '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
            language: 'glsl',
            stage: 'vertex',
            preparedBindings: {
                uniformBlocks: [
                    { name: 'FrameBlock', group: 0, binding: 7 },
                    { name: 'MaterialBlock', group: 1, binding: 2 }
                ]
            }
        });
        const fragment = device.createShaderModule({
            code: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
            language: 'glsl',
            stage: 'fragment',
            preparedBindings: {
                samplers: [
                    {
                        name: 'uColor',
                        arrayIndex: 0,
                        group: 0,
                        textureBinding: 3,
                        samplerBinding: 9
                    },
                    {
                        name: 'uNormal',
                        arrayIndex: 0,
                        group: 1,
                        textureBinding: 11,
                        samplerBinding: 4
                    }
                ]
            }
        });
        const pipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: vertex },
            fragment: { module: fragment, targets: [{ format: 'bgra8unorm' }] }
        });
        const program = fake.call('createProgram').mock.results[0]?.value as WebGLProgram;
        expect(fake.call('uniformBlockBinding')).toHaveBeenNthCalledWith(1, program, 1, 0);
        expect(fake.call('uniformBlockBinding')).toHaveBeenNthCalledWith(2, program, 0, 1);

        const frameBuffer = device.createBuffer({ size: 256, usage: RHIBufferUsage.UNIFORM });
        const materialBuffer = device.createBuffer({ size: 256, usage: RHIBufferUsage.UNIFORM });
        const colorTexture = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const normalTexture = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const colorSampler = device.createSampler();
        const normalSampler = device.createSampler({ minFilter: 'linear' });
        const group0 = device.createBindGroup({
            layout: group0Layout,
            entries: [
                { binding: 7, resource: { buffer: frameBuffer, size: 256 } },
                { binding: 3, resource: colorTexture.createView() },
                { binding: 9, resource: colorSampler }
            ]
        });
        const group1 = device.createBindGroup({
            layout: group1Layout,
            entries: [
                { binding: 2, resource: { buffer: materialBuffer, size: 256 } },
                { binding: 11, resource: normalTexture.createView() },
                { binding: 4, resource: normalSampler }
            ]
        });
        fake.call('bindBufferRange').mockClear();
        fake.call('bindSampler').mockClear();
        fake.call('uniform1i').mockClear();
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: rhi.surface.getCurrentTexture().createView(),
                    loadOp: 'load',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group0);
        pass.setBindGroup(1, group1);
        pass.draw(3);

        expect(fake.call('uniform1i')).toHaveBeenNthCalledWith(1, materialLocation, 1);
        expect(fake.call('uniform1i')).toHaveBeenNthCalledWith(2, colorLocation, 0);
        expect(fake.call('bindBufferRange')).toHaveBeenNthCalledWith(
            1,
            fake.gl.UNIFORM_BUFFER,
            0,
            expect.anything(),
            0,
            256
        );
        expect(fake.call('bindBufferRange')).toHaveBeenNthCalledWith(
            2,
            fake.gl.UNIFORM_BUFFER,
            1,
            expect.anything(),
            0,
            256
        );
        expect(fake.call('bindSampler')).toHaveBeenNthCalledWith(1, 0, colorSampler.native);
        expect(fake.call('bindSampler')).toHaveBeenNthCalledWith(2, 1, normalSampler.native);
        pass.end();
        encoder.finish();
    });

    it('rejects incompatible prepared sampler layout pairs and deletes the linked program', async () => {
        const samplerLocation = {} as WebGLUniformLocation;
        const { fake, rhi } = await createReadyWebGL2({}, configuredFake => {
            configuredFake
                .call('getProgramParameter')
                .mockImplementation((_program: WebGLProgram, parameter: GLenum) => {
                    if (parameter === configuredFake.gl.LINK_STATUS) return true;
                    if (parameter === configuredFake.gl.ACTIVE_UNIFORMS) return 1;
                    return 0;
                });
            configuredFake.call('getActiveUniform').mockReturnValue({
                name: 'uTexture',
                size: 1,
                type: configuredFake.gl.SAMPLER_2D
            });
            configuredFake.call('getUniformLocation').mockReturnValue(samplerLocation);
        });
        const { device } = rhi;
        const layout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'unfilterable-float' }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                }
            ]
        });
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const vertex = device.createShaderModule({
            code: '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
            language: 'glsl',
            stage: 'vertex'
        });
        const fragment = device.createShaderModule({
            code: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
            language: 'glsl',
            stage: 'fragment',
            preparedBindings: {
                samplers: [
                    {
                        name: 'uTexture',
                        arrayIndex: 0,
                        group: 0,
                        textureBinding: 0,
                        samplerBinding: 1
                    }
                ]
            }
        });
        fake.call('deleteProgram').mockClear();

        expect(() =>
            device.createRenderPipeline({
                layout: pipelineLayout,
                vertex: { module: vertex },
                fragment: { module: fragment, targets: [{ format: 'bgra8unorm' }] }
            })
        ).toThrow(/filtering sampler.*unfilterable-float/iu);
        expect(fake.call('deleteProgram')).toHaveBeenCalledOnce();

        const numericDepthLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'depth' }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'non-filtering' }
                }
            ]
        });
        const numericDepthPipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [numericDepthLayout]
        });
        expect(() =>
            device.createRenderPipeline({
                layout: numericDepthPipelineLayout,
                vertex: { module: vertex },
                fragment: { module: fragment, targets: [{ format: 'bgra8unorm' }] }
            })
        ).not.toThrow();
    });

    it('snapshots dynamic offsets when setBindGroup is called', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        const { encoder, group, pass } = createUniformDrawSetup(fake, rhi, true);
        const dynamicOffsets = [256];
        fake.call('bindBufferRange').mockClear();

        pass.setBindGroup(0, group, dynamicOffsets);
        dynamicOffsets[0] = 512;
        pass.draw(3);

        expect(fake.call('bindBufferRange')).toHaveBeenCalledOnce();
        expect(fake.call('bindBufferRange')).toHaveBeenCalledWith(
            fake.gl.UNIFORM_BUFFER,
            0,
            expect.anything(),
            256,
            256
        );
        pass.end();
        encoder.finish();
    });

    it('snapshots buffer-binding descriptors when a bind group is created', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        const { binding, encoder, group, pass } = createUniformDrawSetup(fake, rhi, false);
        fake.call('bindBufferRange').mockClear();

        binding.offset = 256;
        binding.size = 512;
        pass.setBindGroup(0, group);
        pass.draw(3);

        expect(fake.call('bindBufferRange')).toHaveBeenCalledOnce();
        expect(fake.call('bindBufferRange')).toHaveBeenCalledWith(
            fake.gl.UNIFORM_BUFFER,
            0,
            expect.anything(),
            0,
            256
        );
        pass.end();
        encoder.finish();
    });

    it('reuses A/B/A pipeline state and VAOs, executes immediately, and never replays', async () => {
        const { fake, rhi } = await createReadyWebGL2({ diagnostics: true });
        const { device } = rhi;
        const layout = device.createBindGroupLayout({ entries: [] });
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const group = device.createBindGroup({ layout, entries: [] });
        const vertex = device.createShaderModule({
            code: '#version 300 es\nlayout(location = 0) in vec3 position;\nvoid main() { gl_Position = vec4(position, 1.0); }',
            language: 'glsl',
            stage: 'vertex'
        });
        const fragment = device.createShaderModule({
            code: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
            language: 'glsl',
            stage: 'fragment'
        });
        const pipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: vertex,
                buffers: [
                    {
                        arrayStride: 12,
                        attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }]
                    }
                ]
            },
            fragment: { module: fragment, targets: [{ format: 'bgra8unorm' }] }
        });
        const vertexBufferA = device.createBuffer({
            size: 36,
            usage: RHIBufferUsage.VERTEX
        });
        const vertexBufferB = device.createBuffer({
            size: 36,
            usage: RHIBufferUsage.VERTEX
        });
        for (const name of [
            'useProgram',
            'createVertexArray',
            'bindVertexArray',
            'enableVertexAttribArray',
            'vertexAttribPointer',
            'drawArrays',
            'clearBufferfv'
        ]) {
            fake.call(name).mockClear();
        }

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: rhi.surface.getCurrentTexture().createView(),
                    clearValue: { r: 0, g: 0.25, b: 0.5, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        for (const [index, vertexBuffer] of [
            vertexBufferA,
            vertexBufferB,
            vertexBufferA
        ].entries()) {
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, group);
            pass.setVertexBuffer(0, vertexBuffer, 0, 36);
            pass.draw(3);
            expect(fake.call('createVertexArray')).toHaveBeenCalledTimes(Math.min(index + 1, 2));
            expect(fake.call('createProgram')).toHaveBeenCalledOnce();
        }

        expect(fake.call('clearBufferfv')).toHaveBeenCalledOnce();
        expect(fake.call('useProgram')).toHaveBeenCalledOnce();
        expect(fake.call('createVertexArray')).toHaveBeenCalledTimes(2);
        expect(fake.call('bindVertexArray')).toHaveBeenCalledTimes(3);
        expect(fake.call('enableVertexAttribArray')).toHaveBeenCalledTimes(2);
        expect(fake.call('vertexAttribPointer')).toHaveBeenCalledTimes(2);
        expect(fake.call('drawArrays')).toHaveBeenCalledTimes(3);
        expect(rhi.diagnostics?.drawCalls).toBe(3);

        pass.end();
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
        expect(fake.call('drawArrays')).toHaveBeenCalledTimes(3);
        expect(fake.call('createProgram')).toHaveBeenCalledOnce();
        expect(fake.call('createVertexArray')).toHaveBeenCalledTimes(2);
        expect(fake.call('useProgram')).toHaveBeenCalledOnce();
        expect(fake.call('bindVertexArray')).toHaveBeenCalledTimes(3);
        expect(() => {
            device.queue.submit([commandBuffer]);
        }).toThrow();
    });

    it('keeps VAO records and hash buckets bounded through repeated binding churn', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        const { device } = rhi;
        const layout = device.createBindGroupLayout({ entries: [] });
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const vertex = device.createShaderModule({
            code: '#version 300 es\nlayout(location = 0) in vec3 position;\nvoid main() { gl_Position = vec4(position, 1.0); }',
            language: 'glsl',
            stage: 'vertex'
        });
        const fragment = device.createShaderModule({
            code: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
            language: 'glsl',
            stage: 'fragment'
        });
        const pipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: {
                module: vertex,
                buffers: [
                    {
                        arrayStride: 12,
                        attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }]
                    }
                ]
            },
            fragment: { module: fragment, targets: [{ format: 'bgra8unorm' }] }
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: rhi.surface.getCurrentTexture().createView(),
                    loadOp: 'load',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        fake.call('createVertexArray').mockClear();
        fake.call('deleteVertexArray').mockClear();

        const capacity = 256;
        const drawCount = (capacity + 1) * 3;
        for (let index = 0; index < drawCount; index++) {
            const vertexBuffer = device.createBuffer({
                size: 36,
                usage: RHIBufferUsage.VERTEX
            });
            pass.setVertexBuffer(0, vertexBuffer, 0, 36);
            pass.draw(3);
        }

        expect(fake.call('createVertexArray')).toHaveBeenCalledTimes(drawCount);
        expect(fake.call('deleteVertexArray')).toHaveBeenCalledTimes(drawCount - capacity);
        expect(pipeline.vertexArrayCacheSize).toBe(capacity);
        expect(pipeline.vertexArrayCacheBucketCount).toBeLessThanOrEqual(capacity);

        pass.end();
        encoder.finish();
    });

    it('copies buffer data to textures during encoding and does not replay the copy', async () => {
        const { fake, rhi } = await createReadyWebGL2({ diagnostics: true });
        const source = rhi.device.createBuffer({
            size: 256,
            usage: RHIBufferUsage.COPY_SRC
        });
        const texture = rhi.device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST
        });
        fake.call('texSubImage2D').mockClear();
        const encoder = rhi.device.createCommandEncoder();

        encoder.copyBufferToTexture(
            { buffer: source, offset: 4, bytesPerRow: 8, rowsPerImage: 2 },
            { texture, origin: { x: 0, y: 0, z: 0 } },
            { width: 2, height: 2, depthOrArrayLayers: 1 }
        );

        expect(fake.call('texSubImage2D')).toHaveBeenCalledOnce();
        expect(fake.call('texSubImage2D')).toHaveBeenCalledWith(
            fake.gl.TEXTURE_2D,
            0,
            0,
            0,
            2,
            2,
            fake.gl.RGBA,
            fake.gl.UNSIGNED_BYTE,
            4
        );
        const commandBuffer = encoder.finish();
        rhi.device.queue.submit([commandBuffer]);
        expect(fake.call('texSubImage2D')).toHaveBeenCalledOnce();
    });

    it('rejects unsupported sample masks and vertex strides above the WebGL limit', async () => {
        const { rhi } = await createReadyWebGL2();
        const { device } = rhi;
        expect(device.limits.maxVertexBufferArrayStride).toBe(255);
        const layout = device.createBindGroupLayout({ entries: [] });
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const vertex = device.createShaderModule({
            code: '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
            language: 'glsl',
            stage: 'vertex'
        });
        const fragment = device.createShaderModule({
            code: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
            language: 'glsl',
            stage: 'fragment'
        });
        const common = {
            layout: pipelineLayout,
            fragment: { module: fragment, targets: [{ format: 'bgra8unorm' as const }] }
        };
        expect(() =>
            device.createRenderPipeline({
                ...common,
                vertex: { module: vertex },
                multisample: { mask: 0x0fffffff }
            })
        ).toThrow(/sample mask/iu);
        expect(() =>
            device.createRenderPipeline({
                ...common,
                vertex: {
                    module: vertex,
                    buffers: [
                        {
                            arrayStride: 256,
                            attributes: [{ format: 'float32x4', offset: 0, shaderLocation: 0 }]
                        }
                    ]
                }
            })
        ).toThrow(/arrayStride/iu);
    });

    it('enforces depth and stencil read-only render pass state', async () => {
        const { rhi } = await createReadyWebGL2();
        const { device } = rhi;
        const color = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const depth = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'depth24plus',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const depthStencil = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'depth24plus-stencil8',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const colorAttachment = {
            view: color.createView(),
            loadOp: 'load' as const,
            storeOp: 'store' as const
        };
        expect(() =>
            device.createCommandEncoder().beginRenderPass({
                colorAttachments: [colorAttachment],
                depthStencilAttachment: {
                    view: depth.createView(),
                    depthReadOnly: true,
                    depthLoadOp: 'clear',
                    depthClearValue: 1
                }
            })
        ).toThrow(/depth.*read.only/iu);
        expect(() =>
            device.createCommandEncoder().beginRenderPass({
                colorAttachments: [colorAttachment],
                depthStencilAttachment: {
                    view: depthStencil.createView(),
                    stencilReadOnly: true,
                    stencilLoadOp: 'clear',
                    stencilClearValue: 0
                }
            })
        ).toThrow(/stencil.*read.only/iu);

        const layout = device.createBindGroupLayout({ entries: [] });
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const vertex = device.createShaderModule({
            code: '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
            language: 'glsl',
            stage: 'vertex'
        });
        const fragment = device.createShaderModule({
            code: '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0); }',
            language: 'glsl',
            stage: 'fragment'
        });
        const depthWriter = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: vertex },
            fragment: { module: fragment, targets: [{ format: 'rgba8unorm' }] },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less'
            }
        });
        const depthEncoder = device.createCommandEncoder();
        const depthPass = depthEncoder.beginRenderPass({
            colorAttachments: [colorAttachment],
            depthStencilAttachment: { view: depth.createView(), depthReadOnly: true }
        });
        expect(() => {
            depthPass.setPipeline(depthWriter);
        }).toThrow(/depth-writing/iu);
        depthPass.end();
        depthEncoder.finish();

        const stencilWriter = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: vertex },
            fragment: { module: fragment, targets: [{ format: 'rgba8unorm' }] },
            depthStencil: {
                format: 'depth24plus-stencil8',
                depthWriteEnabled: false,
                stencilWriteMask: 1
            }
        });
        const stencilEncoder = device.createCommandEncoder();
        const stencilPass = stencilEncoder.beginRenderPass({
            colorAttachments: [colorAttachment],
            depthStencilAttachment: {
                view: depthStencil.createView(),
                stencilReadOnly: true
            }
        });
        expect(() => {
            stencilPass.setPipeline(stencilWriter);
        }).toThrow(/stencilWriteMask/iu);
        stencilPass.end();
        stencilEncoder.finish();
    });

    it('validates resolve target size and selected layer before framebuffer creation', async () => {
        const { rhi } = await createReadyWebGL2();
        const { device } = rhi;
        const source = device.createTexture({
            size: { width: 4, height: 4 },
            sampleCount: 4,
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const wrongSize = device.createTexture({
            size: { width: 2, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        expect(() =>
            device.createCommandEncoder().beginRenderPass({
                colorAttachments: [
                    {
                        view: source.createView(),
                        resolveTarget: wrongSize.createView(),
                        loadOp: 'load',
                        storeOp: 'store'
                    }
                ]
            })
        ).toThrow(/dimensions/iu);

        const layered = device.createTexture({
            size: { width: 4, height: 4, depthOrArrayLayers: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        expect(() =>
            device.createCommandEncoder().beginRenderPass({
                colorAttachments: [
                    {
                        view: source.createView(),
                        resolveTarget: layered.createView(),
                        loadOp: 'load',
                        storeOp: 'store'
                    }
                ]
            })
        ).toThrow(/one mip level and one array layer/iu);
    });

    it('deletes native resources and resolves device loss once on destruction', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        const device = rhi.device;
        const buffer = device.createBuffer({ size: 16, usage: RHIBufferUsage.COPY_DST });
        const texture = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        buffer.destroy();
        buffer.destroy();
        texture.destroy();
        texture.destroy();
        expect(fake.call('deleteBuffer')).toHaveBeenCalledOnce();
        expect(fake.call('deleteTexture')).toHaveBeenCalledOnce();

        rhi.destroy();
        rhi.destroy();
        await expect(device.lost).resolves.toEqual({
            reason: 'destroyed',
            message: 'WebGL RHI device was destroyed'
        });
        expect(rhi.isReady).toBe(false);
    });

    it('replaces the device/state generation after context restoration', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        const previousDevice = rhi.device;
        const previousState = rhi.state;
        const events: string[] = [];
        rhi.addContextLifecycleListener(event => {
            events.push(`${event.type}:${String(event.generation)}`);
        });

        const lostEvent = new Event('webglcontextlost', { cancelable: true });
        fake.canvas.dispatchEvent(lostEvent);
        const recovery = rhi.recovery;
        expect(lostEvent.defaultPrevented).toBe(true);
        expect(rhi.isReady).toBe(false);

        fake.canvas.dispatchEvent(new Event('webglcontextrestored'));
        await expect(recovery).resolves.toBeUndefined();

        expect(rhi.isReady).toBe(true);
        expect(rhi.generation).toBe(2);
        expect(rhi.device).not.toBe(previousDevice);
        expect(rhi.state).not.toBe(previousState);
        expect(rhi.nativeContext).toBe(fake.gl);
        expect(events).toEqual(['lost:1', 'restored:2']);
        await expect(previousDevice.lost).resolves.toMatchObject({
            message: 'WebGL context was lost'
        });
    });

    it('fails closed and rejects recovery when a restored lifecycle listener throws', async () => {
        const { fake, rhi } = await createReadyWebGL2();
        const failure = new Error('renderer restore failed');
        rhi.addContextLifecycleListener(event => {
            if (event.type === 'restored') throw failure;
        });

        fake.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
        const recovery = rhi.recovery;
        fake.canvas.dispatchEvent(new Event('webglcontextrestored'));

        await expect(recovery).rejects.toBe(failure);
        expect(rhi.isReady).toBe(false);
        expect(rhi.generation).toBe(2);
        await expect(rhi.device.lost).resolves.toMatchObject({
            message: 'WebGL context was lost'
        });
    });
});
