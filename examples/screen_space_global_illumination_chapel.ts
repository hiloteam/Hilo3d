import { PostProcessRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

await startShowcase({
    pipeline: new PostProcessRenderPipelineFactory({
        screenSpaceGlobalIllumination: {
            resolutionScale: 0.5,
            rayCount: 4,
            stepCount: 6,
            intensity: 1.15
        },
        bloom: { intensity: 0.55 }
    }),
    antialias: false,
    count: 24
});
