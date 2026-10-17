import * as Hilo3d from '../../../src/Hilo3d';

export interface MAT1MaterialAcceptance {
    render(frames?: number): Promise<void>;
    settle(): Promise<void>;
    resize(width: number, height: number): Promise<void>;
    orbit(): Promise<void>;
    dispose(): Promise<void>;
}

declare global {
    interface Window {
        __HILO_MAT1__?: MAT1MaterialAcceptance;
    }
}

async function createFixture(): Promise<void> {
    const query = new URLSearchParams(location.search);
    const backend = query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
    const clustered = query.get('clustered') === '1';
    const production = query.get('quality') === 'production';
    const initialWidth = production ? 500 : 320;
    const initialHeight = initialWidth * 0.4;
    const container = document.getElementById('surface');
    if (container === null) throw new Error('Missing MAT1 fixture surface');
    const sphere = new Hilo3d.SphereGeometry({
        radius: 0.72,
        widthSegments: 40,
        heightSegments: 24
    });
    const bucketMaterial = new Hilo3d.PBRMaterial({ metallic: 0, roughness: 0.85 });
    const pipeline = clustered
        ? new Hilo3d.ClusteredForwardPlusPipelineFactory({
              buckets: [{ geometry: sphere, material: bucketMaterial }],
              maxObjects: 8,
              maxLights: 4,
              maxLightIndices: production ? 65_536 : 4096,
              maxLightsPerCluster: 4,
              maxViewportWidth: production ? 1920 : 640,
              maxViewportHeight: production ? 1080 : 400,
              tileSize: 32,
              zSlices: 8,
              hiZ: false,
              bloomStrength: 0,
              temporalAA: { sharpness: 0 },
              subsurfaceScattering: { sampleCount: 17 },
              groundTruthAmbientOcclusion: { quality: 'low' }
          })
        : new Hilo3d.PostProcessRenderPipelineFactory({
              subsurfaceScattering: { sampleCount: 17 },
              temporalAA: { sharpness: 0 },
              bloom: false,
              colorUber: { toneMapping: 'aces', exposure: 0 },
              groundTruthAmbientOcclusion: { quality: 'low' }
          });
    const camera = new Hilo3d.PerspectiveCamera({
        z: 5.4,
        near: 0.1,
        far: 30,
        aspect: 2.5,
        fov: 35
    });
    const stage = await Hilo3d.Stage.create({
        backend,
        camera,
        container,
        width: initialWidth,
        height: initialHeight,
        antialias: false,
        renderPipeline: pipeline,
        clearColor: new Hilo3d.Color(0.008, 0.012, 0.022)
    });
    const cloth = new Hilo3d.PBRMaterial({
        metallic: 0,
        roughness: 0.8,
        baseColor: new Hilo3d.Color(0.07, 0.006, 0.015),
        sheenColor: new Hilo3d.Color(0.9, 0.13, 0.22),
        sheenRoughness: 0.7
    });
    const leaf = new Hilo3d.PBRMaterial({
        metallic: 0,
        roughness: 0.95,
        baseColor: new Hilo3d.Color(0.025, 0.16, 0.015),
        diffuseTransmissionFactor: 0.85,
        diffuseTransmissionColor: new Hilo3d.Color(0.22, 0.75, 0.025),
        cullMode: 'none'
    });
    const wax = new Hilo3d.PBRMaterial({
        metallic: 0,
        roughness: 0.6,
        baseColor: new Hilo3d.Color(0.85, 0.53, 0.32),
        subsurfaceProfile: new Hilo3d.SubsurfaceScatteringProfile({ radius: [0.22, 0.09, 0.04] }),
        subsurfaceThickness: 0.5
    });
    new Hilo3d.Mesh({ geometry: sphere, material: cloth, x: -1.85 }).addTo(stage);
    new Hilo3d.Mesh({
        geometry: new Hilo3d.PlaneGeometry({ width: 1.1, height: 1.5 }),
        material: leaf,
        rotationZ: -12,
        rotationY: -15
    }).addTo(stage);
    new Hilo3d.Mesh({ geometry: sphere, material: wax, x: 1.85 }).addTo(stage);
    new Hilo3d.DirectionalLight({
        direction: new Hilo3d.Vector3(-1, -0.3, -0.25),
        amount: 2.5
    }).addTo(stage);
    new Hilo3d.DirectionalLight({ direction: new Hilo3d.Vector3(0.2, 0.1, 1), amount: 2.2 }).addTo(
        stage
    );
    new Hilo3d.AmbientLight({ amount: 0.08 }).addTo(stage);
    const controls = new Hilo3d.OrbitControls(stage, { target: new Hilo3d.Vector3() });
    const events = new AbortController();
    let destroyed = false;
    let renderQueue: Promise<void> = Promise.resolve();
    const render = (frames = 8): Promise<void> => {
        renderQueue = renderQueue.then(async () => {
            if (destroyed) throw new Error('MAT1 fixture has been destroyed');
            for (let frame = 0; frame < frames; frame++) {
                stage.tick(16);
                await stage.renderer.waitForIdle();
            }
        });
        return renderQueue;
    };
    const requestRender = (): void => {
        void render().catch((error: unknown) => {
            document.body.dataset['failure'] =
                error instanceof Error ? error.message : String(error);
            console.error(error);
        });
    };
    controls.onChange = requestRender;
    for (const feature of ['sheen', 'thin', 'sss'] as const) {
        const button = document.querySelector<HTMLButtonElement>(`[data-feature="${feature}"]`);
        if (button === null) throw new Error(`Missing ${feature} control`);
        button.addEventListener(
            'click',
            () => {
                const enabled = button.getAttribute('aria-pressed') !== 'true';
                button.setAttribute('aria-pressed', String(enabled));
                if (feature === 'sheen') {
                    cloth.sheenColor.set(
                        enabled ? 0.9 : 0,
                        enabled ? 0.13 : 0,
                        enabled ? 0.22 : 0,
                        1
                    );
                    cloth.invalidateData();
                } else if (feature === 'thin') {
                    leaf.diffuseTransmissionFactor = enabled ? 0.85 : 0;
                } else {
                    wax.subsurfaceFactor = enabled ? 1 : 0;
                }
                requestRender();
            },
            { signal: events.signal }
        );
    }
    const api: MAT1MaterialAcceptance = {
        render,
        settle: () => renderQueue,
        async resize(width, height): Promise<void> {
            camera.aspect = width / height;
            stage.resize(width, height);
            await render();
        },
        async orbit(): Promise<void> {
            controls.setView(new Hilo3d.Vector3(0.3, 0.1, 5.4), new Hilo3d.Vector3());
            await renderQueue;
        },
        async dispose(): Promise<void> {
            if (destroyed) return;
            await renderQueue;
            await stage.renderer.waitForIdle();
            destroyed = true;
            events.abort();
            controls.dispose();
            stage.destroy();
        }
    };
    window.addEventListener(
        'pagehide',
        event => {
            if (!event.persisted) void api.dispose();
        },
        { signal: events.signal }
    );
    await render();
    window.__HILO_MAT1__ = api;
}

await createFixture().catch((error: unknown) => {
    document.body.dataset['failure'] = error instanceof Error ? error.message : String(error);
    throw error;
});
