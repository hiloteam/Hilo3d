import { describe, expect, it, vi } from 'vitest';
import Node from '../../../src/core/Node';
import type Renderer from '../../../src/render/Renderer';
import type Stage from '../../../src/core/Stage';
import { StagePluginHost } from '../../../src/core/StagePlugin';
import {
    PARTICLE_STAGE_SERVICE,
    createParticleStagePlugin
} from '../../../addon-particle/src/ParticleStagePlugin';
import ParticleSystemDefinition from '../../../addon-particle/src/ParticleSystemDefinition';

function createStage(): { readonly stage: Stage; readonly destroyMesh: ReturnType<typeof vi.fn> } {
    const stageNode = new Node();
    const destroyMesh = vi.fn();
    const renderer = { resourceManager: { destroyMesh } } as unknown as Renderer;
    Object.defineProperties(stageNode, {
        isStage: { value: true },
        cameras: { value: Object.freeze([]) },
        camera: { value: null },
        renderer: { value: renderer }
    });
    return { stage: stageNode as unknown as Stage, destroyMesh };
}

function definition(): ParticleSystemDefinition {
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'plugin-owned',
                capacity: 8,
                execution: 'cpu',
                emission: { rateOverTime: 1 },
                initialize: { lifetime: 1, size: 0.1 },
                renderers: [{ type: 'sprite' }]
            }
        ]
    });
}

describe('particle Stage plugin', () => {
    it('publishes a typed runtime and destroys managed render bridges before renderer teardown', async () => {
        const { stage, destroyMesh } = createStage();
        const host = new StagePluginHost(stage);
        await host.initialize([createParticleStagePlugin({ budget: false })]);

        const runtime = host.get(PARTICLE_STAGE_SERVICE);
        const system = runtime.createSystem({ definition: definition() });
        expect(system.parent).toBe(stage);
        expect(runtime.systems).toEqual([system]);

        host.destroy();
        expect(system.parent).toBeNull();
        expect(destroyMesh).toHaveBeenCalledOnce();
        expect(host.getOptional(PARTICLE_STAGE_SERVICE)).toBeUndefined();
    });

    it('rejects parents outside the owning Stage tree', async () => {
        const { stage } = createStage();
        const host = new StagePluginHost(stage);
        await host.initialize([createParticleStagePlugin({ budget: false })]);
        const runtime = host.get(PARTICLE_STAGE_SERVICE);

        expect(() => runtime.createSystem({ definition: definition() }, new Node())).toThrow(
            'below their owning Stage'
        );
        expect(runtime.systems).toHaveLength(0);
        host.destroy();
    });
});
