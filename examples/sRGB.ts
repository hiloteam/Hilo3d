import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

const planeGeometry = new Hilo3d.PlaneGeometry();

const sRGBPlane = new Hilo3d.Mesh({
    geometry: planeGeometry,
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.LazyTexture({
            src: new URL('./models/Tmall/baseColor.png', import.meta.url).href,
            format: Hilo3d.constants.RGBA,
            internalFormat: Hilo3d.constants.SRGB8_ALPHA8,
            flipY: true,
            minFilter: Hilo3d.constants.NEAREST,
            magFilter: Hilo3d.constants.NEAREST
        })
    }),
    x: -1
});
stage.addChild(sRGBPlane);

const linearPlane = new Hilo3d.Mesh({
    geometry: planeGeometry,
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.LazyTexture({
            src: new URL('./models/Tmall/baseColor.png', import.meta.url).href,
            flipY: true,
            minFilter: Hilo3d.constants.NEAREST,
            magFilter: Hilo3d.constants.NEAREST
        })
    }),
    x: 1
});
stage.addChild(linearPlane);
