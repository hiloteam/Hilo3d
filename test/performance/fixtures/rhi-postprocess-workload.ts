import type PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import ShaderMaterial from '../../../src/material/ShaderMaterial';
import type { RendererFrame } from '../../../src/render/RendererCore';
import { RenderWorld } from '../../../src/render/world/RenderWorld';
import { TransformStore } from '../../../src/scene/components/Transform';
import type { RenderTarget, RenderTargetParameters } from '../../../src/render/RenderTarget';
import type Texture from '../../../src/texture/Texture';

export const MRT_MSAA_POSTPROCESS_EFFECT_PASS_COUNT = 3;
export const MRT_MSAA_POSTPROCESS_FULLSCREEN_STATE = Object.freeze({
    depthTest: false,
    depthWrite: false,
    cullMode: 'none' as const
});

export const MRT_MSAA_POSTPROCESS_VERTEX_SOURCE = `#version 300 es
    in vec3 a_position;
    out vec2 v_uv;
    void main() {
        v_uv = a_position.xy * 0.5 + 0.5;
        gl_Position = vec4(a_position, 1.0);
    }`;

export const MRT_MSAA_POSTPROCESS_COMBINE_FRAGMENT_SOURCE = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_mrt0;
    uniform sampler2D u_mrt1;
    uniform sampler2D u_mrt2;
    uniform sampler2D u_mrt3;
    layout(location = 0) out vec4 color;
    void main() {
        color = 0.25 * (
            texture(u_mrt0, v_uv) +
            texture(u_mrt1, v_uv) +
            texture(u_mrt2, v_uv) +
            texture(u_mrt3, v_uv)
        );
    }`;

export const MRT_MSAA_POSTPROCESS_SWIZZLE_FRAGMENT_SOURCE = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_source;
    layout(location = 0) out vec4 color;
    void main() {
        vec4 source = texture(u_source, v_uv);
        color = vec4(source.gbr, source.a);
    }`;

