import { expect } from 'vitest';
import {
    RHIBufferUsage,
    RHIShaderStage,
    RHITextureUsage,
    type RHIBindGroupLayout,
    type RHIBuffer,
    type RHICommandContext,
    type RHIDepthStencilState,
    type RHIDevice,
    type RHIGraphicsPipeline,
    type RHIPipelineLayout,
    type RHIShader
} from '../../../../src/render/rhi/core';

const WIDTH = 4;
const HEIGHT = 4;
const BYTES_PER_ROW = 256;
const RED = Object.freeze([255, 0, 0, 255]);
const GREEN = Object.freeze([0, 255, 0, 255]);
const TEXTURED_BLUE = Object.freeze([32, 96, 224, 255]);
const CUBE_ORANGE = Object.freeze([250, 128, 16, 255]);

type FragmentProgram = 'solid' | 'green' | 'textured-2d' | 'mrt' | 'cube';

export interface RHIPhase2ConformanceHarness {
    readonly device: RHIDevice;
    readonly canvas: HTMLCanvasElement;
}

export interface RHIPhase2ConformanceResult {
    readonly backend: 'webgl2' | 'webgpu';
    readonly offscreenPixel: readonly number[];
    readonly indexedTexturedPixel: readonly number[];
    readonly mrtPixels: readonly [readonly number[], readonly number[]];
    readonly depthStencilPixels: readonly [readonly number[], readonly number[]];
    readonly msaaPixel: readonly number[] | null;
    readonly cubeSamplePixel: readonly number[];
    readonly cubeMipPixel: readonly number[];
    readonly drawCounts: Readonly<{
        offscreen: number;
        indexedTextured: number;
        mrt: number;
        depthStencil: number;
        msaa: number | null;
        cube: number;
        surface: number;
    }>;
    readonly surface: Readonly<{
        configuredState: string;
        acquiredState: string;
        presentedState: string;
        textureDestroyedAfterPresent: boolean;
    }>;
    readonly order: readonly string[];
}

function createVertexShader(device: RHIDevice): RHIShader {
    const reflection = { bindings: [], vertexInputs: [] } as const;
    if (device.backend === 'webgpu') {
        return device.createShader({
            label: 'phase2 fullscreen vertex',
            artifact: {
                backend: 'webgpu',
                stage: 'vertex',
                code: `
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
};

@vertex fn main(@builtin(vertex_index) index: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var output: VertexOutput;
    output.position = vec4<f32>(positions[index], 0.0, 1.0);
    return output;
}`,
                entryPoint: 'main',
                reflection,
                cacheKey: 2001
            }
        });
    }
    return device.createShader({
        label: 'phase2 fullscreen vertex',
        artifact: {
            backend: 'webgl2',
            stage: 'vertex',
            code: `#version 300 es
const vec2 positions[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
);
void main() { gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0); }`,
            entryPoint: 'main',
            reflection,
            cacheKey: 2001
        }
    });
}

function fragmentReflection(program: FragmentProgram) {
    const bindings =
        program === 'textured-2d' || program === 'cube'
            ? ([
                  { group: 0, binding: 0, kind: 'sampled-texture' },
                  { group: 0, binding: 1, kind: 'sampler' }
              ] as const)
            : ([] as const);
    return {
        bindings,
        fragmentOutputs:
            program === 'mrt' ? ([{ location: 0 }, { location: 1 }] as const) : [{ location: 0 }]
    } as const;
}

function webGPUFragmentCode(program: FragmentProgram): string {
    switch (program) {
        case 'solid':
            return `@fragment fn main() -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 0.0, 0.0, 1.0);
}`;
        case 'green':
            return `@fragment fn main() -> @location(0) vec4<f32> {
    return vec4<f32>(0.0, 1.0, 0.0, 1.0);
}`;
        case 'textured-2d':
            return `@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@fragment fn main() -> @location(0) vec4<f32> {
    return textureSample(sourceTexture, sourceSampler, vec2<f32>(0.5, 0.5));
}`;
        case 'mrt':
            return `struct FragmentOutput {
    @location(0) first: vec4<f32>,
    @location(1) second: vec4<f32>,
};
@fragment fn main() -> FragmentOutput {
    var output: FragmentOutput;
    output.first = vec4<f32>(1.0, 0.0, 0.0, 1.0);
    output.second = vec4<f32>(0.0, 1.0, 0.0, 1.0);
    return output;
}`;
        case 'cube':
            return `@group(0) @binding(0) var sourceCube: texture_cube<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@fragment fn main() -> @location(0) vec4<f32> {
    return textureSampleLevel(
        sourceCube,
        sourceSampler,
        vec3<f32>(1.0, 0.0, 0.0),
        0.0
    );
}`;
    }
}

