import { Matrix4, type Node } from 'hilo3d';
import { validatePose } from './internal.js';
import type { AudioPose, AudioTransform } from './types.js';

/** Current local-to-world pose without traversing the scene or allocating matrices each frame. */
export class HiloAudioTransform implements AudioTransform {
    private readonly matrix = new Matrix4();

    constructor(readonly node: Node) {}

    /** Sample the node and its ancestors, including transforms changed before rendering this frame. */
    readAudioPose(target: AudioPose): void {
        this.matrix.identity();
        let current: Node | null = this.node;
        while (current) {
            if (!current.parent || !current.__forceUseParentWorldMatrix)
                this.matrix.multiply(current.matrix, this.matrix);
            current = current.parent;
        }
        const m = this.matrix.elements;
        target.x = m[12];
        target.y = m[13];
        target.z = m[14];
        target.forwardX = -m[8];
        target.forwardY = -m[9];
        target.forwardZ = -m[10];
        target.upX = m[4];
        target.upY = m[5];
        target.upZ = m[6];
        validatePose(target);
    }
}
