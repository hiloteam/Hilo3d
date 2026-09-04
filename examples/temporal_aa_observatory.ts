import { PostProcessRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

await startShowcase({
    pipeline: new PostProcessRenderPipelineFactory({
        temporalAA: { renderScale: 0.75, historyWeight: 0.9, sharpness: 0.12 },
        bloom: { intensity: 0.35 }
    }),
    antialias: false,
    count: 24
});
