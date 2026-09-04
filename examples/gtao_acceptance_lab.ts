import { PostProcessRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

await startShowcase({
    pipeline: new PostProcessRenderPipelineFactory({
        groundTruthAmbientOcclusion: { quality: 'low', radius: 1.2, intensity: 1.25 },
        bloom: false
    }),
    antialias: false,
    count: 18
});
