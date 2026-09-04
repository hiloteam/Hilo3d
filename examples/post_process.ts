import { PostProcessRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

await startShowcase({
    pipeline: new PostProcessRenderPipelineFactory({
        bloom: { intensity: 0.9 },
        colorUber: { exposure: 0.35, contrast: 0.12, saturation: 0.18, vignetteIntensity: 0.28 }
    }),
    antialias: false,
    count: 24
});
