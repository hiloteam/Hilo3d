import { Bloom, ColorUber, ForwardRenderPipelineFactory } from 'hilo3d';
import { startShowcase } from './shared/showcase';

const pipeline = new ForwardRenderPipelineFactory({
    sceneColorFormat: 'rgba16float',
    opaqueTexture: true,
    features: [
        new Bloom({ threshold: 0.55, intensity: 0.9, scatter: 0.78 }),
        new ColorUber({ exposure: 0.25, saturation: -0.85, contrast: 0.18, toneMapping: 'aces' })
    ]
});

await startShowcase({ pipeline, antialias: false, count: 18 });
