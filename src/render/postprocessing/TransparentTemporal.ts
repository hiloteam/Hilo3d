import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Shader from '../../shader/Shader';
import type { RenderPipelineContext } from '../pipeline/RenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import { FullscreenRenderPass, type FullscreenRenderPassParameters } from '../pipeline/passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import { depthClearValue } from '../renderer/DepthConvention';
import type {
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    RenderPipelineExtent,
    RenderPipelineTextureDescriptor
} from '../pipeline/ScriptableRenderGraph';

const OUTPUT_EXTENT: RenderPipelineExtent = Object.freeze({
    relativeTo: 'output',
    scale: 1
});
const ZERO = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

const CLEAR_MASK_FRAGMENT = `#version 300 es
precision highp float;
layout(location = 0) out float mask;
void main() { mask = 0.0; }`;

const FORCE_REACTIVE_FRAGMENT = `#version 300 es
precision highp float;
layout(location = 0) out float mask;
void main() { mask = 1.0; }`;

const CLEAR_COLOR_FRAGMENT = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() { color = vec4(0.0); }`;

const UPSAMPLE_DEPTH_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sceneDepth;
layout(location = 0) out float scratch;
void main() {
    scratch = 0.0;
    gl_FragDepth = texture(u_sceneDepth, v_uv).r;
}`;

const COMBINE_REACTIVE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_authoredReactive;
uniform sampler2D u_transparentReactive;
layout(location = 0) out float combinedReactive;
void main() {
    combinedReactive = max(
        texture(u_authoredReactive, v_uv).r,
        texture(u_transparentReactive, v_uv).r
    );
}`;

const COMPOSITE_PARTICLE_COLOR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_particles;
layout(location = 0) out vec4 compositedScene;
void main() {
    vec4 scene = texture(u_scene, v_uv);
    vec4 particles = texture(u_particles, v_uv);
    float particleAlpha = clamp(particles.a, 0.0, 1.0);
    compositedScene = vec4(
        particles.rgb + scene.rgb * (1.0 - particleAlpha),
        particleAlpha + scene.a * (1.0 - particleAlpha)
    );
}`;

const COMPOSITE_PARTICLE_MASK_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_particles;
layout(location = 0) out float compositedMask;
void main() {
    vec4 particles = texture(u_particles, v_uv);
    float particleCoverage = max(particles.a, max(particles.r, max(particles.g, particles.b)));
    compositedMask = step(1.0 / 255.0, particleCoverage);
}`;

const INITIALIZE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_sceneDepth;
uniform sampler2D u_currentMask;
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyMask;
layout(location = 3) out float historyDepth;
void main() {
    vec4 current = texture(u_scene, v_uv);
    historyColor = current;
    resolvedColor = current;
    historyMask = texture(u_currentMask, v_uv).r;
    historyDepth = texture(u_sceneDepth, v_uv).r;
}`;

const RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_sceneDepth;
uniform sampler2D u_currentMask;
uniform sampler2D u_historyColor;
uniform sampler2D u_historyDepth;
uniform sampler2D u_historyMask;
layout(location = 0) out vec4 nextHistoryColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float nextHistoryMask;
layout(location = 3) out float nextHistoryDepth;

float dilatedCurrentMask(vec2 uv) {
    ivec2 dimensions = textureSize(u_currentMask, 0);
    ivec2 pixel = clamp(ivec2(uv * vec2(dimensions)), ivec2(0), dimensions - ivec2(1));
    float value = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 coordinate = clamp(pixel + ivec2(x, y), ivec2(0), dimensions - ivec2(1));
            value = max(value, texelFetch(u_currentMask, coordinate, 0).r);
        }
    }
    return value;
}

