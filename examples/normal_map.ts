import {
    BasicMaterial,
    BoxGeometry,
    Color,
    LocalTransform,
    PlaneGeometry,
    PointLight,
    TextureLoader
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
const [diffuse, normalMap] = await Promise.all([
    new TextureLoader().load({
        src: new URL('./models/BoomBox/BoomBox_baseColor.png', import.meta.url).href
    }),
    new TextureLoader().load({
        src: new URL('./models/BoomBox/BoomBox_normal.png', import.meta.url).href
    })
]);
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 3, height: 3 }),
    material: new BasicMaterial({
        specular: new Color(0.5, 0.5, 0.5),
        diffuse,
        normalMap
    })
});
const light = runtime.world.createEntity(LocalTransform, { position: [5, 2, 5] });
runtime.world.add(light, PointLight, { color: [0.5, 0.5, 0.5], range: 100, amount: 8 });
createMeshEntity(runtime.world, {
    parent: light,
    geometry: new BoxGeometry(),
    material: new BasicMaterial({ diffuse: new Color(0, 0, 1), lightType: 'NONE' }),
    scale: [0.1, 0.1, 0.1]
});
runtime.start(time => {
    runtime.world.set(light, LocalTransform, { position: [Math.sin(time) * 5, 2, 5] });
});
