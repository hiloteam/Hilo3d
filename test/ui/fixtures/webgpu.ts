import {
    AmbientLight,
    BasicMaterial,
    BoxGeometry,
    Color,
    constants,
    DirectionalLight,
    Geometry,
    GeometryData,
    Mesh,
    NagaShaderTranslator,
    PBRMaterial,
    PerspectiveCamera,
    PointLight,
    ShaderMaterial,
    SpotLight,
    Stage,
    Texture,
    Vector3,
    WebGPUTextureManager
} from '../../../src/Hilo3d';
import WebGPUBindGroupManager from '../../../src/renderer/webgpu/WebGPUBindGroupManager';
import { specializeWebGPUDepthSamplers } from '../../../src/renderer/webgpu/shader/GlslToWgsl';
import {
    WebGPUBufferUsage,
    WebGPUMapMode,
    WebGPUTextureUsage
} from '../../../src/renderer/webgpu/WebGPUConstants';

interface ExtendedTextureSamplingResult {
    readonly samplerTypes: readonly string[];
    readonly textureDimensions: readonly string[];
    readonly readback: readonly number[];
    readonly compilationErrors: readonly string[];
    readonly validationError: string | null;
    readonly submissionCompleted: boolean;
}

interface OffscreenStencilResult {
    readonly readback: readonly number[];
    readonly stableAcrossFrames: boolean;
}