void main() {
    vec4 current = texture(u_scene, v_uv);
    float currentDepth = texture(u_sceneDepth, v_uv).r;
    float currentMask = dilatedCurrentMask(v_uv);
    float previousMask = textureLod(u_historyMask, v_uv, 0.0).r;
    float previousDepth = textureLod(u_historyDepth, v_uv, 0.0).r;
    float depthAgreement = abs(previousDepth - currentDepth) <= 0.0025 ? 1.0 : 0.0;
    float resurrectedMask = previousMask * (1.0 - currentMask) * depthAgreement * 0.45;
    float resurrectionWeight = resurrectedMask * 0.35;
    vec4 previous = textureLod(u_historyColor, v_uv, 0.0);
    vec4 resolved = mix(current, previous, resurrectionWeight);
    nextHistoryColor = resolved;
    resolvedColor = resolved;
    nextHistoryMask = max(currentMask, resurrectedMask);
    nextHistoryDepth = currentDepth;
}`;

interface MutableColorAttachment extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
}

class FullscreenParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: MutableColorAttachment[] = [];
    depthStencilAttachment?: Readonly<RenderPipelineDepthStencilAttachment>;

    reset(): void {
        this.inputTextures.length = 0;
        this.colorAttachments.length = 0;
        delete this.depthStencilAttachment;
    }
}

function fullscreenPass(
    name: string,
    fragmentSource: string,
    depthWrite = false
): FullscreenRenderPass {
    return new FullscreenRenderPass({
        name,
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: fragmentSource
        }),
        pipelineState: Object.freeze({
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite,
            cullMode: 'none' as const
        })
    });
}

/** @internal Output-resolution, submission-owned short history for transparent resurrection. */
export class TransparentTemporalController {
    readonly #maskExtent = { relativeTo: 'output' as const, scale: 1 };
    readonly #maskDescriptor: Readonly<RenderPipelineTextureDescriptor> = {
        format: 'r8unorm',
        extent: this.#maskExtent
    };
    readonly #resolvedDescriptor: Readonly<RenderPipelineTextureDescriptor> = {
        format: 'rgba16float',
        extent: OUTPUT_EXTENT
    };
    readonly #outputMaskDescriptor: Readonly<RenderPipelineTextureDescriptor> = {
        format: 'r8unorm',
        extent: OUTPUT_EXTENT
    };
    readonly #outputDepthDescriptor: Readonly<RenderPipelineTextureDescriptor> = {
        format: 'depth32float',
        extent: OUTPUT_EXTENT
    };
    readonly #colorHistoryDescriptor = Object.freeze({
        label: 'Transparent resurrection color history',
        format: 'rgba16float' as const,
        extent: OUTPUT_EXTENT,
        usage: Object.freeze(['sampled' as const, 'attachment' as const]),
        bufferCount: 2 as const
    });
    readonly #maskHistoryDescriptor = Object.freeze({
        label: 'Transparent resurrection coverage history',
        format: 'r8unorm' as const,
        extent: OUTPUT_EXTENT,
        usage: Object.freeze(['sampled' as const, 'attachment' as const]),
        bufferCount: 2 as const
    });
    readonly #depthHistoryDescriptor = Object.freeze({
        label: 'Transparent resurrection depth history',
        format: 'r32float' as const,
        extent: OUTPUT_EXTENT,
        usage: Object.freeze(['sampled' as const, 'attachment' as const]),
        bufferCount: 2 as const
    });
    readonly #colorHistoryKey = Object.freeze({});
    readonly #maskHistoryKey = Object.freeze({});
    readonly #depthHistoryKey = Object.freeze({});
    readonly #clearMaskPass = fullscreenPass(
        'Transparent temporal coverage clear',
        CLEAR_MASK_FRAGMENT
    );
    readonly #forceReactivePass = fullscreenPass(
        'Opaque particle conservative temporal reactive coverage',
        FORCE_REACTIVE_FRAGMENT
    );
    readonly #clearParticleOverlayPass = fullscreenPass(
        'Transparent GPU particle overlay clear',
        CLEAR_COLOR_FRAGMENT
    );
    readonly #upsampleParticleDepthPass = fullscreenPass(
        'Transparent GPU particle output-depth reconstruction',
        UPSAMPLE_DEPTH_FRAGMENT,
        true
    );
    readonly #combineReactivePass = fullscreenPass(
        'Transparent reactive coverage merge',
        COMBINE_REACTIVE_FRAGMENT
    );
    readonly #initializePass = fullscreenPass(
        'Transparent temporal history initialize',
        INITIALIZE_FRAGMENT
    );
    readonly #resolvePass = fullscreenPass(
        'Transparent transmission and particle resurrection',
        RESOLVE_FRAGMENT
    );
    readonly #compositeParticleColorPass = fullscreenPass(
        'Transparent GPU particle temporal composition',
        COMPOSITE_PARTICLE_COLOR_FRAGMENT
    );
    readonly #compositeParticleMaskPass = fullscreenPass(
        'Transparent GPU particle resurrection coverage',
        COMPOSITE_PARTICLE_MASK_FRAGMENT
    );
    readonly #parameters = new RenderPassParameterPool(
        () => new FullscreenParameters(),
        parameters => {
            parameters.reset();
        }
    );
    #destroyed = false;

    createCurrentMask(
        context: RenderPipelineContext,
        renderScale: number
    ): RenderGraphTextureHandle {
        if (this.#destroyed) throw new Error('Transparent temporal controller is destroyed');
        this.#maskExtent.scale = renderScale;
        const mask = context.graph.createTexture(
            'Transparent transmission and particle current coverage',
            this.#maskDescriptor
        );
        const clear = context.acquirePassParameters(this.#parameters);
        clear.colorAttachments[0] = {
            texture: mask,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: ZERO
        };
        context.graph.addPass(this.#clearMaskPass, clear);
        return mask;
    }

    combineReactive(
        context: RenderPipelineContext,
        authoredReactive: RenderGraphTextureHandle,
        transparentReactive: RenderGraphTextureHandle
    ): RenderGraphTextureHandle {
        const combined = context.graph.createTexture(
            'Combined opaque and transparent temporal reactive mask',
            this.#maskDescriptor
        );
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.inputTextures.push(authoredReactive, transparentReactive);
        parameters.colorAttachments[0] = {
            texture: combined,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: ZERO
        };
        context.graph.addPass(this.#combineReactivePass, parameters);
        return combined;
    }

    forceReactive(context: RenderPipelineContext, reactiveMask: RenderGraphTextureHandle): void {
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.colorAttachments[0] = {
            texture: reactiveMask,
            loadOp: 'load',
            storeOp: 'store'
        };
        context.graph.addPass(this.#forceReactivePass, parameters);
    }

    createParticleOverlay(context: RenderPipelineContext): RenderGraphTextureHandle {
        const overlay = context.graph.createTexture(
            'Transparent GPU particle output-resolution overlay',
            this.#resolvedDescriptor
        );
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.colorAttachments[0] = {
            texture: overlay,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: ZERO
        };
        context.graph.addPass(this.#clearParticleOverlayPass, parameters);
        return overlay;
    }

    createParticleDepth(
        context: RenderPipelineContext,
        resolvedDepth: RenderGraphTextureHandle
    ): RenderGraphTextureHandle {
        const scratch = context.graph.createTexture(
            'Transparent GPU particle depth reconstruction scratch',
            this.#outputMaskDescriptor
        );
        const depth = context.graph.createTexture(
            'Transparent GPU particle output-resolution depth',
            this.#outputDepthDescriptor
        );
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.inputTextures.push(resolvedDepth);
        parameters.colorAttachments.push({
            texture: scratch,
            loadOp: 'clear',
            storeOp: 'discard',
            clearValue: ZERO
        });
        parameters.depthStencilAttachment = {
            texture: depth,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: depthClearValue(context.camera.depthMode)
        };
        context.graph.addPass(this.#upsampleParticleDepthPass, parameters);
        return depth;
    }

    createParticleMask(
        context: RenderPipelineContext,
        particles: RenderGraphTextureHandle
    ): RenderGraphTextureHandle {
        const mask = context.graph.createTexture(
            'Transparent GPU particle resurrection coverage',
            this.#outputMaskDescriptor
        );
        const maskParameters = context.acquirePassParameters(this.#parameters);
        maskParameters.inputTextures.push(particles);
        maskParameters.colorAttachments.push({
            texture: mask,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: ZERO
        });
        context.graph.addPass(this.#compositeParticleMaskPass, maskParameters);
        return mask;
    }

    compositeParticles(
        context: RenderPipelineContext,
        scene: RenderGraphTextureHandle,
        particles: RenderGraphTextureHandle
    ): RenderGraphTextureHandle {
        const color = context.graph.createTexture(
            'Transparent GPU particle composited HDR scene',
            this.#resolvedDescriptor
        );
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.inputTextures.push(scene, particles);
        parameters.colorAttachments.push({
            texture: color,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: ZERO
        });
        context.graph.addPass(this.#compositeParticleColorPass, parameters);
        return color;
    }

    resolve(
        context: RenderPipelineContext,
        scene: RenderGraphTextureHandle,
        sceneDepth: RenderGraphTextureHandle,
        currentMask: RenderGraphTextureHandle,
        historyValid: boolean
    ): RenderGraphTextureHandle {
        if (!historyValid) {
            context.graph.invalidateHistoryTexture(this.#colorHistoryKey);
            context.graph.invalidateHistoryTexture(this.#maskHistoryKey);
            context.graph.invalidateHistoryTexture(this.#depthHistoryKey);
        }
        const colorHistory = context.graph.acquireHistoryTexture(
            this.#colorHistoryKey,
            this.#colorHistoryDescriptor
        );
        const maskHistory = context.graph.acquireHistoryTexture(
            this.#maskHistoryKey,
            this.#maskHistoryDescriptor
        );
        const depthHistory = context.graph.acquireHistoryTexture(
            this.#depthHistoryKey,
            this.#depthHistoryDescriptor
        );
        if (
            colorHistory.generation !== maskHistory.generation ||
            colorHistory.generation !== depthHistory.generation ||
            colorHistory.valid !== maskHistory.valid ||
            colorHistory.valid !== depthHistory.valid
        ) {
            throw new Error('Transparent temporal history generations diverged');
        }
        const resolved = context.graph.createTexture(
            'Transparent temporally resurrected HDR scene',
            this.#resolvedDescriptor
        );
        const valid = historyValid && colorHistory.valid;
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.inputTextures.push(scene, sceneDepth, currentMask);
        if (valid) {
            parameters.inputTextures.push(
                colorHistory.history(),
                depthHistory.history(),
                maskHistory.history()
            );
        }
        parameters.colorAttachments.push(
            {
                texture: colorHistory.current,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: ZERO
            },
            {
                texture: resolved,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: ZERO
            },
            {
                texture: maskHistory.current,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: ZERO
            },
            {
                texture: depthHistory.current,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: ZERO
            }
        );
        context.graph.addPass(valid ? this.#resolvePass : this.#initializePass, parameters);
        return resolved;
    }

    destroy(): void {
        this.#destroyed = true;
    }
}
