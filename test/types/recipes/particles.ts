import { PerspectiveCamera, Stage } from 'hilo3d';
import {
    PARTICLE_STAGE_SERVICE,
    ParticleSystemDefinition,
    createParticleStageSystem
} from '@hilo/addon-particle';

/** The caller starts ticking and owns Stage.destroy(); the Stage System owns its particles. */
export async function createParticleScene(container: HTMLElement): Promise<Stage> {
    const stage = await Stage.create({
        backend: 'auto',
        container,
        camera: new PerspectiveCamera({ z: 6 }),
        systems: [createParticleStageSystem()]
    });
    try {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'spark',
                    capacity: 256,
                    execution: 'cpu',
                    emission: { rateOverTime: 40 },
                    initialize: { lifetime: 0.8, speed: 3, size: 0.05 },
                    renderers: [{ type: 'sprite', blend: 'additive' }]
                }
            ]
        });
        stage.systems.get(PARTICLE_STAGE_SERVICE).createSystem({ definition, seed: 42 });
        return stage;
    } catch (error: unknown) {
        stage.destroy();
        throw error;
    }
}
