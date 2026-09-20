import { PostProcessRenderPipelineFactory } from 'hilo3d';

/** Pass this factory as Stage.create({ renderPipeline: ... }); both backends are supported. */
export function portablePostProcessing(): PostProcessRenderPipelineFactory {
    return new PostProcessRenderPipelineFactory({
        bloom: { intensity: 0.8 },
        colorUber: { exposure: 0, toneMapping: 'filmic', filmicSlope: 1 }
    });
}

/** Auto exposure requires WebGPU; explicit WebGL2 creation must fail instead of emulating it. */
export function webGPUExposure(): PostProcessRenderPipelineFactory {
    return new PostProcessRenderPipelineFactory({
        autoExposure: {},
        bloom: { intensity: 0.8 },
        colorUber: { exposure: 0, toneMapping: 'filmic' }
    });
}
