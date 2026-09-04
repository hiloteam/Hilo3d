import { BasicMaterial, DataTexture, PlaneGeometry } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
const data = new Float32Array(128);
for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2;
const texture = new DataTexture({ data });
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 4, height: 4, heightSegments: 32, widthSegments: 64 }),
    material: new BasicMaterial({ diffuse: texture, cullMode: 'none', lightType: 'NONE' })
});
runtime.start(() => {
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2;
    const image = texture.image;
    if (image) image.set(data);
    texture.needUpdate = true;
});
