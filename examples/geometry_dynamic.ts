import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

const boxGeometry = new Hilo3d.BoxGeometry({
    isStatic: false
});
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);

const textureBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        side: Hilo3d.constants.FRONT_AND_BACK,
        diffuse: new Hilo3d.LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    }),
    rotationY: -60
});

stage.addChild(textureBox);

const vertices = boxGeometry.vertices;
if (!vertices) throw new Error('Dynamic box geometry requires vertices');
const point = new Hilo3d.Vector3();
const firstVertex = vertices.get(0);
if (!(firstVertex instanceof Hilo3d.Vector3)) throw new TypeError('Expected a 3D box vertex');
point.copy(firstVertex);
Hilo3d.Tween.to(
    point,
    {
        x: 1
    },
    {
        duration: 500,
        reverse: true,
        loop: true,
        onUpdate() {
            vertices.set(0, point);
            boxGeometry.calculateNormals();
            const normals = boxGeometry.normals;
            if (!normals) throw new Error('Box normal calculation did not produce normals');
            normals.isDirty = true;
            vertices.isDirty = true;
        }
    }
);