async function validateOffscreenStencil(): Promise<OffscreenStencilResult> {
    const canvas = document.createElement('canvas');
    const camera = new PerspectiveCamera({ near: 0.1, far: 10 });
    const validationStage = await Stage.create({
        backend: 'webgpu',
        canvas,
        camera,
        width: 4,
        height: 4,
        pixelRatio: 1,
        antialias: false,
        stencil: false
    });
    const target = validationStage.renderer.createRenderTarget({
        width: 4,
        height: 4,
        colorAttachments: [{ clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: {
            format: 'depth24plus-stencil8',
            stencilClearValue: 0
        }
    });
    const geometry = (): Geometry =>
        new Geometry({
            mode: constants.TRIANGLE_STRIP,
            vertices: new GeometryData(new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), 2)
        });
    const material = (
        name: string,
        color: readonly [number, number, number, number],
        renderOrder: number
    ): ShaderMaterial =>
        new ShaderMaterial({
            shaderName: name,
            shaderCacheId: name,
            needBasicAttributes: false,
            needBasicUniforms: false,
            depthTest: false,
            depthMask: false,
            cullFace: false,
            blend: false,
            renderOrder,
            attributes: { a_position: 'POSITION' },
            vs: `#version 300 es
                in vec2 a_position;
                void main(void) { gl_Position = vec4(a_position, 0.0, 1.0); }
            `,
            fs: `#version 300 es
                precision highp float;
                layout(location = 0) out vec4 fragmentColor;
                void main(void) { fragmentColor = vec4(${color.join(', ')}); }
            `
        });
    const stencilWrite = material('WebGPUOffscreenStencilWrite', [1, 0, 0, 1], 0);
    stencilWrite.stencilTest = true;
    stencilWrite.stencilFunc = constants.ALWAYS;
    stencilWrite.stencilFuncRef = 1;
    stencilWrite.stencilFuncMask = 0xff;
    stencilWrite.stencilMask = 0xff;
    stencilWrite.stencilOpFail = constants.KEEP;
    stencilWrite.stencilOpZFail = constants.KEEP;
    stencilWrite.stencilOpZPass = constants.REPLACE;
    const stencilReject = material('WebGPUOffscreenStencilReject', [0, 1, 0, 1], 1);
    stencilReject.stencilTest = true;
    stencilReject.stencilFunc = constants.EQUAL;
    stencilReject.stencilFuncRef = 2;
    stencilReject.stencilFuncMask = 0xff;
    stencilReject.stencilMask = 0;
    stencilReject.stencilOpFail = constants.KEEP;
    stencilReject.stencilOpZFail = constants.KEEP;
    stencilReject.stencilOpZPass = constants.KEEP;
    validationStage.addChild(
        new Mesh({ geometry: geometry(), material: stencilWrite, frustumTest: false })
    );
    validationStage.addChild(
        new Mesh({ geometry: geometry(), material: stencilReject, frustumTest: false })
    );

    const device = validationStage.renderer.gpuDevice;
    device.pushErrorScope('validation');
    try {
        validationStage.renderer.renderToTarget(target, validationStage, camera);
        const first = await target.readColorAttachment({ x: 2, y: 2, width: 1, height: 1 });
        validationStage.renderer.renderToTarget(target, validationStage, camera);
        const second = await target.readColorAttachment({ x: 2, y: 2, width: 1, height: 1 });
        const validationError = await device.popErrorScope();
        if (validationError) {
            throw new Error(`Offscreen stencil validation failed: ${validationError.message}`);
        }
        return {
            readback: Array.from(first.data),
            stableAcrossFrames: second.data.every((value, index) => value === first.data[index])
        };
    } catch (error) {
        await device.popErrorScope().catch(() => null);
        throw error;
    } finally {
        target.destroy();
        validationStage.destroy();
    }
}

async function validateExtendedTextureSampling(
    device: GPUDevice
): Promise<ExtendedTextureSamplingResult> {
    const translator = new NagaShaderTranslator();
    await translator.initialize();
    const textureManager = new WebGPUTextureManager(device, translator);
    const bindGroupManager = new WebGPUBindGroupManager(device, textureManager);
    const managedTextures: Texture<unknown>[] = [];
    let outputTexture: GPUTexture | null = null;
    let readbackBuffer: GPUBuffer | null = null;
    let depthTexture: GPUTexture | null = null;
    let numericDepthTexture: GPUTexture | null = null;
    let materialBuffer: GPUBuffer | null = null;
    let result: ExtendedTextureSamplingResult | null = null;
    let executionError: unknown;

    device.pushErrorScope('validation');
    try {
        let translated = translator.translate(
            `#version 300 es
void main() {
    vec2 position = vec2(-1.0, -1.0);
    if (gl_VertexID == 1) position = vec2(3.0, -1.0);
    if (gl_VertexID == 2) position = vec2(-1.0, 3.0);
    gl_Position = vec4(position, 0.0, 1.0);
}`,
            `#version 300 es
precision highp float;
precision highp int;
uniform sampler3D volumeTexture;
uniform sampler2DArray arrayTexture;
uniform sampler2DArrayShadow arrayShadow;
uniform highp usampler2DArray integerTexture;
uniform sampler2D dynamicMaps[2];
uniform sampler2D numericDepth;
layout(std140) uniform MaterialBlock {
    int dynamicMapIndex;
};
layout(location = 0) out vec4 color;
void main() {
    vec4 volumeValue = texelFetch(volumeTexture, ivec3(0, 0, 1), 0);
    vec4 arrayValue = texelFetch(arrayTexture, ivec3(0, 0, 1), 0);
    float shadowValue = texture(arrayShadow, vec4(0.5, 0.5, 1.0, 0.5));
    uvec4 integerValue = texelFetch(integerTexture, ivec3(0, 0, 1), 0);
    vec4 dynamicValue = texture(dynamicMaps[dynamicMapIndex], vec2(0.5));
    vec4 dynamicLodValue = textureLod(dynamicMaps[dynamicMapIndex], vec2(0.5), 0.0);
    float numericDepthValue = texture(numericDepth, vec2(0.5)).r;
    color = vec4(
        (volumeValue.r + dynamicValue.r + dynamicLodValue.r) / 3.0,
        (arrayValue.g + numericDepthValue) * 0.5,
        float(integerValue.b) / 255.0,
        shadowValue
    );
}`
        );

        const volumeTexture = new Texture<Uint8Array>({
            name: 'WebGPU UI managed 3D texture',
            target: constants.TEXTURE_3D,
            internalFormat: constants.RGBA8,
            format: constants.RGBA,
            type: constants.UNSIGNED_BYTE,
            width: 1,
            height: 1,
            depth: 2,
            image: new Uint8Array([16, 0, 0, 255, 64, 0, 0, 255]),
            magFilter: constants.NEAREST,
            minFilter: constants.NEAREST,
            wrapS: constants.CLAMP_TO_EDGE,
            wrapT: constants.CLAMP_TO_EDGE,
            wrapR: constants.CLAMP_TO_EDGE
        });
        const arrayTexture = new Texture<Uint8Array>({
            name: 'WebGPU UI managed 2D-array texture',
            target: constants.TEXTURE_2D_ARRAY,
            internalFormat: constants.RGBA8,
            format: constants.RGBA,
            type: constants.UNSIGNED_BYTE,
            width: 1,
            height: 1,
            depth: 2,
            image: new Uint8Array([0, 32, 0, 255, 0, 128, 0, 255]),
            magFilter: constants.NEAREST,
            minFilter: constants.NEAREST,
            wrapS: constants.CLAMP_TO_EDGE,
            wrapT: constants.CLAMP_TO_EDGE,
            wrapR: constants.CLAMP_TO_EDGE
        });
        const integerTexture = new Texture<Uint8Array>({
            name: 'WebGPU UI managed integer array texture',
            target: constants.TEXTURE_2D_ARRAY,
            internalFormat: constants.RGBA8UI,
            format: constants.RGBA_INTEGER,
            type: constants.UNSIGNED_BYTE,
            width: 1,
            height: 1,
            depth: 2,
            image: new Uint8Array([0, 0, 40, 1, 0, 0, 200, 1]),
            magFilter: constants.NEAREST,
            minFilter: constants.NEAREST,
            wrapS: constants.CLAMP_TO_EDGE,
            wrapT: constants.CLAMP_TO_EDGE,
            wrapR: constants.CLAMP_TO_EDGE,
            anisotropic: 1
        });
        const dynamicMaps = [16, 64].map(
            (red, index) =>
                new Texture<Uint8Array>({
                    name: `WebGPU UI dynamic sampler texture ${String(index)}`,
                    width: 1,
                    height: 1,
                    image: new Uint8Array([red, 0, 0, 255]),
                    magFilter: constants.NEAREST,
                    minFilter: constants.NEAREST,
                    wrapS: constants.CLAMP_TO_EDGE,
                    wrapT: constants.CLAMP_TO_EDGE
                })
        );
        managedTextures.push(volumeTexture, arrayTexture, integerTexture, ...dynamicMaps);

        const arrayShadow = new Texture({
            name: 'WebGPU UI depth array texture',
            target: constants.TEXTURE_2D_ARRAY,
            internalFormat: constants.DEPTH_COMPONENT32F,
            format: constants.DEPTH_COMPONENT,
            type: constants.FLOAT,
            width: 1,
            height: 1,
            depth: 2,
            image: null,
            magFilter: constants.NEAREST,
            minFilter: constants.NEAREST,
            wrapS: constants.CLAMP_TO_EDGE,
            wrapT: constants.CLAMP_TO_EDGE,
            wrapR: constants.CLAMP_TO_EDGE
        });
        const numericDepth = new Texture({
            name: 'WebGPU UI numeric depth texture',
            internalFormat: constants.DEPTH_COMPONENT32F,
            format: constants.DEPTH_COMPONENT,
            type: constants.FLOAT,
            width: 1,
            height: 1,
            image: null,
            magFilter: constants.NEAREST,
            minFilter: constants.NEAREST,
            wrapS: constants.CLAMP_TO_EDGE,
            wrapT: constants.CLAMP_TO_EDGE
        });
        depthTexture = device.createTexture({
            label: 'WebGPU UI native depth-array texture',
            size: { width: 1, height: 1, depthOrArrayLayers: 2 },
            format: 'depth32float',
            usage: WebGPUTextureUsage.TEXTURE_BINDING | WebGPUTextureUsage.RENDER_ATTACHMENT
        });
        const depthEncoder = device.createCommandEncoder({
            label: 'WebGPU UI depth-array initialization'
        });
        for (const [layer, depthClearValue] of [0.25, 0.75].entries()) {
            const pass = depthEncoder.beginRenderPass({
                colorAttachments: [],
                depthStencilAttachment: {
                    view: depthTexture.createView({
                        dimension: '2d',
                        baseArrayLayer: layer,
                        arrayLayerCount: 1
                    }),
                    depthClearValue,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store'
                }
            });
            pass.end();
        }
        numericDepthTexture = device.createTexture({
            label: 'WebGPU UI native numeric depth texture',
            size: { width: 1, height: 1 },
            format: 'depth32float',
            usage: WebGPUTextureUsage.TEXTURE_BINDING | WebGPUTextureUsage.RENDER_ATTACHMENT
        });
        const numericDepthPass = depthEncoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
                view: numericDepthTexture.createView(),
                depthClearValue: 0.5,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            }
        });
        numericDepthPass.end();
        device.queue.submit([depthEncoder.finish()]);
        textureManager.registerExternal(arrayShadow, depthTexture, {
            compare: 'less-equal',
            takeOwnership: true
        });
        depthTexture = null;
        textureManager.registerExternal(numericDepth, numericDepthTexture, {
            takeOwnership: true
        });
        numericDepthTexture = null;

        const textures = new Map<string, Texture<unknown>>([
            ['volumeTexture', volumeTexture],
            ['arrayTexture', arrayTexture],
            ['arrayShadow', arrayShadow],
            ['integerTexture', integerTexture],
            ['numericDepth', numericDepth]
        ]);
        const samplers = translated.samplers.map(binding => {
            const texture =
                binding.name === 'dynamicMaps'
                    ? dynamicMaps[binding.arrayIndex]
                    : textures.get(binding.name);
            if (!texture) throw new Error(`Missing texture for translated sampler ${binding.name}`);
            return bindGroupManager.resolveSampler(binding, texture);
        });
        translated = specializeWebGPUDepthSamplers(
            translated,
            samplers
                .filter(sampler => sampler.texture === numericDepth)
                .map(sampler => sampler.binding)
        );
        materialBuffer = device.createBuffer({
            label: 'WebGPU UI dynamic sampler material block',
            size: 16,
            usage: WebGPUBufferUsage.UNIFORM | WebGPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(materialBuffer, 0, new Int32Array([1]));
        const bindingLayout = bindGroupManager.getLayout(translated, samplers);
        const bindGroups = bindGroupManager.getBindGroups(
            bindingLayout,
            translated,
            { MaterialBlock: { buffer: materialBuffer, offset: 0, size: 16 } },
            samplers
        );
        const vertexModule = device.createShaderModule({
            label: 'WebGPU UI extended-sampler vertex shader',
            code: translated.vertex.wgsl
        });
        const fragmentModule = device.createShaderModule({
            label: 'WebGPU UI extended-sampler fragment shader',
            code: translated.fragment.wgsl
        });
        const compilationInfo = await Promise.all([
            vertexModule.getCompilationInfo(),
            fragmentModule.getCompilationInfo()
        ]);
        const compilationErrors = compilationInfo.flatMap(info =>
            [...info.messages]
                .filter(message => message.type === 'error')
                .map(message => message.message)
        );
        if (compilationErrors.length > 0) {
            throw new Error(
                `Extended-sampler shader compilation failed: ${compilationErrors.join('; ')}`
            );
        }
        const pipeline = await device.createRenderPipelineAsync({
            label: 'WebGPU UI extended-sampler pipeline',
            layout: bindingLayout.pipelineLayout,
            vertex: { module: vertexModule, entryPoint: 'main' },
            fragment: {
                module: fragmentModule,
                entryPoint: 'main',
                targets: [{ format: 'rgba8unorm' }]
            },
            primitive: { topology: 'triangle-list' }
        });

        outputTexture = device.createTexture({
            label: 'WebGPU UI extended-sampler readback target',
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: WebGPUTextureUsage.RENDER_ATTACHMENT | WebGPUTextureUsage.COPY_SRC
        });
        readbackBuffer = device.createBuffer({
            label: 'WebGPU UI extended-sampler readback buffer',
            size: 256,
            usage: WebGPUBufferUsage.COPY_DST | WebGPUBufferUsage.MAP_READ
        });
        const encoder = device.createCommandEncoder({
            label: 'WebGPU UI extended-sampler submission'
        });
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: outputTexture.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        bindGroups.forEach((bindGroup, group) => {
            pass.setBindGroup(group, bindGroup);
        });
        pass.draw(3);
        pass.end();
        encoder.copyTextureToBuffer(
            { texture: outputTexture },
            { buffer: readbackBuffer, bytesPerRow: 256, rowsPerImage: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 1 }
        );
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        await readbackBuffer.mapAsync(WebGPUMapMode.READ, 0, 256);
        const readback = Array.from(new Uint8Array(readbackBuffer.getMappedRange(0, 4)));
        readbackBuffer.unmap();
        result = {
            samplerTypes: translated.samplers.map(binding => binding.type),
            textureDimensions: samplers.map(sampler => sampler.resource.dimension),
            readback,
            compilationErrors,
            validationError: null,
            submissionCompleted: true
        };
    } catch (error: unknown) {
        executionError = error;
    }

    const validationError = await device.popErrorScope();
    bindGroupManager.clear();
    textureManager.destroyAll();
    depthTexture?.destroy();
    numericDepthTexture?.destroy();
    materialBuffer?.destroy();
    outputTexture?.destroy();
    readbackBuffer?.destroy();
    managedTextures.forEach(texture => texture.destroy());
    if (executionError !== undefined) {
        throw executionError instanceof Error
            ? executionError
            : new Error('Extended WebGPU texture validation failed', { cause: executionError });
    }
    if (validationError) {
        throw new Error(`Extended WebGPU texture validation failed: ${validationError.message}`);
    }
    if (!result) throw new Error('Extended WebGPU texture validation produced no result');
    return result;
}