function webGL2FragmentCode(program: FragmentProgram): string {
    switch (program) {
        case 'solid':
            return `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() { color = vec4(1.0, 0.0, 0.0, 1.0); }`;
        case 'green':
            return `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() { color = vec4(0.0, 1.0, 0.0, 1.0); }`;
        case 'textured-2d':
            return `#version 300 es
precision highp float;
uniform sampler2D sourceTexture;
layout(location = 0) out vec4 color;
void main() { color = texture(sourceTexture, vec2(0.5)); }`;
        case 'mrt':
            return `#version 300 es
precision highp float;
layout(location = 0) out vec4 firstColor;
layout(location = 1) out vec4 secondColor;
void main() {
    firstColor = vec4(1.0, 0.0, 0.0, 1.0);
    secondColor = vec4(0.0, 1.0, 0.0, 1.0);
}`;
        case 'cube':
            return `#version 300 es
precision highp float;
uniform samplerCube sourceCube;
layout(location = 0) out vec4 color;
void main() { color = textureLod(sourceCube, vec3(1.0, 0.0, 0.0), 0.0); }`;
    }
}

function createFragmentShader(device: RHIDevice, program: FragmentProgram): RHIShader {
    const reflection = fragmentReflection(program);
    const cacheKey = 2010 + ['solid', 'green', 'textured-2d', 'mrt', 'cube'].indexOf(program);
    if (device.backend === 'webgpu') {
        return device.createShader({
            label: `phase2 ${program} fragment`,
            artifact: {
                backend: 'webgpu',
                stage: 'fragment',
                code: webGPUFragmentCode(program),
                entryPoint: 'main',
                reflection,
                cacheKey
            }
        });
    }
    const samplerName = program === 'cube' ? 'sourceCube' : 'sourceTexture';
    return device.createShader({
        label: `phase2 ${program} fragment`,
        artifact: {
            backend: 'webgl2',
            stage: 'fragment',
            code: webGL2FragmentCode(program),
            entryPoint: 'main',
            reflection,
            ...(program === 'textured-2d' || program === 'cube'
                ? {
                      preparedBindings: {
                          combinedSamplers: [
                              {
                                  name: samplerName,
                                  group: 0,
                                  textureBinding: 0,
                                  samplerBinding: 1,
                                  arrayIndex: 0
                              }
                          ]
                      }
                  }
                : {}),
            cacheKey
        }
    });
}

