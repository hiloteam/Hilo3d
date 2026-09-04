import {
    BasicMaterial,
    KTXLoader,
    PlaneGeometry,
    constants,
    type RendererBackend,
    type TextureCompressionFormat
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

interface CompressedTextureExampleResult {
    readonly backend: RendererBackend;
    readonly supportedSources: readonly string[];
    readonly renderedSources: readonly string[];
    readonly skipped: readonly string[];
}

const cases: readonly {
    readonly source: string;
    readonly compression: TextureCompressionFormat;
    readonly completeMipChain: boolean;
}[] = [
    { source: 'astc', compression: 'astc-4x4', completeMipChain: false },
    { source: 'etc_etc2', compression: 'etc2', completeMipChain: false },
    { source: 'etc_etc1', compression: 'etc1', completeMipChain: false },
    { source: 'pvrtc', compression: 'pvrtc', completeMipChain: true },
    { source: 's3tc_dxt1', compression: 'bc', completeMipChain: true },
    { source: 's3tc_dxt3', compression: 'bc', completeMipChain: false },
    { source: 's3tc_dxt5', compression: 'bc', completeMipChain: false }
];
const runtime = await createExampleRuntime();
runtime.controls.enabled = false;
const supported = cases.filter(entry =>
    runtime.engine.renderer.supportsTextureCompression(entry.compression)
);
const skipped = cases
    .filter(entry => !supported.includes(entry))
    .map(
        entry => `${entry.source}: native ${entry.compression} texture compression is unavailable`
    );
const loaded = await Promise.all(
    supported.map(async entry => {
        const texture = await new KTXLoader().load({
            src: `./image/compressed/logo_${entry.source}.ktx`
        });
        texture.minFilter = entry.completeMipChain
            ? constants.LINEAR_MIPMAP_LINEAR
            : constants.LINEAR;
        return { entry, texture };
    })
);
const geometry = new PlaneGeometry();
loaded.forEach(({ texture }, index) => {
    createMeshEntity(runtime.world, {
        geometry,
        material: new BasicMaterial({ lightType: 'NONE', diffuse: texture, cullMode: 'none' }),
        rotation: quaternionFromDegrees(180),
        position: [0.9 * ((index % 3) - 1), 0.9 * (0.5 - Math.floor(index / 3)), 0],
        scale: [0.6, 0.6, 0.6]
    });
});
runtime.start();
window.__HILO3D_COMPRESSED_TEXTURE_RESULT__ = {
    backend: runtime.engine.renderer.backend,
    supportedSources: supported.map(entry => entry.source),
    renderedSources: loaded.map(({ entry }) => entry.source),
    skipped
};

declare global {
    interface Window {
        __HILO3D_COMPRESSED_TEXTURE_RESULT__?: CompressedTextureExampleResult;
    }
}
