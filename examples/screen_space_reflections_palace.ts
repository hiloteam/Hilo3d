import { PostProcessRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

await startShowcase({
    pipeline: new PostProcessRenderPipelineFactory({
        temporalAA: { historyWeight: 0.9, sharpness: 0.08 },
        bloom: { intensity: 0.45 },
        colorUber: { contrast: 0.18, toneMapping: 'aces' }
    }),
    antialias: false,
    count: 24
});
