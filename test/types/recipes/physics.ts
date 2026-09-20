import { PerspectiveCamera, Stage, type Mesh } from 'hilo3d';
import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsSystem
} from '@hilo/addon-physics/rapier3d';

/** Use an unscaled, unpivoted mesh. Stage ticking steps physics; do not step it a second time. */
export async function createPhysicsScene(container: HTMLElement, mesh: Mesh): Promise<Stage> {
    const stage = await Stage.create({
        backend: 'auto',
        container,
        camera: new PerspectiveCamera({ z: 8 }),
        systems: [
            createRapier3DPhysicsSystem({
                gravity: { x: 0, y: -9.81, z: 0 },
                fixedTimeStep: 1 / 60,
                maxSubSteps: 4
            })
        ]
    });
    try {
        stage.addChild(mesh);
        const world = stage.systems.get(PHYSICS_WORLD_3D_SERVICE);
        const body = world.createRigidBody({ type: 'dynamic', position: { x: 0, y: 4, z: 0 } });
        world.createCollider({ shape: { type: 'ball', radius: 0.5 }, density: 1 }, body);
        bindNode3D(world, body, mesh);
        return stage;
    } catch (error: unknown) {
        stage.destroy();
        throw error;
    }
}
