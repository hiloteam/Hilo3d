import {
    BasicMaterial,
    Mesh,
    Node,
    OrthographicCamera,
    PlaneGeometry,
    Renderer,
    type RendererBackend
} from 'hilo3d';
import { AssetManager } from '@hilo/addon-assets';

/** Actual worker → compressed texture → shared graph → readback → device recovery acceptance. */
export async function renderAssets(
    backend: RendererBackend,
    url: string
): Promise<{ before: number[]; after: number[]; uploads: number; stableIdentity: boolean }> {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const renderer = await Renderer.create({ backend, width: 16, height: 16, domElement: canvas });
    const manager = new AssetManager(renderer, { autoUpdate: false });
    let target = renderer.createRenderTarget({
        width: 16,
        height: 16,
        colorAttachments: [{ format: 'rgba8unorm' }]
    });
    const scene = new Node(),
        camera = new OrthographicCamera({
            left: -1,
            right: 1,
            top: 1,
            bottom: -1,
            near: 0.1,
            far: 10,
            z: 2
        });
    const lease = manager.acquireTexture({
        id: 'basis-grid',
        version: 'fixture-1',
        url,
        byteLength: 966,
        width: 40,
        height: 40,
        mipLevelCount: 6
    });
    const identity = lease.texture;
    const mesh = new Mesh({
        geometry: new PlaneGeometry({ width: 2, height: 2 }),
        material: new BasicMaterial({ lightType: 'NONE', diffuse: lease.texture })
    }).addTo(scene);
    const pump = async (): Promise<void> => {
        for (let index = 0; index < 400; index++) {
            await manager.update();
            const entry = manager.getDiagnostics().assets[0];
            if (entry?.error) throw new Error(entry.error);
            if (entry?.residentMip === 0) return;
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        throw new Error('Streaming fixture did not reach full residency.');
    };
    try {
        await pump();
        await lease.ready;
        renderer.renderToTarget(target, scene, camera);
        const before = Array.from((await target.readColorAttachment()).data);
        renderer.releaseGPUResources();
        await pump();
        target = renderer.createRenderTarget({
            width: 16,
            height: 16,
            colorAttachments: [{ format: 'rgba8unorm' }]
        });
        const extension = renderer.getExtension('rhi') as { device: { destroy(): void } };
        const restored = new Promise<void>((resolve, reject) => {
            renderer.on(
                'rhiDeviceRestored',
                () => {
                    resolve();
                },
                true
            );
            renderer.on(
                'rhiDeviceRecoveryFailed',
                () => {
                    reject(new Error('Recovery failed.'));
                },
                true
            );
        });
        extension.device.destroy();
        await restored;
        await pump();
        renderer.renderToTarget(target, scene, camera);
        const after = Array.from((await target.readColorAttachment()).data);
        return {
            before,
            after,
            uploads: manager.getDiagnostics().uploadBytesLastFrame,
            stableIdentity: identity === lease.texture
        };
    } finally {
        manager.destroy();
        mesh.destroy(renderer);
        target.destroy();
        renderer.destroy();
        canvas.remove();
    }
}