export const MRT_MSAA_POSTPROCESS_FINAL_FRAGMENT_SOURCE = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_source;
    layout(location = 0) out vec4 color;
    void main() {
        vec4 source = texture(u_source, v_uv);
        color = vec4(source.brg, source.a);
    }`;

interface RenderTargetFactory {
    createRenderTarget(parameters: RenderTargetParameters): RenderTarget;
}

export interface MRTMSAAPostProcessPass {
    readonly inputTextures: readonly Texture<unknown>[];
    readonly output: RenderTarget | null;
    readonly stage: RenderWorld;
    readonly mesh: Mesh;
    readonly material: ShaderMaterial;
}

export interface MRTMSAAPostProcessWorkload {
    readonly source: RenderTarget;
    readonly passes: readonly [
        MRTMSAAPostProcessPass,
        MRTMSAAPostProcessPass,
        MRTMSAAPostProcessPass
    ];
}

export function mrtMSAAPostProcessSourceTargetParameters(
    width: number,
    height: number
): RenderTargetParameters {
    return {
        width,
        height,
        sampleCount: 4,
        colorAttachments: Array.from({ length: 4 }, (_, index) => ({
            format: 'rgba8unorm' as const,
            clearValue: { r: index * 0.02, g: 0.03, b: 0.05, a: 1 }
        })),
        // The fullscreen MRT workload neither reads nor writes depth. Omitting it also lets the
        // shared renderer keep discard-only multisampled attachments graph-transient.
        depthStencilAttachment: false,
        label: 'mrt-msaa-postprocess benchmark target'
    };
}

export function mrtMSAAPostProcessPrimaryDrawCount(totalDrawCount: number): number {
    if (!Number.isSafeInteger(totalDrawCount) || totalDrawCount < 1) {
        throw new RangeError('MRT/MSAA total draw count must be a positive safe integer');
    }
    const primaryDrawCount = totalDrawCount - MRT_MSAA_POSTPROCESS_EFFECT_PASS_COUNT;
    if (primaryDrawCount < 1) {
        throw new RangeError('MRT/MSAA workload has no primary draws after post-process draws');
    }
    return primaryDrawCount;
}

function fullscreenGeometry(): Geometry {
    return new Geometry({
        vertices: new GeometryData(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    });
}

function createMRTMSAAPostProcessPass(
    index: number,
    inputTextures: readonly Texture<unknown>[],
    output: RenderTarget | null,
    fragmentSource: string
): MRTMSAAPostProcessPass {
    const isMRTCombine = index === 0;
    if (isMRTCombine ? inputTextures.length !== 4 : inputTextures.length !== 1) {
        throw new TypeError(
            isMRTCombine
                ? 'The first post-process pass must sample all four MRT attachments'
                : 'A post-process continuation pass must sample exactly one prior output'
        );
    }
    const material = new ShaderMaterial({
        sourceRevision: `rhi-benchmark-mrt-post-process-${String(index)}`,
        state: MRT_MSAA_POSTPROCESS_FULLSCREEN_STATE,
        attributes: { a_position: 'POSITION' },
        uniforms: isMRTCombine
            ? {
                  u_mrt0: { get: () => inputTextures[0] },
                  u_mrt1: { get: () => inputTextures[1] },
                  u_mrt2: { get: () => inputTextures[2] },
                  u_mrt3: { get: () => inputTextures[3] }
              }
            : { u_source: { get: () => inputTextures[0] } },
        vs: MRT_MSAA_POSTPROCESS_VERTEX_SOURCE,
        fs: fragmentSource
    });
    const sourceMesh = new Mesh({
        geometry: fullscreenGeometry(),
        material,
        frustumTest: false
    });
    const transforms = new TransformStore(1, 1);
    transforms.add(0, {});
    transforms.updateWorldMatrices();
    const stage = new RenderWorld(1, 1);
    const geometry = sourceMesh.geometry;
    if (!geometry) throw new Error('Post-process geometry is missing.');
    stage.add(
        0,
        {
            geometry,
            material,
            frustumTest: false,
            castShadows: false,
            receiveShadows: false
        },
        undefined,
        undefined,
        transforms
    );
    const mesh = stage.meshForEntity(0);
    if (!mesh) throw new Error('Post-process RenderWorld mesh view is missing.');
    return Object.freeze({
        inputTextures,
        output,
        stage,
        mesh,
        material
    });
}

/** Build three real effect targets whose shader inputs form source -> A -> B -> C. */
export function createMRTMSAAPostProcessWorkload(
    renderer: RenderTargetFactory,
    source: RenderTarget,
    width: number,
    height: number
): MRTMSAAPostProcessWorkload {
    if (source.sampleCount !== 4 || source.colorAttachmentCount !== 4) {
        throw new TypeError('MRT/MSAA post-process source must have four colors and four samples');
    }
    const outputs: RenderTarget[] = [];
    try {
        for (let index = 0; index < MRT_MSAA_POSTPROCESS_EFFECT_PASS_COUNT - 1; index += 1) {
            outputs.push(
                renderer.createRenderTarget({
                    width,
                    height,
                    sampleCount: 1,
                    colorAttachments: [
                        {
                            format: 'rgba8unorm',
                            clearValue: { r: 0, g: 0, b: 0, a: 1 }
                        }
                    ],
                    depthStencilAttachment: false,
                    label: `mrt-msaa-postprocess intermediate ${String(index)}`
                })
            );
        }
        const firstOutput = outputs[0];
        const secondOutput = outputs[1];
        if (!firstOutput || !secondOutput) {
            throw new Error('MRT/MSAA post-process target creation is incomplete');
        }
        const firstInputs = Object.freeze([
            source.getColorTexture(0),
            source.getColorTexture(1),
            source.getColorTexture(2),
            source.getColorTexture(3)
        ]);
        const secondInputs = Object.freeze([firstOutput.getColorTexture(0)]);
        const thirdInputs = Object.freeze([secondOutput.getColorTexture(0)]);
        const passes: MRTMSAAPostProcessWorkload['passes'] = Object.freeze([
            createMRTMSAAPostProcessPass(
                0,
                firstInputs,
                firstOutput,
                MRT_MSAA_POSTPROCESS_COMBINE_FRAGMENT_SOURCE
            ),
            createMRTMSAAPostProcessPass(
                1,
                secondInputs,
                secondOutput,
                MRT_MSAA_POSTPROCESS_SWIZZLE_FRAGMENT_SOURCE
            ),
            createMRTMSAAPostProcessPass(
                2,
                thirdInputs,
                null,
                MRT_MSAA_POSTPROCESS_FINAL_FRAGMENT_SOURCE
            )
        ]);
        return Object.freeze({ source, passes });
    } catch (error) {
        for (const output of outputs) output.destroy();
        throw error;
    }
}

/** Record one source pass, two intermediate effects, and a third effect directly to the surface. */
export function recordMRTMSAAPostProcessWorkload(
    frame: Pick<RendererFrame, 'render' | 'renderToTarget'>,
    workload: Readonly<MRTMSAAPostProcessWorkload>,
    sourceStage: RenderWorld,
    camera: PerspectiveCamera
): void {
    frame.renderToTarget(workload.source, sourceStage, camera, false);
    const first = workload.passes[0];
    const second = workload.passes[1];
    if (first.output === null || second.output === null) {
        throw new Error('MRT/MSAA post-process intermediate output is missing');
    }
    frame.renderToTarget(first.output, first.stage, camera, false);
    frame.renderToTarget(second.output, second.stage, camera, false);
    frame.render(workload.passes[2].stage, camera, false);
}
