import { BasicLoader, BasicMaterial, BoxGeometry, LazyTexture, LocalTransform } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
BasicLoader.disableCache();
const texture = new LazyTexture({
    isImageCanRelease: true,
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
});
const entity = createMeshEntity(runtime.world, {
    geometry: new BoxGeometry(),
    material: new BasicMaterial({ diffuse: texture })
});
let sourceIndex = 0;
window.setInterval(() => {
    const src =
        ++sourceIndex % 2 === 0
            ? './models/Tmall/baseColor.png'
            : new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href;
    void new BasicLoader().load({ src }).then(image => {
        if (!(image instanceof HTMLImageElement))
            throw new TypeError('Expected a replacement image.');
        texture.image = image;
        texture.needUpdate = true;
    });
}, 3000);
runtime.start(time => {
    const angle = time * 0.8;
    const half = angle * 0.5;
    runtime.world.set(entity, LocalTransform, {
        rotation: [
            Math.sin(half) * 0.58,
            Math.sin(half) * 0.58,
            Math.sin(half) * 0.58,
            Math.cos(half)
        ]
    });
});
