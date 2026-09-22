import {
    PBRMaterial,
    PostProcessRenderPipelineFactory,
    ReflectionProbe,
    ReflectionProbePipelineFactory,
    Vector3
} from 'hilo3d';

/** Unreleased: pass the returned pipeline to Stage.create and use material on a receiver. */
export function localRoomReflections(): {
    readonly probe: ReflectionProbe;
    readonly material: PBRMaterial;
    readonly pipeline: ReflectionProbePipelineFactory;
} {
    const probe = new ReflectionProbe({
        position: new Vector3(0, 2, 0),
        boxMin: new Vector3(-4, -1, -4),
        boxMax: new Vector3(4, 5, 4),
        blendDistance: 0.6
    });
    const material = new PBRMaterial({ reflectionProbes: [probe], metallic: 0.9, roughness: 0.2 });
    const pipeline = new ReflectionProbePipelineFactory({
        probes: [probe],
        resolution: 128,
        facesPerFrame: 1,
        filterLevelsPerFrame: 1,
        pipeline: new PostProcessRenderPipelineFactory({ bloom: false })
    });
    // After a relevant scene/light edit, call probe.requestUpdate(). Stage destruction releases
    // capture targets; materials do not own authored static probe cubemaps.
    return { probe, material, pipeline };
}
