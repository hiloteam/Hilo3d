import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = createExampleContext();

const material = new Hilo3d.BasicMaterial({
    diffuse: new Hilo3d.LazyTexture({
        src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
    })
});

const verticesData = new Float32Array([
    0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.1, 0.5, -0.1, 0.1, 0.5, 0.1, -0.5, -0.5, -0.5, -0.5, -0.5,
    0.5, -0.1, 0.5, 0.1, -0.1, 0.5, -0.1, -0.1, 0.5, 0.1, 0.1, 0.5, 0.1, 0.1, 0.5, -0.1, -0.1, 0.5,
    -0.1, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5,
    -0.5, 0.5, 0.1, 0.5, 0.1, -0.1, 0.5, 0.1, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.1, 0.5, -0.1,
    0.1, 0.5, -0.1
]);
const uvsData = new Float32Array([
    0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0,
    0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0
]);
const indicesData = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15, 16, 17, 18, 16,
    18, 19, 20, 21, 22, 20, 22, 23
]);

const geometry = new Hilo3d.Geometry({
    vertices: new Hilo3d.GeometryData(verticesData, 3),
    uvs: new Hilo3d.GeometryData(uvsData, 2),
    indices: new Hilo3d.GeometryData(indicesData, 2)
});

//  Interleaved Geometry
const interleavedData = new Float32Array(120);
function requireComponent(data: Float32Array, index: number): number {
    const component = data[index];
    if (component === undefined)
        throw new RangeError(`Missing geometry component ${String(index)}`);
    return component;
}
for (let i = 0; i < 24; i++) {
    interleavedData[i * 5] = requireComponent(verticesData, i * 3);
    interleavedData[i * 5 + 1] = requireComponent(verticesData, i * 3 + 1);
    interleavedData[i * 5 + 2] = requireComponent(verticesData, i * 3 + 2);
    interleavedData[i * 5 + 3] = requireComponent(uvsData, i * 2);
    interleavedData[i * 5 + 4] = requireComponent(uvsData, i * 2 + 1);
}

const interleavedDataID = Hilo3d.math.generateUUID('bufferViewId');
const interleavedGeometry = new Hilo3d.Geometry({
    vertices: new Hilo3d.GeometryData(interleavedData, 3, {
        stride: 20,
        bufferViewId: interleavedDataID
    }),
    uvs: new Hilo3d.GeometryData(interleavedData, 2, {
        stride: 20,
        offset: 12,
        bufferViewId: interleavedDataID
    }),
    indices: new Hilo3d.GeometryData(indicesData, 2)
});

const mesh = new Hilo3d.Mesh({
    x: -0.5,
    geometry,
    material,
    rotationX: -180,
    rotationY: 180
}).setScale(0.8);
mesh.onUpdate = () => {
    mesh.rotationX += 0.5;
    mesh.rotationY += 0.5;
};
stage.addChild(mesh);

const interleavedMesh = new Hilo3d.Mesh({
    x: 0.5,
    geometry: interleavedGeometry,
    material
}).setScale(0.8);
interleavedMesh.onUpdate = () => {
    interleavedMesh.rotationX -= 0.5;
    interleavedMesh.rotationY -= 0.5;
};
stage.addChild(interleavedMesh);
