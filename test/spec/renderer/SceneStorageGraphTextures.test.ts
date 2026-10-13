import { describe, expect, it, vi } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';
import Shader from '../../../src/shader/Shader';
const portableCoordinates =
    Object.values(
        import.meta.glob<string>('../../../src/shader/method/portableCoordinates.glsl', {
            eager: true,
            query: '?raw',
            import: 'default'
        })
    )[0] ?? '';
import Renderer from '../../../src/render/Renderer';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ComputeSamplerResourceCache } from '../../../src/render/renderer/ComputeSamplerResourceCache';
import type {
    RenderGraphPassHandle,
    ScriptableRenderPass
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';
import ComputeSampler from '../../../src/render/compute/ComputeSampler';
import StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import {
    FullscreenRenderPass,
    PresentRenderPass
} from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import { SceneRenderPass } from '../../../src/render/pipeline/passes/SceneRenderPass';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';

class GraphTextureScene implements RenderPipeline {
    readonly name = 'Graph texture in storage scene';
    readonly source = new FullscreenRenderPass({
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
layout(location=0) out vec4 color;
void main() { color = vec4(step(0.6, v_uv.y), step(0.3, v_uv.x), step(v_uv.y, 0.25), 1.0); }`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
    readonly present = new PresentRenderPass();
    readonly scenePass = new SceneRenderPass();
    readonly shader = new StorageGraphicsShader({
        vertexSource: `#version 310 es
precision highp float;
in vec3 a_position;
out vec2 v_uv;
${portableCoordinates}
void main() { gl_Position = vec4(a_position, 1.0); v_uv = hiloRenderTargetUV(a_position.xy * 0.5 + 0.5); }`,
        fragmentSource: `#version 310 es
precision highp float;
in vec2 v_uv;
layout(std430) readonly buffer ValuesBlock { vec4 value; } values;
uniform sampler2D u_sceneEffect;
layout(location=0) out vec4 color;
void main() {
    // Vertex-stage normalization is the sole managed render-target UV boundary.
    color = texture(u_sceneEffect, v_uv) * values.value;
}`,
        bindings: [
            {
                name: 'values',
                group: 3,
                binding: 0,
                kind: 'read-only-storage-buffer',
                minBindingSize: 16
            },
            {
                name: 'u_sceneEffect',
                group: 3,
                binding: 8,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            { name: 'u_sceneEffect', group: 3, binding: 9, kind: 'sampler' }
        ]
    });
    readonly sampler = new ComputeSampler({ minFilter: 'nearest', magFilter: 'nearest' });
    readonly comparison = new ComputeSampler({ compare: 'less' });
    readonly buffer: StorageBuffer;
    useScene = true;
    failPrepare = false;
    readonly failure: ScriptableRenderPass<{ dependency: RenderGraphPassHandle }> = {
        name: 'discard after sampled scene preparation',
        setup(builder, parameters): void {
            builder.dependsOn(parameters.dependency);
            builder.markSideEffect();
        },
        prepare: (): void => {
            throw new Error('discard prepared sampled scene');
        },
        execute(): void {
            /* Preparation fails before commands can execute. */
        }
    };
    invalid: 'none' | 'name' | 'sampler' | 'missing' | 'feedback' = 'none';
    constructor(context: RenderPipelineCreateContext) {
        this.buffer = context.createStorageBuffer({
            byteLength: 16,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
    }
    record(context: RenderPipelineContext): void {
        context.writeStorageBuffer(this.buffer, 0, new Float32Array([1, 1, 1, 1]));
        const source = context.graph.createTexture('asymmetric scene effect', {
            format: 'rgba8unorm',
            extent: { relativeTo: 'output', scale: 1 }
        });
        const output = context.graph.importOutput().color(0);
        context.graph.addPass(this.source, {
            inputTextures: [],
            colorAttachments: [
                {
                    texture: source,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 0 }
                }
            ]
        });
        const colorAttachments = [
            {
                texture: output,
                loadOp: 'clear' as const,
                storeOp: 'store' as const,
                clearValue: { r: 0, g: 0, b: 0, a: 0 }
            }
        ];
        if (!this.useScene) {
            context.graph.addPass(this.present, { inputTextures: [source], colorAttachments });
            return;
        }
        const scenePass = context.graph.addPass(this.scenePass, {
            rendererList: context.createRendererList({
                cullingResults: context.cull(),
                queue: 'opaque',
                sorting: 'none'
            }),
            colorAttachments,
            storageShaderVariant: {
                shader: this.shader,
                buffers: [{ buffer: context.graph.importStorageBuffer(this.buffer) }],
                textures:
                    this.invalid === 'missing'
                        ? []
                        : [
                              {
                                  name: this.invalid === 'name' ? 'unknown' : 'u_sceneEffect',
                                  texture: this.invalid === 'feedback' ? output : source,
                                  sampler:
                                      this.invalid === 'sampler' ? this.comparison : this.sampler
                              }
                          ]
            }
        });
        if (this.failPrepare) context.graph.addPass(this.failure, { dependency: scenePass });
    }
    destroy(): void {
        this.buffer.destroy();
        this.source.shader.destroy();
        this.present.shader.destroy();
    }
}

describe('graph sampled inputs in storage scene passes', () => {
    it('matches asymmetric rows, rejects invalid ABI and feedback, retries and resizes', async () => {
        let pipeline: GraphTextureScene | null = null;
        const renderer = await Renderer.create({
            backend: 'webgpu',
            width: 12,
            height: 12,
            antialias: false,
            domElement: document.createElement('canvas'),
            renderPipeline: {
                name: 'graph scene texture factory',
                requirements: { requiredCapabilities: ['storage-buffer'] },
                create(context): RenderPipeline {
                    pipeline = new GraphTextureScene(context);
                    return pipeline;
                }
            }
        });
        const runtime = pipeline as GraphTextureScene | null;
        if (runtime === null) throw new Error('Scene texture runtime missing');
        const target = renderer.createRenderTarget({
            width: 12,
            height: 12,
            depthStencilAttachment: false
        });
        const scene = new Node().addChild(
            new Mesh({
                geometry: new PlaneGeometry({ width: 2, height: 2 }),
                material: new BasicMaterial({
                    lightType: 'NONE',
                    state: { depthTest: false, depthWrite: false, cullMode: 'none' }
                })
            })
        );
        const camera = new OrthographicCamera({ z: 2 });
        try {
            runtime.useScene = false;
            renderer.renderToTarget(target, scene, camera);
            const reference = (await target.readColorAttachment()).data.slice();
            expect(new Set(reference).size).toBeGreaterThan(1);
            runtime.useScene = true;
            renderer.renderToTarget(target, scene, camera);
            expect((await target.readColorAttachment()).data).toEqual(reference);
            const prepareSampler = vi.spyOn(ComputeSamplerResourceCache.prototype, 'prepare');
            const markUsed = vi.spyOn(ResourceRegistry.prototype, 'markUsed');
            runtime.failPrepare = true;
            expect(() => {
                renderer.renderToTarget(target, scene, camera);
            }).toThrow(/discard prepared sampled scene/u);
            const samplerCall = prepareSampler.mock.calls.findIndex(
                ([sampler]) => sampler === runtime.sampler
            );
            const samplerResult = prepareSampler.mock.results[samplerCall];
            if (samplerResult?.type !== 'return')
                throw new Error('Sampled scene did not prepare its sampler before failure');
            const samplerHandle = samplerResult.value;
            expect(markUsed.mock.calls.filter(([handle]) => handle === samplerHandle)).toHaveLength(
                0
            );
            runtime.failPrepare = false;
            renderer.renderToTarget(target, scene, camera);
            expect(markUsed.mock.calls.some(([handle]) => handle === samplerHandle)).toBe(true);
            prepareSampler.mockRestore();
            markUsed.mockRestore();
            for (const invalid of ['name', 'sampler', 'missing', 'feedback'] as const) {
                runtime.invalid = invalid;
                expect(() => {
                    renderer.renderToTarget(target, scene, camera);
                }).toThrow();
            }
            runtime.invalid = 'none';
            renderer.renderToTarget(target, scene, camera);
            expect((await target.readColorAttachment()).data).toEqual(reference);
            const identity = target.getColorTexture();
            const extension = renderer.getExtension('rhi') as { readonly device: RHIDevice } | null;
            if (extension === null) throw new Error('RHI recovery extension unavailable');
            const restored = new Promise<void>(resolve => {
                renderer.on(
                    'webgpuDeviceRestored',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            extension.device.destroy();
            await restored;
            renderer.renderToTarget(target, scene, camera);
            expect((await target.readColorAttachment()).data).toEqual(reference);
            expect(target.getColorTexture()).toBe(identity);
            target.resize(8, 8);
            renderer.renderToTarget(target, scene, camera);
            expect((await target.readColorAttachment()).data).toHaveLength(8 * 8 * 4);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    }, 20000);
});