const container = document.querySelector<HTMLElement>('#stage');
if (!container) throw new Error('WebGPU fixture container is missing');

const camera = new PerspectiveCamera({ aspect: 4 / 3, near: 0.1, far: 100, z: 4 });
const stage = await Stage.create({
    backend: 'webgpu',
    container,
    camera,
    width: 640,
    height: 480,
    pixelRatio: 1,
    antialias: true,
    stencil: true,
    useInstanced: true,
    clearColor: new Color(0.04, 0.06, 0.1)
});
let renderTarget = stage.renderer.createRenderTarget({
    width: 640,
    height: 480,
    sampleCount: 4,
    colorAttachments: [
        {
            clearValue: { r: 0.04, g: 0.06, b: 0.1, a: 1 }
        }
    ],
    depthStencilAttachment: { format: 'depth24plus-stencil8' }
});
stage.renderer.setRenderTarget(renderTarget, { present: true, takeOwnership: true });
const gpuErrors: string[] = [];
stage.renderer.on('webgpuUncapturedError', event => {
    const detail = event.detail;
    gpuErrors.push(
        typeof detail === 'object' && detail !== null && 'message' in detail
            ? String(detail.message)
            : String(detail)
    );
});
const sharedGeometry = new BoxGeometry();
const diffuseTexture = new Texture({
    image: new Uint8Array([
        255, 48, 32, 255, 32, 180, 255, 255, 24, 255, 96, 255, 255, 220, 32, 255
    ]),
    width: 2,
    height: 2,
    minFilter: constants.LINEAR_MIPMAP_LINEAR,
    wrapS: constants.CLAMP_TO_EDGE,
    wrapT: constants.CLAMP_TO_EDGE,
    flipY: true,
    isImageCanRelease: true
});
const initialTextureRevision = diffuseTexture.updateRevision;
const sharedMaterial = new BasicMaterial({
    diffuse: new Color(0.12, 0.68, 0.94),
    lightType: 'LAMBERT'
});
stage.addChild(
    new Mesh({
        geometry: sharedGeometry,
        material: sharedMaterial,
        useInstanced: true,
        x: -0.5,
        rotationX: 22,
        rotationY: 35
    })
);

