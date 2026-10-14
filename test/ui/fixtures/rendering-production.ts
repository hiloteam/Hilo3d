import * as Hilo3d from '../../../src/Hilo3d';

export interface RenderingProductionAPI {
    render(frames?: number): Promise<void>;
    resize(width: number, height: number): Promise<void>;
    diagnostics(): Promise<Readonly<Hilo3d.ClusteredForwardPlusDiagnostics> | null>;
    dispose(): Promise<void>;
}

declare global {
    interface Window {
        __HILO_RENDERING_PRODUCTION__?: RenderingProductionAPI;
    }
}

async function createFixture(): Promise<void> {
    const query = new URLSearchParams(location.search);
    const backend = query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
    const advanced = query.get('advanced') === '1';
    const container = document.getElementById('surface');
    if (container === null) throw new Error('Missing fixture surface');
    const geometry = new Hilo3d.PlaneGeometry({ width: 3, height: 2 });
    const atlas = new Hilo3d.DataTexture({
        width: 2,
        height: 2,
        type: Hilo3d.constants.webgl.UNSIGNED_BYTE,
        format: Hilo3d.constants.webgl.RGBA,
        internalFormat: Hilo3d.constants.webgl2.RGBA8,
        image: new Uint8Array([
            255, 64, 16, 255, 16, 180, 255, 255, 255, 180, 16, 255, 32, 255, 96, 255
        ]),
        minFilter: Hilo3d.constants.webgl.NEAREST,
        magFilter: Hilo3d.constants.webgl.NEAREST
    });
    const projectorNode = new Hilo3d.Node({ scaleX: 2, scaleY: 1.4, scaleZ: 1 });
    projectorNode.updateMatrixWorld(true);
    const projector = new Hilo3d.DecalProjector({ transform: projectorNode.worldMatrix });
    const material = new Hilo3d.PBRMaterial({
        metallic: 0,
        roughness: 0.9,
        baseColor: new Hilo3d.Color(0.5, 0.5, 0.5),
        decals: { projectors: [projector], baseColorAtlas: atlas }
    });
    const clustered = advanced
        ? new Hilo3d.ClusteredForwardPlusPipelineFactory({
              buckets: [{ geometry, material: new Hilo3d.PBRMaterial({ metallic: 0 }) }],
              maxObjects: 8,
              maxLights: 4,
              maxLightIndices: 4096,
              maxLightsPerCluster: 4,
              maxViewportWidth: 320,
              maxViewportHeight: 240,
              tileSize: 16,
              zSlices: 8,
              hiZ: false,
              bloomStrength: 0,
              temporalAA: {},
              weightedBlendedTransparency: true,
              groundTruthAmbientOcclusion: { quality: 'low' },
              atmosphere: { quality: 'low' },
              volumetricLighting: { quality: 'low', density: 0.03, maxDistance: 8 },
              dynamicGlobalIllumination: {
                  origin: new Hilo3d.Vector3(-2, -1, -1),
                  spacing: new Hilo3d.Vector3(2, 1, 1),
                  probeCounts: [3, 3, 3],
                  maxProbesPerFrame: 27,
                  raysPerProbe: 64,
                  maxTriangles: 64,
                  maxMeshes: 8,
                  maxTextureTexels: 16,
                  maxRayDistance: 8,
                  hysteresis: 0.5
              }
          })
        : null;
    const camera = new Hilo3d.PerspectiveCamera({ z: 3, near: 0.1, far: 10, aspect: 4 / 3 });
    const stage = await Hilo3d.Stage.create({
        backend,
        container,
        camera,
        width: 256,
        height: 192,
        antialias: false,
        useInstanced: true,
        clearColor: new Hilo3d.Color(0, 0, 0),
        renderPipeline:
            clustered ??
            new Hilo3d.ForwardRenderPipelineFactory({ weightedBlendedTransparency: true })
    });
    new Hilo3d.Mesh({ geometry, material, useInstanced: true }).addTo(stage);
    new Hilo3d.DirectionalLight({
        direction: new Hilo3d.Vector3(0.4, -0.5, -1),
        amount: 2,
        shadow: { width: 64, height: 64, cascadeCount: 2 }
    }).addTo(stage);
    new Hilo3d.AmbientLight({ amount: 0.3 }).addTo(stage);
    const smoke = new Hilo3d.Mesh({
        geometry: new Hilo3d.PlaneGeometry({ width: 1.1, height: 1.1 }),
        x: 0.7,
        z: 0.3,
        contributeToGlobalIllumination: false,
        castShadows: false,
        material: new Hilo3d.BasicMaterial({
            lightType: 'NONE',
            diffuse: new Hilo3d.Color(0.2, 0.8, 1),
            opacity: 0.5,
            compositing: { mode: 'weighted-blended' }
        })
    }).addTo(stage);
    const events = new AbortController();
    let enabled = true;
    let destroyed = false;
    const render = async (frames = 6): Promise<void> => {
        if (destroyed) throw new Error('Fixture has been destroyed');
        for (let frame = 0; frame < frames; frame++) {
            stage.tick(16);
            await stage.renderer.waitForIdle();
        }
    };
    document.getElementById('decal')?.addEventListener(
        'click',
        () => {
            enabled = !enabled;
            projector.update({ enabled });
        },
        { signal: events.signal }
    );
    document.getElementById('smoke')?.addEventListener(
        'click',
        () => {
            smoke.visible = !smoke.visible;
        },
        { signal: events.signal }
    );
    const api: RenderingProductionAPI = {
        render,
        async resize(width, height): Promise<void> {
            camera.aspect = width / height;
            stage.resize(width, height);
            await render();
        },
        diagnostics: async () => (clustered === null ? null : await clustered.readDiagnostics()),
        async dispose(): Promise<void> {
            if (destroyed) return;
            await stage.renderer.waitForIdle();
            destroyed = true;
            events.abort();
            stage.destroy();
            atlas.destroy();
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
    window.__HILO_RENDERING_PRODUCTION__ = api;
}

void createFixture().catch((error: unknown) => {
    document.body.dataset['failure'] = error instanceof Error ? error.message : String(error);
    throw error;
});
