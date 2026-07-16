import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

interface CompressedTextureCase {
    readonly source: string;
    readonly compression: Hilo3d.TextureCompressionFormat;
    readonly completeMipChain: boolean;
}

interface CompressedTextureExampleResult {
    readonly backend: Hilo3d.RendererBackend;
    readonly supportedSources: readonly string[];
    readonly renderedSources: readonly string[];
    readonly skipped: readonly string[];
}

const cases: readonly CompressedTextureCase[] = [
    {
        source: 'astc',
        compression: 'astc-4x4',
        completeMipChain: false
    },
    {
        source: 'etc_etc2',
        compression: 'etc2',
        completeMipChain: false
    },
    {
        source: 'etc_etc1',
        compression: 'etc1',
        completeMipChain: false
    },
    {
        source: 'pvrtc',
        compression: 'pvrtc',
        completeMipChain: true
    },
    {
        source: 's3tc_dxt1',
        compression: 'bc',
        completeMipChain: true
    },
    {
        source: 's3tc_dxt3',
        compression: 'bc',
        completeMipChain: false
    },
    {
        source: 's3tc_dxt5',
        compression: 'bc',
        completeMipChain: false
    }
];

const { stage, renderer, orbitControls } = await createExampleContext();
orbitControls.disable();

const supported = cases.filter(entry => renderer.supportsTextureCompression(entry.compression));
const skipped = cases
    .filter(entry => !supported.includes(entry))
    .map(
        entry => `${entry.source}: native ${entry.compression} texture compression is unavailable`
    );

const loaded = await Promise.all(
    supported.map(async entry => {
        const texture = await new Hilo3d.KTXLoader().load({
            src: `./image/compressed/logo_${entry.source}.ktx`
        });
        texture.minFilter = entry.completeMipChain
            ? Hilo3d.constants.LINEAR_MIPMAP_LINEAR
            : Hilo3d.constants.LINEAR;
        return { entry, texture };
    })
);

const planeGeometry = new Hilo3d.PlaneGeometry();
loaded.forEach(({ entry, texture }, index) => {
    stage.addChild(
        new Hilo3d.Mesh({
            geometry: planeGeometry,
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                diffuse: texture,
                side: Hilo3d.constants.FRONT_AND_BACK
            }),
            rotationX: 180,
            x: 0.72 * ((index % 3) - 1),
            y: 0.72 * (0.5 - Math.floor(index / 3)),
            scaleX: 0.5,
            scaleY: 0.5
        })
    );
    console.info(`Loaded ${entry.source} as a native ${renderer.backend} compressed texture`);
});

stage.tick(0);
await new Promise<void>(resolve =>
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            resolve();
        });
    })
);

window.__HILO3D_COMPRESSED_TEXTURE_RESULT__ = {
    backend: renderer.backend,
    supportedSources: supported.map(entry => entry.source),
    renderedSources: loaded.map(({ entry }) => entry.source),
    skipped
};

declare global {
    interface Window {
        __HILO3D_COMPRESSED_TEXTURE_RESULT__?: CompressedTextureExampleResult;
    }
}