const stripIndices = new GeometryData(new Uint8Array([0, 1, 2, 255, 3, 4, 5]), 1);
stage.addChild(
    new Mesh({
        geometry: new Geometry({
            mode: constants.LINE_STRIP,
            vertices: new GeometryData(
                new Float32Array([
                    -1.5, 1.1, 0, -1, 1.45, 0, -0.5, 1.1, 0, 0.5, 1.1, 0, 1, 1.45, 0, 1.5, 1.1, 0
                ]),
                3
            ),
            indices: stripIndices,
            isStatic: false
        }),
        material: new BasicMaterial({
            diffuse: new Color(0.95, 0.85, 0.2),
            lightType: 'NONE'
        })
    })
);
stage.addChild(
    new Mesh({
        geometry: sharedGeometry,
        material: sharedMaterial,
        useInstanced: true,
        x: -1.45,
        y: -0.2,
        rotationX: -12,
        rotationY: -25,
        scaleX: 0.55,
        scaleY: 0.55,
        scaleZ: 0.55
    })
);
stage.addChild(
    new Mesh({
        geometry: sharedGeometry,
        material: sharedMaterial,
        useInstanced: true,
        x: 0.35,
        y: -0.45,
        rotationX: 35,
        rotationY: 10,
        scaleX: 0.4,
        scaleY: 0.4,
        scaleZ: 0.4
    })
);
stage.addChild(
    new Mesh({
        geometry: new BoxGeometry().setAllRectUV([
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0]
        ]),
        material: new PBRMaterial({
            baseColor: new Color(0.94, 0.34, 0.18),
            metallic: 0.35,
            roughness: 0.45
        }),
        x: 1.35,
        rotationX: -18,
        rotationY: 20,
        scaleX: 0.65,
        scaleY: 0.65,
        scaleZ: 0.65
    })
);
stage.addChild(
    new Mesh({
        geometry: new BoxGeometry().setAllRectUV([
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0]
        ]),
        material: new BasicMaterial({
            diffuse: diffuseTexture,
            lightType: 'NONE'
        }),
        y: 1.15,
        z: 0.25,
        scaleX: 0.3,
        scaleY: 0.3,
        scaleZ: 0.3
    })
);
stage.addChild(
    new DirectionalLight({
        amount: 1.2,
        direction: new Vector3(-1, -1, -1),
        shadow: { width: 256, height: 256 }
    })
);
stage.addChild(new AmbientLight({ amount: 0.2 }));
stage.addChild(
    new SpotLight({
        x: 2,
        y: 2,
        z: 2,
        direction: new Vector3(-2, -2, -2),
        cutoff: 22,
        outerCutoff: 28,
        range: 12,
        amount: 4,
        shadow: { width: 128, height: 128 }
    })
);
stage.addChild(
    new PointLight({
        x: -1.5,
        y: 1.5,
        z: 2,
        range: 10,
        amount: 3,
        shadow: { width: 128, height: 128 }
    })
);

