import { describe, expect, it, vi } from 'vitest';
import Node from '../../../src/core/Node';
import type Renderer from '../../../src/render/Renderer';
import type Stage from '../../../src/core/Stage';
import { StageSystemRegistry } from '../../../src/core/StageSystem';
import {
    PARTICLE_STAGE_SERVICE,
    createParticleStageSystem
} from '../../../addon-particle/src/ParticleStageSystem';
import ParticleSystemDefinition from '../../../addon-particle/src/ParticleSystemDefinition';

function createStage(): { readonly stage: Stage; readonly destroyMesh: ReturnType<typeof vi.fn> } {
    const stageNode = new Node();
    const destroyMesh = vi.fn();
    const renderer = {
        backend: 'webgl2',
        resourceManager: { destroyMesh }
    } as unknown as Renderer;
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
                name: 'system-owned',
                capacity: 8,
                execution: 'cpu',
                emission: { rateOverTime: 1 },
                initialize: { lifetime: 1, size: 0.1 },
                renderers: [{ type: 'sprite' }]
            }
        ]
    });
}

describe('particle Stage System', () => {
    it('publishes a typed runtime and destroys managed render bridges before renderer teardown', async () => {
        const { stage, destroyMesh } = createStage();
        const registry = new StageSystemRegistry(stage);
        await registry.initialize([createParticleStageSystem({ budget: false })]);

        const runtime = registry.get(PARTICLE_STAGE_SERVICE);
        const system = runtime.createSystem({ definition: definition() });
        expect(system.compilationBackend).toBe('webgl2');
        expect(system.parent).toBe(stage);
        expect(runtime.systems).toEqual([system]);

        registry.destroy();
        expect(system.parent).toBeNull();
        expect(destroyMesh).toHaveBeenCalledOnce();
        expect(registry.getOptional(PARTICLE_STAGE_SERVICE)).toBeUndefined();
    });

    it('rejects parents outside the owning Stage tree', async () => {
        const { stage } = createStage();
        const registry = new StageSystemRegistry(stage);
        await registry.initialize([createParticleStageSystem({ budget: false })]);
        const runtime = registry.get(PARTICLE_STAGE_SERVICE);

        expect(() => runtime.createSystem({ definition: definition() }, new Node())).toThrow(
            'below their owning Stage'
        );
        expect(runtime.systems).toHaveLength(0);
        registry.destroy();
    });

    it('rejects a compilation backend that conflicts with the owning Stage', async () => {
        const { stage } = createStage();
        const registry = new StageSystemRegistry(stage);
        await registry.initialize([createParticleStageSystem({ budget: false })]);

        expect(() =>
            registry.get(PARTICLE_STAGE_SERVICE).createSystem({
                definition: definition(),
                compilationEnvironment: { backend: 'webgpu' }
            })
        ).toThrow('conflicts with owning Stage backend webgl2');
        registry.destroy();
    });
});
