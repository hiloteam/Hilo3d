import { Class, Vector3, version } from 'hilo3d';

const vector = new Vector3(1, 2, 3);
const RuntimeVector = Class.create<typeof Vector3>()({
    constructor(x = 0, y = 0, z = 0) {
        this.elements = new Float32Array([x, y, z]);
    }
});
const runtimeVector = new RuntimeVector(1, 2, 3);

vector.copy(runtimeVector);
version satisfies string;

export {};
