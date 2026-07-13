import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = createExampleContext();

const g1 = new Hilo3d.BoxGeometry();

const g2 = new Hilo3d.SphereGeometry({
    radius: 0.5
});

const g3 = new Hilo3d.PlaneGeometry({
    width: 0.6,
    height: 0.6
});

const g4 = new Hilo3d.Geometry();
g4.addFace([-0.5, -0.289, 0], [0, 0.577, 0], [0.5, -0.289, 0]);
g4.addFace([-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0, 0.9]);
g4.addFace([-0.5, -0.289, 0], [0, 0, 0.9], [0, 0.577, 0]);
g4.addFace([0, 0.577, 0], [0, 0, 0.9], [0.5, -0.289, 0]);

const gs = [g1, g2, g3, g4];
const m = new Hilo3d.BasicMaterial({
    diffuse: new Hilo3d.Color(0.4, 0.6, 1),
    side: Hilo3d.constants.FRONT_AND_BACK
});

const g = new Hilo3d.BoxGeometry({
    isStatic: false
});
const mesh = new Hilo3d.Mesh({
    geometry: g,
    material: m
});
stage.addChild(mesh);

let gIndex = 0;
setInterval(function () {
    const targetVertices = g.vertices;
    const targetIndices = g.indices;
    const targetNormals = g.normals;
    const source = gs[gIndex];
    const sourceVertices = source?.vertices;
    const sourceIndices = source?.indices;
    const sourceNormals = source?.normals;
    if (
        !targetVertices ||
        !targetIndices ||
        !targetNormals ||
        !sourceVertices ||
        !sourceIndices ||
        !sourceNormals
    ) {
        throw new Error('Dynamic geometry requires complete vertex, index and normal buffers');
    }
    targetVertices.data = sourceVertices.data;
    targetIndices.data = sourceIndices.data;
    targetNormals.data = sourceNormals.data;
    gIndex += 1;
    if (gIndex >= gs.length) {
        gIndex = 0;
    }
}, 500);
