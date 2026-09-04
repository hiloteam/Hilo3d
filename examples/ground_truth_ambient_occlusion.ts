import { PostProcessRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

await startShowcase({
    pipeline: new PostProcessRenderPipelineFactory({
        groundTruthAmbientOcclusion: { quality: 'medium', radius: 1.6, intensity: 1.15 },
        bloom: false
    }),
    antialias: false,
    count: 24
});
