import * as Hilo3d from '../../../src/Hilo3d';

const SIZE = 96;
const requestedBackend = new URL(location.href).searchParams.get('backend');
if (requestedBackend !== 'webgl2' && requestedBackend !== 'webgpu') {
    throw new TypeError('Shadow orientation fixture requires backend=webgl2 or backend=webgpu');
}
const backend: Hilo3d.RendererBackend = requestedBackend;
const container = document.querySelector<HTMLElement>('#stage');
if (!container) throw new Error('Shadow orientation fixture container is missing');

const camera = new Hilo3d.OrthographicCamera({
    left: -3,
    right: 3,
    bottom: -3,
    top: 3,
    near: 0.1,
    far: 20,
    x: 0,
    y: 8,
    z: 0
});
camera.up.set(0, 0, -1);
camera.lookAt(new Hilo3d.Vector3(0, 0, 0));

const stage = await Hilo3d.Stage.create<Hilo3d.RendererBackend>({
    backend,
    container,
    camera,
    width: SIZE,
    height: SIZE,
    pixelRatio: 1,
    antialias: false,
    clearColor: new Hilo3d.Color(1, 1, 1)
});

new Hilo3d.Mesh({
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry(),
    material: new Hilo3d.BasicMaterial({
        lightType: 'LAMBERT',
        diffuse: new Hilo3d.Color(0.85, 0.85, 0.85)
    }),
    castShadows: false
})
    .setScale(6)
    .addTo(stage);

new Hilo3d.Mesh({
    x: -0.9,
    y: 0.8,
    z: 0.45,
    geometry: new Hilo3d.BoxGeometry({ width: 0.8, height: 1.6, depth: 0.6 }),
    material: new Hilo3d.BasicMaterial({
        lightType: 'LAMBERT',
        diffuse: new Hilo3d.Color(0.85, 0.85, 0.85)
    })
}).addTo(stage);

new Hilo3d.Mesh({
    x: 1.25,
    y: 0.5,
    z: -0.8,
    geometry: new Hilo3d.SphereGeometry({
        radius: 0.5,
        heightSegments: 24,
        widthSegments: 32
    }),
    material: new Hilo3d.BasicMaterial({
        lightType: 'LAMBERT',
        diffuse: new Hilo3d.Color(0.85, 0.85, 0.85)
    })
}).addTo(stage);

stage.addChild(
    new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(1, 1, 1),
        amount: 0.22
    })
);
stage.addChild(
    new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 1, 1),
        amount: 0.9,
        direction: new Hilo3d.Vector3(-1, -2, -0.5),
        shadow: {
            width: 512,
            height: 512,
            minBias: 0.001,
            maxBias: 0.01,
            cameraInfo: {
                left: -4,
                right: 4,
                bottom: -4,
                top: 4,
                near: 0.1,
                far: 20,
                x: 5,
                y: 8,
                z: 3
            }
        }
    })
);

// Exercise four real cascade passes and the main-pass selection shader without changing the
// orientation image produced by the visible compatibility light above.
const cascadedCoverageLight = new Hilo3d.DirectionalLight({
    amount: 0,
    direction: new Hilo3d.Vector3(-0.5, -1, -1),
    shadow: {
        width: 512,
        height: 512,
        cascadeCount: 4,
        cascadeSplitLambda: 0.6,
        cascadeMaxDistance: 12,
        cascadeBlend: 0.1,
        stabilizeCascades: true
    }
});
stage.addChild(cascadedCoverageLight);

const target = stage.renderer.createRenderTarget({
    width: SIZE,
    height: SIZE,
    sampleCount: 1,
    colorAttachments: [
        {
            format: 'rgba8unorm',
            clearValue: { r: 1, g: 1, b: 1, a: 1 }
        }
    ],
    depthStencilAttachment: { format: 'depth24plus' },
    label: 'Shadow atlas orientation diagnostics'
});

stage.renderer.renderToTarget(target, stage, camera);
const readback = await target.readColorAttachment();

function summarizeDarkPixels(threshold: number): {
    readonly threshold: number;
    readonly count: number;
    readonly centroid: readonly [number, number] | null;
    readonly bounds: readonly [number, number, number, number] | null;
} {
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minimumX = SIZE;
    let minimumY = SIZE;
    let maximumX = -1;
    let maximumY = -1;
    for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
            const offset = (y * SIZE + x) * 4;
            const luminance =
                ((readback.data[offset] ?? 0) +
                    (readback.data[offset + 1] ?? 0) +
                    (readback.data[offset + 2] ?? 0)) /
                3;
            if (luminance >= threshold) continue;
            count++;
            sumX += x;
            sumY += y;
            if (x < minimumX) minimumX = x;
            if (y < minimumY) minimumY = y;
            if (x > maximumX) maximumX = x;
            if (y > maximumY) maximumY = y;
        }
    }
    return {
        threshold,
        count,
        centroid: count === 0 ? null : [sumX / count, sumY / count],
        bounds: count === 0 ? null : [minimumX, minimumY, maximumX, maximumY]
    };
}

const summaries = [40, 80, 120, 160].map(summarizeDarkPixels);
window.__HILO3D_SHADOW_ORIENTATION_RESULT__ = {
    backend,
    cascadeCount: cascadedCoverageLight.shadow?.cascadeCount ?? 0,
    shadowAtlasSize: [
        stage.renderer.lightManager.shadowAtlas?.width ?? 0,
        stage.renderer.lightManager.shadowAtlas?.height ?? 0
    ],
    summaries
};
document.body.dataset['shadowOrientationComplete'] = 'true';
document.body.dataset['shadowOrientationResult'] = JSON.stringify(
    window.__HILO3D_SHADOW_ORIENTATION_RESULT__
);

declare global {
    interface Window {
        __HILO3D_SHADOW_ORIENTATION_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly cascadeCount: number;
            readonly shadowAtlasSize: readonly [number, number];
            readonly summaries: readonly {
                readonly threshold: number;
                readonly count: number;
                readonly centroid: readonly [number, number] | null;
                readonly bounds: readonly [number, number, number, number] | null;
            }[];
        };
    }
}
