import {
    Color,
    DecalProjector,
    ForwardRenderPipelineFactory,
    Matrix4,
    Mesh,
    PBRMaterial,
    PostProcessRenderPipelineFactory,
    SubsurfaceScatteringProfile,
    type PBRDecalOptions,
    type Texture,
    type WeightedBlendedTransparencyOptions
} from 'hilo3d';

/** Unreleased source API: portable projected surfaces and explicitly opted-in smoke composition. */
export function projectedSurfaces(atlas: Texture): {
    readonly projector: DecalProjector;
    readonly receiver: PBRMaterial;
    readonly smoke: PBRMaterial;
    readonly pipeline: ForwardRenderPipelineFactory;
} {
    const projector = new DecalProjector({ transform: new Matrix4(), layer: 1 });
    const decals: PBRDecalOptions = {
        projectors: [projector],
        baseColorAtlas: atlas,
        receiverMask: 1
    };
    const receiver = new PBRMaterial({ decals, metallic: 0, roughness: 0.8 });
    const smoke = new PBRMaterial({
        compositing: { mode: 'weighted-blended' },
        baseColor: new Color(0.6, 0.7, 0.9, 0.25),
        metallic: 0
    });
    // Transparent smoke is explicitly omitted from solid diffuse GI ray transport.
    new Mesh({ material: smoke, contributeToGlobalIllumination: false });
    const budget: WeightedBlendedTransparencyOptions = { maxPixelCount: 1920 * 1080 };
    const pipeline = new ForwardRenderPipelineFactory({ weightedBlendedTransparency: budget });
    projector.update({ opacity: 0.75 });
    return { projector, receiver, smoke, pipeline };
}

/** Unreleased MAT1: ordinary PBR materials share one portable HDR diffusion pipeline. */
export function clothThinAndSubsurface(): {
    readonly cloth: PBRMaterial;
    readonly thinSheet: PBRMaterial;
    readonly skin: PBRMaterial;
    readonly pipeline: PostProcessRenderPipelineFactory;
} {
    const cloth = new PBRMaterial({
        metallic: 0,
        baseColor: new Color(0.12, 0.02, 0.04),
        sheenColor: new Color(0.8, 0.2, 0.3),
        sheenRoughness: 0.6
    });
    const thinSheet = new PBRMaterial({
        metallic: 0,
        diffuseTransmissionFactor: 0.7,
        diffuseTransmissionColor: new Color(0.3, 0.8, 0.08),
        cullMode: 'none'
    });
    // This radius is in metres when the application's geometry is authored in metres.
    const skin = new PBRMaterial({
        metallic: 0,
        baseColor: new Color(0.65, 0.3, 0.18),
        subsurfaceProfile: new SubsurfaceScatteringProfile({ radius: [0.001, 0.00035, 0.0002] }),
        subsurfaceThickness: 0.003
    });
    const pipeline = new PostProcessRenderPipelineFactory({
        subsurfaceScattering: { sampleCount: 17, maxPixelCount: 1920 * 1080 },
        temporalAA: {},
        bloom: false
    });
    return { cloth, thinSheet, skin, pipeline };
}
