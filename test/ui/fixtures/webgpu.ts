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
    PBRMaterial,
    PerspectiveCamera,
    PointLight,
    ShaderMaterial,
    SpotLight,
    Stage,
    Texture,
    Vector3
} from '../../../src/Hilo3d';
import type { RHIDevice, RHISurface } from '../../../src/render/rhi/core';
import { validateExtendedTextureSampling } from './webgpu-rhi-v2';

interface OffscreenStencilResult {
    readonly readback: readonly number[];
    readonly stableAcrossFrames: boolean;
}

interface RendererExtensionProvider {
    getExtension(name: string): object | null;
}

interface WebGPURHIV2Extension {
    readonly device: RHIDevice;
    readonly surface: RHISurface;
    readonly recoveryState: string;
}

function requireWebGPURHIV2(renderer: RendererExtensionProvider): WebGPURHIV2Extension {
    const extension = renderer.getExtension('rhi-v2') as WebGPURHIV2Extension | null;
    if (!extension) throw new Error('The RHI v2 extension is unavailable.');
    if (extension.device.backend !== 'webgpu') {
        throw new Error(
            `The RHI v2 extension exposed ${extension.device.backend}, expected webgpu`
        );
    }
    if (extension.surface.deviceId !== extension.device.id) {
        throw new Error('The RHI v2 extension surface and device have different owners');
    }
    return extension;
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

    try {
        requireWebGPURHIV2(validationStage.renderer);
        validationStage.renderer.renderToTarget(target, validationStage, camera);
        const first = await target.readColorAttachment({ x: 2, y: 2, width: 1, height: 1 });
        validationStage.renderer.renderToTarget(target, validationStage, camera);
        const second = await target.readColorAttachment({ x: 2, y: 2, width: 1, height: 1 });
        await validationStage.renderer.waitForIdle();
        return {
            readback: Array.from(first.data),
            stableAcrossFrames: second.data.every((value, index) => value === first.data[index])
        };
    } finally {
        target.destroy();
        validationStage.destroy();
    }
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
const rhi = requireWebGPURHIV2(stage.renderer);
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
await stage.renderer.waitForIdle();
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
stage.renderer.renderToTarget(mrtTarget, stage, camera);
await stage.renderer.waitForIdle();
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
const deviceBeforeRecovery = rhi.device;
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
            restoredDeviceMatches = event.detail === rhi.device;
            resolve();
        },
        true
    );
});
deviceBeforeRecovery.destroy();
await deviceLost;
await Promise.all([stage.renderer.waitForIdle(), deviceRestored]);
const recoveryTargetIdentityPreserved = stage.renderer.renderTarget === renderTarget;
stage.tick(0);
await stage.renderer.waitForIdle();
const recoveryReadback = await renderTarget.readColorAttachment({
    x: 320,
    y: 72,
    width: 1,
    height: 1
});
const extendedTextureSampling = await validateExtendedTextureSampling(rhi.device);
const offscreenStencil = await validateOffscreenStencil();
await new Promise(resolve => setTimeout(resolve, 0));
window.__HILO3D_WEBGPU_RESULT__ = {
    backend: stage.renderer.backend,
    rhiExtensionBackend: rhi.device.backend,
    rhiSurfaceState: rhi.surface.state,
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
    recoveryState: rhi.recoveryState,
    recoveryDeviceChanged: rhi.device !== deviceBeforeRecovery && restoredDeviceMatches,
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
    offscreenStencilStableAcrossFrames: offscreenStencil.stableAcrossFrames
};

declare global {
    interface Window {
        __HILO3D_WEBGPU_RESULT__?: {
            backend: string;
            rhiExtensionBackend: string;
            rhiSurfaceState: string;
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
        };
    }
}
