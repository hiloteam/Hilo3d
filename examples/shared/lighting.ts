import * as Hilo3d from '../../src/Hilo3d';

/** Keeps bright reflections in HDR until the example's final display transform. */
export function createExampleRenderPipeline(): Hilo3d.ForwardRenderPipelineFactory {
    return new Hilo3d.ForwardRenderPipelineFactory({
        sceneColorFormat: 'rgba16float',
        features: [new Hilo3d.ColorUber({ toneMapping: 'pbr-neutral', exposure: -0.15 })]
    });
}

/** A warm key and restrained sky fill shared by the introductory examples. */
export function createExampleLights(): {
    readonly directionLight: Hilo3d.DirectionalLight;
    readonly ambientLight: Hilo3d.AmbientLight;
} {
    return {
        directionLight: new Hilo3d.DirectionalLight({
            color: new Hilo3d.Color(1, 0.93, 0.82),
            amount: 2,
            direction: new Hilo3d.Vector3(-0.7, -1, -0.35)
        }),
        ambientLight: new Hilo3d.AmbientLight({
            color: new Hilo3d.Color(0.72, 0.82, 1),
            amount: 0.28
        })
    };
}
