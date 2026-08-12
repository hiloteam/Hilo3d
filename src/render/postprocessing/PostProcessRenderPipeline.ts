import {
    ForwardRenderPipelineFactory,
    type ForwardRenderPipelineFeature
} from '../pipeline/ForwardRenderPipeline';
import type {
    RenderPipeline,
    RenderPipelineCreateContext,
    RenderPipelineFactory,
    RenderPipelineRequirements
} from '../pipeline/RenderPipeline';
import { Bloom, type BloomOptions } from './Bloom';
import { ColorUber, type ColorUberOptions } from './ColorUber';
import {
    GroundTruthAmbientOcclusion,
    type GroundTruthAmbientOcclusionOptions
} from './GroundTruthAmbientOcclusion';
import { TemporalAA, type TemporalAAOptions } from './TemporalAA';

/** Turnkey HDR forward/post-processing pipeline configuration. */
export interface PostProcessRenderPipelineOptions {
    /** Ground-truth ambient occlusion settings, or false to omit GTAO. */
    readonly groundTruthAmbientOcclusion?: Readonly<GroundTruthAmbientOcclusionOptions> | false;
    /** Temporal anti-aliasing/upscaling settings, or false to omit the temporal pass. */
    readonly temporalAA?: Readonly<TemporalAAOptions> | false;
    /** Bloom settings, or false to omit bloom. Bloom is enabled by default. */
    readonly bloom?: Readonly<BloomOptions> | false;
    /** Final color grading/tone mapping settings. */
    readonly colorUber?: Readonly<ColorUberOptions>;
    /** Capture opaque scene color for transmission and volume. Defaults to true. */
    readonly opaqueTexture?: boolean;
    /** Additional ordered forward features inserted after the built-in features. */
    readonly features?: readonly ForwardRenderPipelineFeature[];
}

/**
 * Turnkey linear-HDR forward pipeline with optional GTAO/TAA, high-quality bloom, Color Uber,
 * and opaque scene color.
 */
export class PostProcessRenderPipelineFactory implements RenderPipelineFactory {
    readonly name = 'post-process-forward';
    readonly requirements: Readonly<RenderPipelineRequirements>;
    readonly #forward: ForwardRenderPipelineFactory;

    constructor(options: Readonly<PostProcessRenderPipelineOptions> = {}) {
        const features: ForwardRenderPipelineFeature[] = [];
        if (
            options.groundTruthAmbientOcclusion !== false &&
            options.groundTruthAmbientOcclusion !== undefined
        ) {
            features.push(new GroundTruthAmbientOcclusion(options.groundTruthAmbientOcclusion));
        }
        if (options.temporalAA !== false && options.temporalAA !== undefined) {
            features.push(new TemporalAA(options.temporalAA));
        }
        if (options.bloom !== false) features.push(new Bloom(options.bloom ?? {}));
        features.push(new ColorUber(options.colorUber ?? {}));
        features.push(...(options.features ?? []));
        this.#forward = new ForwardRenderPipelineFactory({
            sceneColorFormat: 'rgba16float',
            opaqueTexture: options.opaqueTexture ?? true,
            features
        });
        this.requirements = this.#forward.requirements;
    }

    create(context: RenderPipelineCreateContext): RenderPipeline {
        return this.#forward.create(context);
    }
}
