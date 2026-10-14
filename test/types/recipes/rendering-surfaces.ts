import {
    Color,
    DecalProjector,
    ForwardRenderPipelineFactory,
    Matrix4,
    Mesh,
    PBRMaterial,
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
