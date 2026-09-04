import { PostProcessRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

await startShowcase({
    pipeline: new PostProcessRenderPipelineFactory({
        bloom: { threshold: 0.45, intensity: 1.35, scatter: 0.82 },
        colorUber: { exposure: 0.65, toneMapping: 'aces' }
    }),
    antialias: false,
    count: 24
});
