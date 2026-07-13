import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage } = createExampleContext();

void Promise.all(
    [
        './image/reflectionprobe-00.hdr',
        './image/reflectionprobe-01.hdr',
        './image/reflectionprobe-02.hdr',
        './image/reflectionprobe-03.hdr',
        './image/reflectionprobe-04.hdr',
        './image/reflectionprobe-05.hdr'
    ].map(src => new Hilo3d.HDRLoader().load({ src }))
)
    .then(textures => {
        const firstTexture = textures[0];
        if (!firstTexture) throw new Error('HDR cube map did not load any faces');
        const images = textures.map(texture => texture.image);
        if (!images.every(image => image instanceof Float32Array)) {
            throw new TypeError('HDR cube-map faces must contain floating-point image data');
        }
        const cubeTexture = new Hilo3d.CubeTexture({
            image: images,
            type: Hilo3d.constants.FLOAT,
            width: firstTexture.width,
            height: firstTexture.height,
            format: firstTexture.format,
            internalFormat: firstTexture.internalFormat,
            minFilter: firstTexture.minFilter,
            magFilter: firstTexture.magFilter
        });

        new Hilo3d.Mesh({
            geometry: new Hilo3d.BoxGeometry(),
            material: new Hilo3d.BasicMaterial({
                lightType: 'NONE',
                diffuse: cubeTexture,
                side: Hilo3d.constants.BACK,
                useHDR: true
            })
        }).addTo(stage);
    })
    .catch((error: unknown) => {
        console.error('Failed to load HDR cube map', error);
    });
