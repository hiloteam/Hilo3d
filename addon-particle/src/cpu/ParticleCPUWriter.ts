import type { Mesh, Renderer } from 'hilo3d';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan.js';
import type { ParticleRendererDefinition, ParticleVector3 } from '../ParticleTypes.js';
import type { ParticleCPUState } from './ParticleCPUState.js';
import { ParticleCPUInstanceWriter } from './ParticleCPUInstanceWriter.js';
import { ParticleCPUMeshInstanceWriter } from './ParticleCPUMeshInstanceWriter.js';
import { ParticleCPURibbonWriter } from './ParticleCPURibbonWriter.js';

export interface ParticleCPUWriterQuality {
    readonly enabled: boolean;
    readonly sorting: boolean;
    readonly ribbons: boolean;
}

/** Renderer-neutral CPU particle output bridge used by the shared scene collector. @internal */
export interface ParticleCPUWriter {
    readonly mesh: Mesh;
    sync(cameraPosition: ParticleVector3, quality: Readonly<ParticleCPUWriterQuality>): void;
    destroy(renderer: Renderer): void;
}

/** Expand one renderer definition into a bounded number of output buckets. @internal */
export function createParticleCPUWriters(
    plan: Readonly<ParticleCompiledEmitterPlan>,
    state: ParticleCPUState,
    renderer: Readonly<ParticleRendererDefinition>,
    rendererIndex: number
): readonly ParticleCPUWriter[] {
    switch (renderer.type) {
        case 'sprite':
            return Object.freeze([
                new ParticleCPUInstanceWriter(plan, state, renderer, rendererIndex)
            ]);
        case 'mesh':
            return Object.freeze(
                renderer.meshes.map(
                    (_asset, bucketIndex) =>
                        new ParticleCPUMeshInstanceWriter(
                            plan,
                            state,
                            renderer,
                            rendererIndex,
                            bucketIndex
                        )
                )
            );
        case 'ribbon':
        case 'trail':
            return Object.freeze([
                new ParticleCPURibbonWriter(plan, state, renderer, rendererIndex)
            ]);
    }
}
