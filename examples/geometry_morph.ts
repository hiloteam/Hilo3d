import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage, directionLight } = createExampleContext();
directionLight.direction.set(-1, -0.5, 0);

function requireGeometryData(data: Hilo3d.GeometryData | null, name: string): Hilo3d.GeometryData {
    if (!data) throw new Error(`Box geometry did not create ${name}.`);
    return data;
}

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);
const vertices = requireGeometryData(boxGeometry.vertices, 'vertices').clone();
const indices = requireGeometryData(boxGeometry.indices, 'indices').clone();
const uvs = requireGeometryData(boxGeometry.uvs, 'UV coordinates').clone();
const positiveTarget = new Hilo3d.GeometryData(new Float32Array(vertices.length), 3);
const negativeTarget = new Hilo3d.GeometryData(new Float32Array(vertices.length), 3);
const morphGeometry = new Hilo3d.MorphGeometry({
    vertices,
    indices,
    uvs,
    weights: [0, 1],
    targets: { vertices: [positiveTarget, negativeTarget] }
});

const positiveCorner = new Hilo3d.Vector3(0.5, 0.5, 0.5);
const negativeCorner = new Hilo3d.Vector3(-0.5, -0.5, -0.5);
vertices.traverse((attribute, index) => {
    if (!(attribute instanceof Hilo3d.Vector3)) {
        throw new TypeError('Box position attribute must contain vec3 values.');
    }
    if (attribute.equals(positiveCorner)) {
        positiveTarget.set(index, new Hilo3d.Vector3(0.3, 0.3, 0.3));
    }
    if (attribute.equals(negativeCorner)) {
        negativeTarget.set(index, new Hilo3d.Vector3(-0.3, -0.3, -0.3));
    }
    return undefined;
});

const mesh = new Hilo3d.Mesh({
    geometry: morphGeometry,
    material: new Hilo3d.PBRMaterial({
        baseColorMap: new Hilo3d.LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    })
}).addTo(stage);
mesh.onUpdate = () => {
    const firstWeight = Math.abs(Math.sin(performance.now() / 1000));
    morphGeometry.weights[0] = firstWeight;
    morphGeometry.weights[1] = 1 - firstWeight;
};
