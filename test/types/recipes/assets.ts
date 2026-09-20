import { GLTFLoader, type Animation, type Node } from 'hilo3d';

/** Load before starting the ticker; the returned model owns the loaded scene/assets. */
export async function loadModel(url: string): Promise<Node> {
    const model = await new GLTFLoader().load({ src: url });
    await model.ready;
    return model.node;
}

/** Manual animation update runs before Stage rendering; do not also enroll automatic ticking. */
export function updateAnimation(animation: Animation, milliseconds: number): void {
    animation.update(Math.min(milliseconds, 50) / 1000);
}
