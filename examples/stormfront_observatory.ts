import { PostProcessRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

await startShowcase({
    pipeline: new PostProcessRenderPipelineFactory({
        bloom: { threshold: 0.7, intensity: 0.75 },
        colorUber: { exposure: -0.2, contrast: 0.22, temperature: -0.15, toneMapping: 'aces' }
    }),
    antialias: false,
    count: 6
});
