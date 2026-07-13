import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = createExampleContext();
const geometry = new Hilo3d.SphereGeometry({
    radius: 1,
    heightSegments: 32,
    widthSegments: 64
});
const material = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    diffuse: new Hilo3d.LazyTexture({
        src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
    }),
    wireframe: false
});
new Hilo3d.Mesh({ geometry, material }).addTo(stage);
