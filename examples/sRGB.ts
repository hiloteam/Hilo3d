import { BasicMaterial, LazyTexture, PlaneGeometry, constants } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
const geometry = new PlaneGeometry();
createMeshEntity(runtime.world, {
    geometry,
    material: new BasicMaterial({
        lightType: 'NONE',
        diffuse: new LazyTexture({
            src: new URL('./models/Tmall/baseColor.png', import.meta.url).href,
            format: constants.RGBA,
            internalFormat: constants.SRGB8_ALPHA8,
            minFilter: constants.NEAREST,
            magFilter: constants.NEAREST
        })
    }),
    position: [-1, 0, 0]
});
createMeshEntity(runtime.world, {
    geometry,
    material: new BasicMaterial({
        lightType: 'NONE',
        diffuse: new LazyTexture({
            src: new URL('./models/Tmall/baseColor.png', import.meta.url).href,
            minFilter: constants.NEAREST,
            magFilter: constants.NEAREST
        })
    }),
    position: [1, 0, 0]
});
runtime.start();
