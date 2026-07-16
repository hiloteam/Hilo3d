import Hilo3d = require('hilo3d/umd');

const camera = new Hilo3d.PerspectiveCamera({ z: 3 });
const stageParameters = { camera, width: 320, height: 180 } satisfies Hilo3d.StageParameters;
const stage = new Hilo3d.Stage(stageParameters);
const vector = new Hilo3d.Vector3(1, 2, 3);

void stage;
void vector;