stage.tick(0);
stripIndices.setSubData(0, new Uint8Array([0, 2, 1]));
diffuseTexture.image = new Uint8Array([
    32, 96, 255, 255, 255, 72, 40, 255, 240, 220, 48, 255, 48, 255, 140, 255
]);
stage.tick(0);
await stage.renderer.gpuDevice.queue.onSubmittedWorkDone();
const readback = await renderTarget.readColorAttachment({ x: 320, y: 240, width: 1, height: 1 });
stage.renderer.clearColor.set(0.12, 0.24, 0.36, 1);
renderTarget = stage.renderer.createRenderTarget({
    width: 640,
    height: 480,
    sampleCount: 4,
    colorAttachments: [
        {
            clearValue: { r: 0.12, g: 0.24, b: 0.36, a: 1 }
        }
    ],
    depthStencilAttachment: { format: 'depth24plus-stencil8' }
});
stage.renderer.setRenderTarget(renderTarget, { present: true, takeOwnership: true });
stage.tick(0);
const clearColorReadback = await renderTarget.readColorAttachment({
    x: 0,
    y: 0,
    width: 1,
    height: 1
});
const mrtTarget = stage.renderer.createRenderTarget({
    width: 8,
    height: 8,
    sampleCount: 4,
    colorAttachments: [
        { clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 } },
        { clearValue: { r: 0.8, g: 0.1, b: 0.2, a: 1 } }
    ],
    depthStencilAttachment: {
        format: 'depth24plus-stencil8',
        stencilClearValue: 7
    }
});
const mrtEncoder = stage.renderer.gpuDevice.createCommandEncoder({
    label: 'Hilo3d WebGPU UI MRT validation'
});
const mrtPass = mrtEncoder.beginRenderPass(mrtTarget.createRenderPassDescriptor());
mrtPass.end();
stage.renderer.gpuDevice.queue.submit([mrtEncoder.finish()]);
const mrtReadbacks = await Promise.all([
    mrtTarget.readColorAttachment({ attachmentIndex: 0, width: 1, height: 1 }),
    mrtTarget.readColorAttachment({ attachmentIndex: 1, width: 1, height: 1 })
]);
mrtTarget.resize(4, 4);
mrtTarget.destroy();
const recoveryProbeBefore = await renderTarget.readColorAttachment({
    x: 320,
    y: 72,
    width: 1,
    height: 1
});
const recoveryTextureImageReleasedBefore = diffuseTexture.isImageReleased;
const deviceBeforeRecovery = stage.renderer.gpuDevice;
let deviceLostEvents = 0;
let deviceRestoredEvents = 0;
let restoredDeviceMatches = false;
const deviceLost = new Promise<void>(resolve => {
    stage.renderer.on(
        'webgpuDeviceLost',
        () => {
            deviceLostEvents++;
            resolve();
        },
        true
    );
});
const deviceRestored = new Promise<void>(resolve => {
    stage.renderer.on(
        'webgpuDeviceRestored',
        event => {
            deviceRestoredEvents++;
            restoredDeviceMatches = event.detail === stage.renderer.gpuDevice;
            resolve();
        },
        true
    );
});
deviceBeforeRecovery.destroy();
await deviceLost;
const recovery = stage.renderer.recoveryPromise;
if (!recovery) throw new Error('WebGPU recovery did not publish a recoveryPromise');
await recovery;
await deviceRestored;
const recoveryTargetIdentityPreserved = stage.renderer.renderTarget === renderTarget;
stage.tick(0);
await stage.renderer.gpuDevice.queue.onSubmittedWorkDone();
const recoveryReadback = await renderTarget.readColorAttachment({
    x: 320,
    y: 72,
    width: 1,
    height: 1
});
const extendedTextureSampling = await validateExtendedTextureSampling(stage.renderer.gpuDevice);
const offscreenStencil = await validateOffscreenStencil();
await new Promise(resolve => setTimeout(resolve, 0));
window.__HILO3D_WEBGPU_RESULT__ = {
    backend: stage.renderer.backend,
    drawCount: stage.renderer.renderInfo.drawCount,
    faceCount: stage.renderer.renderInfo.faceCount,
    hasShadowAtlas: stage.renderer.lightManager.shadowAtlas !== null,
    shadowLightKinds: {
        directional: stage.renderer.lightManager.directionalLights.length,
        spot: stage.renderer.lightManager.spotLights.length,
        point: stage.renderer.lightManager.pointLights.length
    },
    renderTargetAttachments: renderTarget.colorAttachmentCount,
    renderTargetSampleCount: renderTarget.sampleCount,
    renderTargetHasStencil: renderTarget.depthStencilFormat === 'depth24plus-stencil8',
    readbackByteLength: readback.data.byteLength,
    readbackHasContent: readback.data.some(value => value !== 0),
    clearColorReadback: Array.from(clearColorReadback.data),
    mrtAttachments: mrtReadbacks.length,
    mrtReadbacksHaveContent: mrtReadbacks.every(result => result.data.some(value => value !== 0)),
    textureRevisionAdvanced: diffuseTexture.updateRevision > initialTextureRevision,
    recoveryState: stage.renderer.recoveryState,
    recoveryDeviceChanged:
        stage.renderer.gpuDevice !== deviceBeforeRecovery && restoredDeviceMatches,
    recoveryTargetIdentityPreserved,
    recoveryTextureImageReleasedBefore,
    recoveryTextureImageReleasedAfter: diffuseTexture.isImageReleased,
    recoveryReadbackHasContent: recoveryReadback.data.some(value => value !== 0),
    recoveryProbeHasSceneContent: recoveryProbeBefore.data.some(
        (value, index) => value !== clearColorReadback.data[index]
    ),
    recoveryReadbackMatches: recoveryReadback.data.every(
        (value, index) => value === recoveryProbeBefore.data[index]
    ),
    deviceLostEvents,
    deviceRestoredEvents,
    extendedSamplerTypes: extendedTextureSampling.samplerTypes,
    extendedTextureDimensions: extendedTextureSampling.textureDimensions,
    extendedSamplerReadback: extendedTextureSampling.readback,
    extendedSamplerCompilationErrors: extendedTextureSampling.compilationErrors,
    extendedSamplerValidationError: extendedTextureSampling.validationError,
    extendedGpuSubmissionCompleted: extendedTextureSampling.submissionCompleted,
    offscreenStencilReadback: offscreenStencil.readback,
    offscreenStencilStableAcrossFrames: offscreenStencil.stableAcrossFrames,
    gpuErrors
};

