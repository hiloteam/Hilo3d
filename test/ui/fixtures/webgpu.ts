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
    SpotLight,
    Stage,
    Texture,
    Vector3
} from '../../../src/Hilo3d';

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
    useFramebuffer: true,
    clearColor: new Color(0.04, 0.06, 0.1)
});
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
    flipY: true
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
const renderTarget = stage.renderer.renderTarget;
if (!renderTarget) throw new Error('WebGPU fixture expected an offscreen render target');
const readback = await renderTarget.readColorAttachment({ x: 320, y: 240, width: 1, height: 1 });
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
    mrtAttachments: mrtReadbacks.length,
    mrtReadbacksHaveContent: mrtReadbacks.every(result => result.data.some(value => value !== 0)),
    textureRevisionAdvanced: diffuseTexture.updateRevision > initialTextureRevision,
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
            mrtAttachments: number;
            mrtReadbacksHaveContent: boolean;
            textureRevisionAdvanced: boolean;
            gpuErrors: string[];
        };
    }
}