function createPipeline(
    device: RHIDevice,
    label: string,
    program: FragmentProgram,
    layout: RHIPipelineLayout,
    sampleCount = 1,
    depthStencil?: Readonly<RHIDepthStencilState>
): RHIGraphicsPipeline {
    const targets =
        program === 'mrt'
            ? ([{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] as const)
            : ([{ format: 'rgba8unorm' }] as const);
    return device.createGraphicsPipeline({
        label,
        layout,
        vertex: { shader: createVertexShader(device), buffers: [] },
        fragment: {
            shader: createFragmentShader(device, program),
            targets
        },
        primitive: { topology: 'triangle-list' },
        ...(depthStencil === undefined ? {} : { depthStencil }),
        multisample: { count: sampleCount }
    });
}

function createSampleLayout(device: RHIDevice, dimension: '2d' | 'cube'): RHIBindGroupLayout {
    return device.createBindGroupLayout({
        entries: [
            {
                binding: 0,
                visibility: RHIShaderStage.FRAGMENT,
                texture: { sampleType: 'float', viewDimension: dimension }
            },
            {
                binding: 1,
                visibility: RHIShaderStage.FRAGMENT,
                sampler: { type: 'filtering' }
            }
        ]
    });
}

function createColorTexture(
    device: RHIDevice,
    label: string,
    usage = RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC,
    sampleCount = 1
) {
    return device.createTexture({
        label,
        size: { width: WIDTH, height: HEIGHT },
        sampleCount,
        format: 'rgba8unorm',
        usage
    });
}

function createReadback(device: RHIDevice, label: string, height = HEIGHT): RHIBuffer {
    return device.createBuffer({
        label,
        size: height * BYTES_PER_ROW,
        usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
    });
}

async function readPixel(
    buffer: RHIBuffer,
    width = WIDTH,
    height = HEIGHT
): Promise<readonly number[]> {
    await buffer.mapAsync('read');
    const bytes = new Uint8Array(buffer.getMappedRange());
    const offset = Math.floor(height / 2) * BYTES_PER_ROW + Math.floor(width / 2) * 4;
    const result = Object.freeze([...bytes.slice(offset, offset + 4)]);
    buffer.unmap();
    return result;
}

async function finishFrame(device: RHIDevice, frame: RHICommandContext): Promise<void> {
    await device.graphicsQueue.endFrame(frame).done;
}

async function runOffscreenScene(device: RHIDevice, order: string[]) {
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    const pipeline = createPipeline(device, 'phase2:offscreen', 'solid', layout);
    const source = createColorTexture(device, 'phase2 offscreen source');
    const copied = createColorTexture(
        device,
        'phase2 offscreen copy',
        RHITextureUsage.COPY_DST | RHITextureUsage.COPY_SRC
    );
    const readback = createReadback(device, 'phase2 offscreen readback');
    order.push('offscreen.frame.begin');
    const frame = device.graphicsQueue.beginFrame({ label: 'phase2 offscreen frame' });
    order.push('offscreen.pass.begin');
    const pass = frame.beginRenderPass({
        label: 'phase2 offscreen pass',
        colorAttachments: [
            {
                view: source.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ]
    });
    order.push('offscreen.pipeline');
    pass.setPipeline(pipeline);
    order.push('offscreen.draw');
    pass.draw(3);
    order.push('offscreen.pass.end');
    pass.end();
    order.push('offscreen.copy.texture');
    frame.copyTextureToTexture(
        { texture: source },
        { texture: copied },
        { width: WIDTH, height: HEIGHT }
    );
    order.push('offscreen.copy.readback');
    frame.copyTextureToBuffer(
        { texture: copied },
        { buffer: readback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
        { width: WIDTH, height: HEIGHT }
    );
    const drawCount = frame.diagnostics.drawCount;
    order.push('offscreen.frame.end');
    await finishFrame(device, frame);
    return { pixel: await readPixel(readback), drawCount };
}

async function runIndexedTexturedScene(device: RHIDevice, order: string[]) {
    const groupLayout = createSampleLayout(device, '2d');
    const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] });
    const pipeline = createPipeline(device, 'phase2:indexed-textured', 'textured-2d', layout);
    const sampled = device.createTexture({
        label: 'phase2 sampled 2d texture',
        size: { width: 1, height: 1 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
    });
    const sampler = device.createSampler({
        minFilter: 'nearest',
        magFilter: 'nearest',
        mipmapFilter: 'nearest'
    });
    const group = device.createBindGroup({
        layout: groupLayout,
        entries: [
            { binding: 0, resource: sampled.createView() },
            { binding: 1, resource: sampler }
        ]
    });
    const index = device.createBuffer({
        label: 'phase2 index buffer',
        size: 8,
        usage: RHIBufferUsage.INDEX | RHIBufferUsage.COPY_DST
    });
    pipeline.prepareVertexInput({
        vertexBuffers: [],
        indexBuffer: { buffer: index, format: 'uint16', offset: 0 }
    });
    const color = createColorTexture(device, 'phase2 indexed color');
    const readback = createReadback(device, 'phase2 indexed readback');
    order.push('indexed.frame.begin');
    const frame = device.graphicsQueue.beginFrame({ label: 'phase2 indexed frame' });
    order.push('indexed.write.texture');
    frame.writeTexture(
        { texture: sampled },
        new Uint8Array(TEXTURED_BLUE),
        {},
        { width: 1, height: 1 }
    );
    order.push('indexed.write.index');
    frame.writeBuffer(index, 0, new Uint16Array([0, 1, 2, 0]));
    order.push('indexed.pass.begin');
    const pass = frame.beginRenderPass({
        label: 'phase2 indexed pass',
        colorAttachments: [
            {
                view: color.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ]
    });
    order.push('indexed.pipeline');
    pass.setPipeline(pipeline);
    order.push('indexed.bind-group');
    pass.setBindGroup(0, group);
    order.push('indexed.index-buffer');
    pass.setIndexBuffer(index, 'uint16');
    order.push('indexed.draw-indexed');
    pass.drawIndexed(3);
    order.push('indexed.pass.end');
    pass.end();
    order.push('indexed.copy.readback');
    frame.copyTextureToBuffer(
        { texture: color },
        { buffer: readback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
        { width: WIDTH, height: HEIGHT }
    );
    const drawCount = frame.diagnostics.drawCount;
    order.push('indexed.frame.end');
    await finishFrame(device, frame);
    return { pixel: await readPixel(readback), drawCount };
}

async function runMRTScene(device: RHIDevice, order: string[]) {
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    const pipeline = createPipeline(device, 'phase2:mrt', 'mrt', layout);
    const first = createColorTexture(device, 'phase2 mrt first');
    const second = createColorTexture(device, 'phase2 mrt second');
    const firstReadback = createReadback(device, 'phase2 mrt first readback');
    const secondReadback = createReadback(device, 'phase2 mrt second readback');
    order.push('mrt.frame.begin');
    const frame = device.graphicsQueue.beginFrame({ label: 'phase2 mrt frame' });
    order.push('mrt.pass.begin');
    const pass = frame.beginRenderPass({
        label: 'phase2 mrt pass',
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
    order.push('mrt.pipeline');
    pass.setPipeline(pipeline);
    order.push('mrt.draw');
    pass.draw(3);
    order.push('mrt.pass.end');
    pass.end();
    order.push('mrt.copy.first');
    frame.copyTextureToBuffer(
        { texture: first },
        { buffer: firstReadback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
        { width: WIDTH, height: HEIGHT }
    );
    order.push('mrt.copy.second');
    frame.copyTextureToBuffer(
        { texture: second },
        { buffer: secondReadback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
        { width: WIDTH, height: HEIGHT }
    );
    const drawCount = frame.diagnostics.drawCount;
    order.push('mrt.frame.end');
    await finishFrame(device, frame);
    return {
        pixels: [await readPixel(firstReadback), await readPixel(secondReadback)] as const,
        drawCount
    };
}

async function runDepthStencilScene(device: RHIDevice, order: string[]) {
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    const format = 'depth24plus-stencil8' as const;
    const depthSeed = createPipeline(device, 'phase2:depth-seed', 'solid', layout, 1, {
        format,
        depthWriteEnabled: true,
        depthCompare: 'always'
    });
    const depthRejected = createPipeline(device, 'phase2:depth-rejected', 'green', layout, 1, {
        format,
        depthWriteEnabled: false,
        depthCompare: 'less'
    });
    const replaceStencil = {
        compare: 'always' as const,
        failOp: 'keep' as const,
        depthFailOp: 'keep' as const,
        passOp: 'replace' as const
    };
    const rejectStencil = {
        compare: 'equal' as const,
        failOp: 'keep' as const,
        depthFailOp: 'keep' as const,
        passOp: 'keep' as const
    };
    const stencilSeed = createPipeline(device, 'phase2:stencil-seed', 'solid', layout, 1, {
        format,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilFront: replaceStencil,
        stencilBack: replaceStencil,
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff
    });
    const stencilRejected = createPipeline(device, 'phase2:stencil-rejected', 'green', layout, 1, {
        format,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilFront: rejectStencil,
        stencilBack: rejectStencil,
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff
    });
    const depthColor = createColorTexture(device, 'phase2 depth result');
    const stencilColor = createColorTexture(device, 'phase2 stencil result');
    const depthStencil = device.createTexture({
        label: 'phase2 depth/stencil attachment',
        size: { width: WIDTH, height: HEIGHT },
        format,
        usage: RHITextureUsage.RENDER_ATTACHMENT
    });
    const depthReadback = createReadback(device, 'phase2 depth readback');
    const stencilReadback = createReadback(device, 'phase2 stencil readback');

    order.push('depth-stencil.frame.begin');
    const frame = device.graphicsQueue.beginFrame({ label: 'phase2 depth/stencil frame' });
    order.push('depth.pass.begin');
    const depthPass = frame.beginRenderPass({
        label: 'phase2 depth pass',
        colorAttachments: [
            {
                view: depthColor.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ],
        depthStencilAttachment: {
            view: depthStencil.createView(),
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            stencilClearValue: 0,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store'
        }
    });
    order.push('depth.seed');
    depthPass.setPipeline(depthSeed);
    depthPass.draw(3);
    order.push('depth.reject');
    depthPass.setPipeline(depthRejected);
    depthPass.draw(3);
    order.push('depth.pass.end');
    depthPass.end();

    order.push('stencil.pass.begin');
    const stencilPass = frame.beginRenderPass({
        label: 'phase2 stencil pass',
        colorAttachments: [
            {
                view: stencilColor.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ],
        depthStencilAttachment: {
            view: depthStencil.createView(),
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            stencilClearValue: 0,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store'
        }
    });
    order.push('stencil.seed');
    stencilPass.setPipeline(stencilSeed);
    stencilPass.setStencilReference(1);
    stencilPass.draw(3);
    order.push('stencil.reject');
    stencilPass.setPipeline(stencilRejected);
    stencilPass.setStencilReference(2);
    stencilPass.draw(3);
    order.push('stencil.pass.end');
    stencilPass.end();

    order.push('depth-stencil.copy.depth');
    frame.copyTextureToBuffer(
        { texture: depthColor },
        { buffer: depthReadback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
        { width: WIDTH, height: HEIGHT }
    );
    order.push('depth-stencil.copy.stencil');
    frame.copyTextureToBuffer(
        { texture: stencilColor },
        { buffer: stencilReadback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
        { width: WIDTH, height: HEIGHT }
    );
    const drawCount = frame.diagnostics.drawCount;
    order.push('depth-stencil.frame.end');
    await finishFrame(device, frame);
    return {
        pixels: [await readPixel(depthReadback), await readPixel(stencilReadback)] as const,
        drawCount
    };
}

async function runMSAAScene(device: RHIDevice, order: string[]) {
    const sampleCount = device.capabilities
        .getTextureFormatCapabilities('rgba8unorm')
        .sampleCounts.find(count => count > 1);
    if (sampleCount === undefined) {
        order.push('msaa.unsupported');
        return { pixel: null, drawCount: null };
    }
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    const pipeline = createPipeline(device, 'phase2:msaa', 'solid', layout, sampleCount);
    const source = createColorTexture(
        device,
        'phase2 msaa source',
        RHITextureUsage.RENDER_ATTACHMENT,
        sampleCount
    );
    const resolved = createColorTexture(device, 'phase2 msaa resolve');
    const readback = createReadback(device, 'phase2 msaa readback');
    order.push('msaa.frame.begin');
    const frame = device.graphicsQueue.beginFrame({ label: 'phase2 msaa frame' });
    order.push('msaa.pass.begin');
    const pass = frame.beginRenderPass({
        label: 'phase2 msaa pass',
        colorAttachments: [
            {
                view: source.createView(),
                resolveTarget: resolved.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ]
    });
    order.push('msaa.pipeline');
    pass.setPipeline(pipeline);
    order.push('msaa.draw');
    pass.draw(3);
    order.push('msaa.pass.end');
    pass.end();
    order.push('msaa.copy.readback');
    frame.copyTextureToBuffer(
        { texture: resolved },
        { buffer: readback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
        { width: WIDTH, height: HEIGHT }
    );
    const drawCount = frame.diagnostics.drawCount;
    order.push('msaa.frame.end');
    await finishFrame(device, frame);
    return { pixel: await readPixel(readback), drawCount };
}

async function runCubeScene(device: RHIDevice, order: string[]) {
    const groupLayout = createSampleLayout(device, 'cube');
    const layout = device.createPipelineLayout({ bindGroupLayouts: [groupLayout] });
    const pipeline = createPipeline(device, 'phase2:cube', 'cube', layout);
    const cube = device.createTexture({
        label: 'phase2 cube',
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
    const sampledColor = createColorTexture(device, 'phase2 cube sampled color');
    const sampledReadback = createReadback(device, 'phase2 cube sampled readback');
    const mipReadback = createReadback(device, 'phase2 cube mip readback', 2);
    const positiveX = new Uint8Array(4 * 4 * 4);
    for (let offset = 0; offset < positiveX.length; offset += 4) {
        positiveX.set(CUBE_ORANGE, offset);
    }
    order.push('cube.frame.begin');
    const frame = device.graphicsQueue.beginFrame({ label: 'phase2 cube frame' });
    order.push('cube.write.face');
    frame.writeTexture(
        { texture: cube, origin: { z: 0 } },
        positiveX,
        { bytesPerRow: 16 },
        { width: 4, height: 4 }
    );
    order.push('cube.sample-pass.begin');
    const samplePass = frame.beginRenderPass({
        label: 'phase2 cube sample pass',
        colorAttachments: [
            {
                view: sampledColor.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ]
    });
    order.push('cube.pipeline');
    samplePass.setPipeline(pipeline);
    order.push('cube.bind-group');
    samplePass.setBindGroup(0, group);
    order.push('cube.draw');
    samplePass.draw(3);
    order.push('cube.sample-pass.end');
    samplePass.end();
    const mipFace = cube.createView({
        dimension: '2d',
        baseMipLevel: 1,
        mipLevelCount: 1,
        baseArrayLayer: 4,
        arrayLayerCount: 1
    });
    order.push('cube.mip-pass.begin');
    const mipPass = frame.beginRenderPass({
        label: 'phase2 cube mip pass',
        colorAttachments: [
            {
                view: mipFace,
                clearValue: { r: 0, g: 1, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ]
    });
    order.push('cube.mip-pass.end');
    mipPass.end();
    order.push('cube.copy.sample');
    frame.copyTextureToBuffer(
        { texture: sampledColor },
        { buffer: sampledReadback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: HEIGHT },
        { width: WIDTH, height: HEIGHT }
    );
    order.push('cube.copy.mip');
    frame.copyTextureToBuffer(
        { texture: cube, mipLevel: 1, origin: { z: 4 } },
        { buffer: mipReadback, bytesPerRow: BYTES_PER_ROW, rowsPerImage: 2 },
        { width: 2, height: 2 }
    );
    const drawCount = frame.diagnostics.drawCount;
    order.push('cube.frame.end');
    await finishFrame(device, frame);
    return {
        samplePixel: await readPixel(sampledReadback),
        mipPixel: await readPixel(mipReadback, 2, 2),
        drawCount
    };
}

async function runSurfaceScene(device: RHIDevice, canvas: HTMLCanvasElement, order: string[]) {
    const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
    const pipeline = createPipeline(device, 'phase2:surface', 'solid', layout);
    const surface = device.createSurface(canvas);
    order.push('surface.configure');
    surface.configure({ format: 'rgba8unorm', width: WIDTH, height: HEIGHT });
    const configuredState = surface.state;
    order.push('surface.acquire');
    const texture = surface.getCurrentTexture();
    const acquiredState = surface.state;
    order.push('surface.frame.begin');
    const frame = device.graphicsQueue.beginFrame({ label: 'phase2 surface frame' });
    order.push('surface.pass.begin');
    const pass = frame.beginRenderPass({
        label: 'phase2 surface pass',
        colorAttachments: [
            {
                view: texture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ]
    });
    order.push('surface.pipeline');
    pass.setPipeline(pipeline);
    order.push('surface.draw');
    pass.draw(3);
    order.push('surface.pass.end');
    pass.end();
    const drawCount = frame.diagnostics.drawCount;
    order.push('surface.frame.end');
    await finishFrame(device, frame);
    order.push('surface.present');
    surface.present();
    return {
        configuredState,
        acquiredState,
        presentedState: surface.state,
        textureDestroyedAfterPresent: texture.destroyed,
        drawCount
    };
}

/** Execute one backend-neutral Phase 2 graphics scene matrix against a concrete RHI device. */
export async function runRHIPhase2Conformance(
    harness: RHIPhase2ConformanceHarness
): Promise<RHIPhase2ConformanceResult> {
    const { device, canvas } = harness;
    const order: string[] = [];
    const offscreen = await runOffscreenScene(device, order);
    const indexedTextured = await runIndexedTexturedScene(device, order);
    const mrt = await runMRTScene(device, order);
    const depthStencil = await runDepthStencilScene(device, order);
    const msaa = await runMSAAScene(device, order);
    const cube = await runCubeScene(device, order);
    const surface = await runSurfaceScene(device, canvas, order);
    return Object.freeze({
        backend: device.backend,
        offscreenPixel: offscreen.pixel,
        indexedTexturedPixel: indexedTextured.pixel,
        mrtPixels: mrt.pixels,
        depthStencilPixels: depthStencil.pixels,
        msaaPixel: msaa.pixel,
        cubeSamplePixel: cube.samplePixel,
        cubeMipPixel: cube.mipPixel,
        drawCounts: Object.freeze({
            offscreen: offscreen.drawCount,
            indexedTextured: indexedTextured.drawCount,
            mrt: mrt.drawCount,
            depthStencil: depthStencil.drawCount,
            msaa: msaa.drawCount,
            cube: cube.drawCount,
            surface: surface.drawCount
        }),
        surface: Object.freeze({
            configuredState: surface.configuredState,
            acquiredState: surface.acquiredState,
            presentedState: surface.presentedState,
            textureDestroyedAfterPresent: surface.textureDestroyedAfterPresent
        }),
        order: Object.freeze(order)
    });
}

function expectedOrder(msaaSupported: boolean): readonly string[] {
    return Object.freeze([
        'offscreen.frame.begin',
        'offscreen.pass.begin',
        'offscreen.pipeline',
        'offscreen.draw',
        'offscreen.pass.end',
        'offscreen.copy.texture',
        'offscreen.copy.readback',
        'offscreen.frame.end',
        'indexed.frame.begin',
        'indexed.write.texture',
        'indexed.write.index',
        'indexed.pass.begin',
        'indexed.pipeline',
        'indexed.bind-group',
        'indexed.index-buffer',
        'indexed.draw-indexed',
        'indexed.pass.end',
        'indexed.copy.readback',
        'indexed.frame.end',
        'mrt.frame.begin',
        'mrt.pass.begin',
        'mrt.pipeline',
        'mrt.draw',
        'mrt.pass.end',
        'mrt.copy.first',
        'mrt.copy.second',
        'mrt.frame.end',
        'depth-stencil.frame.begin',
        'depth.pass.begin',
        'depth.seed',
        'depth.reject',
        'depth.pass.end',
        'stencil.pass.begin',
        'stencil.seed',
        'stencil.reject',
        'stencil.pass.end',
        'depth-stencil.copy.depth',
        'depth-stencil.copy.stencil',
        'depth-stencil.frame.end',
        ...(msaaSupported
            ? [
                  'msaa.frame.begin',
                  'msaa.pass.begin',
                  'msaa.pipeline',
                  'msaa.draw',
                  'msaa.pass.end',
                  'msaa.copy.readback',
                  'msaa.frame.end'
              ]
            : ['msaa.unsupported']),
        'cube.frame.begin',
        'cube.write.face',
        'cube.sample-pass.begin',
        'cube.pipeline',
        'cube.bind-group',
        'cube.draw',
        'cube.sample-pass.end',
        'cube.mip-pass.begin',
        'cube.mip-pass.end',
        'cube.copy.sample',
        'cube.copy.mip',
        'cube.frame.end',
        'surface.configure',
        'surface.acquire',
        'surface.frame.begin',
        'surface.pass.begin',
        'surface.pipeline',
        'surface.draw',
        'surface.pass.end',
        'surface.frame.end',
        'surface.present'
    ]);
}

/** The same result assertions are applied to WebGL2, native WebGPU, and structured WebGPU mock. */
export function expectRHIPhase2Conformance(result: RHIPhase2ConformanceResult): void {
    expect(result.offscreenPixel).toEqual(RED);
    expect(result.indexedTexturedPixel).toEqual(TEXTURED_BLUE);
    expect(result.mrtPixels).toEqual([RED, GREEN]);
    expect(result.depthStencilPixels).toEqual([RED, RED]);
    if (result.msaaPixel === null) {
        expect(result.drawCounts.msaa).toBeNull();
    } else {
        expect(result.msaaPixel).toEqual(RED);
        expect(result.drawCounts.msaa).toBe(1);
    }
    expect(result.cubeSamplePixel).toEqual(CUBE_ORANGE);
    expect(result.cubeMipPixel).toEqual(GREEN);
    expect(result.drawCounts).toMatchObject({
        offscreen: 1,
        indexedTextured: 1,
        mrt: 1,
        depthStencil: 4,
        cube: 1,
        surface: 1
    });
    expect(result.surface).toEqual({
        configuredState: 'configured',
        acquiredState: 'acquired',
        presentedState: 'configured',
        textureDestroyedAfterPresent: true
    });
    expect(result.order).toEqual(expectedOrder(result.msaaPixel !== null));
}