declare global {
    interface Window {
        __HILO3D_WEBGPU_RESULT__?: {
            backend: string;
            drawCount: number;
            faceCount: number;
            hasShadowAtlas: boolean;
            shadowLightKinds: { directional: number; spot: number; point: number };
            renderTargetAttachments: number;
            renderTargetSampleCount: number;
            renderTargetHasStencil: boolean;
            readbackByteLength: number;
            readbackHasContent: boolean;
            clearColorReadback: number[];
            mrtAttachments: number;
            mrtReadbacksHaveContent: boolean;
            textureRevisionAdvanced: boolean;
            recoveryState: string;
            recoveryDeviceChanged: boolean;
            recoveryTargetIdentityPreserved: boolean;
            recoveryTextureImageReleasedBefore: boolean;
            recoveryTextureImageReleasedAfter: boolean;
            recoveryReadbackHasContent: boolean;
            recoveryProbeHasSceneContent: boolean;
            recoveryReadbackMatches: boolean;
            deviceLostEvents: number;
            deviceRestoredEvents: number;
            extendedSamplerTypes: readonly string[];
            extendedTextureDimensions: readonly string[];
            extendedSamplerReadback: readonly number[];
            extendedSamplerCompilationErrors: readonly string[];
            extendedSamplerValidationError: string | null;
            extendedGpuSubmissionCompleted: boolean;
            offscreenStencilReadback: readonly number[];
            offscreenStencilStableAcrossFrames: boolean;
            gpuErrors: string[];
        };
    }
}
