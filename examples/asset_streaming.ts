import { ASSET_STAGE_SERVICE, createAssetStageSystem } from '@hilo/addon-assets';
import {
    BasicMaterial,
    BoxGeometry,
    Color,
    Mesh,
    OrbitControls,
    PerspectiveCamera,
    Stage,
    Ticker,
    Vector3
} from '../src/Hilo3d';
import { resolveExampleBackend } from './shared/backend';

const container = document.querySelector<HTMLElement>('#container');
const diagnostics = document.querySelector<HTMLElement>('#diagnostics');
const errorElement = document.querySelector<HTMLElement>('#error');
const switchButton = document.querySelector<HTMLButtonElement>('#switch');
const qualityButton = document.querySelector<HTMLButtonElement>('#quality');
if (!container || !diagnostics || !errorElement || !switchButton || !qualityButton)
    throw new Error('Asset lab markup is incomplete.');
const camera = new PerspectiveCamera({ x: 2.2, y: 1.5, z: 3.7, aspect: innerWidth / innerHeight });
const stage = await Stage.create({
    backend: resolveExampleBackend(),
    container,
    camera,
    clearColor: new Color(0.035, 0.062, 0.06)
});
const compressed = ['bc', 'etc2', 'astc-4x4'].some(format =>
    stage.renderer.supportsTextureCompression(format as 'bc' | 'etc2' | 'astc-4x4')
);
await stage.installSystem(
    createAssetStageSystem({
        budgets: { residentBytes: compressed ? 3000 : 10000, uploadsPerFrame: 1 }
    })
);
const assets = stage.systems.get(ASSET_STAGE_SERVICE);
const controls = new OrbitControls(stage, {
    target: new Vector3(0, 0, 0),
    minDistance: 2,
    maxDistance: 8
});
const urls = [
    new URL('../test/asset/ktx2/etc1s.ktx2', import.meta.url).href,
    new URL('../test/asset/ktx2/uastc.ktx2', import.meta.url).href
];
const leases = urls.map((url, index) =>
    assets.acquireTexture(
        {
            id: index === 0 ? 'ETC1S study' : 'UASTC study',
            version: 'fixture-1',
            url,
            byteLength: index === 0 ? 966 : 2560,
            width: 40,
            height: 40,
            mipLevelCount: 6
        },
        { visible: index === 0 }
    )
);
const meshes = leases.map((lease, index) =>
    new Mesh({
        geometry: new BoxGeometry(),
        material: new BasicMaterial({ lightType: 'NONE', diffuse: lease.texture }),
        visible: index === 0,
        rotationY: 28
    }).addTo(stage)
);
let selected = 0,
    coarse = false,
    destroyed = false;
function report(reason: unknown): void {
    if (reason instanceof DOMException && reason.name === 'AbortError') return;
    if (errorElement)
        errorElement.textContent = reason instanceof Error ? reason.message : String(reason);
}
function updateDemand(): void {
    leases.forEach((lease, index) => {
        const mesh = meshes[index];
        if (mesh) mesh.visible = index === selected;
        void lease
            .setDemand({ visible: index === selected, mipLevel: coarse ? 3 : 0, priority: 10 })
            .catch(report);
    });
}
switchButton.onclick = () => {
    selected = 1 - selected;
    updateDemand();
};
qualityButton.onclick = () => {
    coarse = !coarse;
    qualityButton.textContent = coarse ? 'Use full detail' : 'Use coarse detail';
    updateDemand();
};
for (const lease of leases) void lease.ready.catch(report);
const ticker = new Ticker();
ticker.addTick(stage);
ticker.addTick({
    tick(): void {
        const info = assets.getDiagnostics();
        diagnostics.textContent = `${stage.renderer.backend.toUpperCase()} · ${compressed ? 'GPU compressed' : 'RGBA fallback'}\nResident: ${String(info.residentBytes)} B · evictions: ${String(info.evictions)}\nIn flight: ${String(info.inFlightBytes)} B\n${info.assets.map(asset => `${asset.id}: ${asset.state} / mip ${asset.residentMip === null ? '—' : String(asset.residentMip)}${asset.stall === 'none' ? '' : ` (${asset.stall})`}`).join('\n')}`;
    }
});
function resize(): void {
    camera.aspect = innerWidth / innerHeight;
    stage.resize(innerWidth, innerHeight);
}
function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    ticker.stop();
    controls.dispose();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('pageshow', onShow);
    stage.destroy();
}
function onHide(event: PageTransitionEvent): void {
    if (event.persisted) ticker.stop();
    else destroy();
}
function onShow(event: PageTransitionEvent): void {
    if (event.persisted && !destroyed) {
        resize();
        ticker.start();
    }
}
window.addEventListener('resize', resize);
window.addEventListener('pagehide', onHide);
window.addEventListener('pageshow', onShow);
resize();
ticker.start();
